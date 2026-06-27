import type { BestMove, Engine, EngineInfo, EngineMeta, SearchLimits } from "./Engine";
import { parseBestMove, parseInfoLine } from "./uci";
import { UciEngine } from "./native/uciEnginePlugin";
import { useEngineDiag } from "./diag";
import type { PluginListenerHandle } from "@capacitor/core";

type LineHandler = (line: string) => void;

// All NativeUciEngine instances share ONE native host that runs a single engine
// process. Starting/stopping must be strictly ordered across instances —
// otherwise an old `stop()` can land after a new `start()` and kill the fresh
// process (a crash seen when re-initialising the engine). This module-wide
// queue runs them one at a time, in order.
let pluginChain: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = pluginChain.then(op, op);
  pluginChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Drives a native UCI engine through the `UciEngine` Capacitor plugin. This is
 * the exact same protocol logic as {@link UciWorkerEngine} — handshake, search
 * serializer, MultiPV streaming — but the transport is the native host (which
 * runs a real, multi-threaded engine binary off the WebView thread) instead of
 * a Web Worker. So play, analysis and reports use it identically.
 */
export class NativeUciEngine implements Engine {
  readonly meta: EngineMeta;

  private readonly engineKey: string;
  private readonly defaultOptions: Record<string, string | number>;
  private readonly lineHandlers = new Set<LineHandler>();
  private listener: PluginListenerHandle | null = null;
  private initPromise: Promise<void> | null = null;
  private streamHandler: LineHandler | null = null;
  private searching = false;
  private pendingLaunch: (() => void) | null = null;

  constructor(
    meta: EngineMeta,
    engineKey: string,
    defaultOptions: Record<string, string | number> = {},
  ) {
    this.meta = meta;
    this.engineKey = engineKey;
    this.defaultOptions = defaultOptions;
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      (async () => {
        try {
          this.listener = await UciEngine.addListener("line", ({ line }) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            // Surface engine diagnostics (thread/cpu confirmations) for debugging.
            if (trimmed.startsWith("info string")) {
              useEngineDiag.getState().push(trimmed.slice(11).trim());
            }
            this.lineHandlers.forEach((h) => h(trimmed));
          });
          // Serialized so any previous engine's teardown completes first.
          await serial(() => UciEngine.start({ engine: this.engineKey }));
        } catch (err) {
          reject(err);
          return;
        }

        // A `bestmove` means the search ended → engine idle, drain any queued one.
        this.lineHandlers.add((line) => {
          if (line.startsWith("bestmove")) {
            this.searching = false;
            this.drainLaunch();
          }
        });

        const onLine: LineHandler = (line) => {
          if (line === "uciok") {
            this.lineHandlers.delete(onLine);
            for (const [name, value] of Object.entries(this.defaultOptions)) {
              this.setOption(name, value);
            }
            // Barrier: wait for `readyok` so the engine has actually allocated
            // its thread pool + hash from the options ABOVE before we let any
            // search start — otherwise it can search single-threaded.
            const onReady: LineHandler = (l) => {
              if (l === "readyok") {
                this.lineHandlers.delete(onReady);
                this.send("ucinewgame");
                resolve();
              }
            };
            this.lineHandlers.add(onReady);
            this.send("isready");
          }
        };
        this.lineHandlers.add(onLine);
        this.send("uci");
      })();
    });

    return this.initPromise;
  }

  ready(): Promise<void> {
    return new Promise<void>((resolve) => {
      const onLine: LineHandler = (line) => {
        if (line === "readyok") {
          this.lineHandlers.delete(onLine);
          resolve();
        }
      };
      this.lineHandlers.add(onLine);
      this.send("isready");
    });
  }

  setOption(name: string, value: string | number): void {
    this.send(`setoption name ${name} value ${value}`);
  }

  analyze(fen: string, limits: SearchLimits, onInfo: (info: EngineInfo) => void): void {
    this.clearStream();
    this.runSearch(() => {
      if (limits.hash) this.setOption("Hash", limits.hash);
      if (limits.multipv) this.setOption("MultiPV", limits.multipv);
      const onLine: LineHandler = (line) => {
        const info = parseInfoLine(line);
        if (info) onInfo(info);
      };
      this.streamHandler = onLine;
      this.lineHandlers.add(onLine);
      this.send(`position fen ${fen}`);
      this.send(`go ${buildGoArgs(limits, true)}`);
    });
  }

  bestMove(fen: string, limits: SearchLimits): Promise<BestMove> {
    this.clearStream();
    return new Promise<BestMove>((resolve) => {
      this.runSearch(() => {
        const onLine: LineHandler = (line) => {
          const bm = parseBestMove(line);
          if (bm) {
            this.lineHandlers.delete(onLine);
            resolve(bm);
          }
        };
        this.lineHandlers.add(onLine);
        this.send(`position fen ${fen}`);
        this.send(`go ${buildGoArgs(limits, false)}`);
      });
    });
  }

  search(fen: string, limits: SearchLimits): Promise<EngineInfo[]> {
    return new Promise<EngineInfo[]>((resolve) => {
      const latest = new Map<number, EngineInfo>();
      const onLine: LineHandler = (line) => {
        const info = parseInfoLine(line);
        if (info) {
          const prev = latest.get(info.multipv);
          latest.set(info.multipv, info.pv.length === 0 && prev?.pv?.length ? { ...info, pv: prev.pv } : info);
        }
        if (line.startsWith("bestmove")) {
          this.lineHandlers.delete(onLine);
          resolve([...latest.values()].sort((a, b) => a.multipv - b.multipv));
        }
      };
      this.runSearch(() => {
        if (limits.hash) this.setOption("Hash", limits.hash);
        if (limits.multipv) this.setOption("MultiPV", limits.multipv);
        this.lineHandlers.add(onLine);
        this.send(`position fen ${fen}`);
        this.send(`go ${buildGoArgs(limits, false)}`);
      });
    });
  }

  stop(): void {
    this.clearStream();
    this.pendingLaunch = null;
    if (this.searching) this.send("stop");
  }

  private runSearch(launch: () => void): void {
    this.pendingLaunch = launch;
    if (this.searching) {
      this.send("stop");
      const queued = launch;
      setTimeout(() => {
        if (this.pendingLaunch === queued) {
          this.searching = false;
          this.drainLaunch();
        }
      }, 2000);
    } else {
      this.drainLaunch();
    }
  }

  private drainLaunch(): void {
    if (this.searching) return;
    const launch = this.pendingLaunch;
    this.pendingLaunch = null;
    if (launch) {
      this.searching = true;
      queueMicrotask(launch);
    }
  }

  private clearStream(): void {
    if (this.streamHandler) {
      this.lineHandlers.delete(this.streamHandler);
      this.streamHandler = null;
    }
  }

  quit(): void {
    // Drop handlers first so any lines arriving before the stop completes are
    // ignored (prevents cross-talk with the next engine on the shared host).
    this.lineHandlers.clear();
    this.searching = false;
    this.pendingLaunch = null;
    void serial(() => UciEngine.stop()).catch(() => {});
    void this.listener?.remove();
    this.listener = null;
    this.initPromise = null;
  }

  // UCI commands are fire-and-forget; serialized so they reach the host in order
  // (and after any pending engine switch).
  private send(command: string): void {
    void serial(() => UciEngine.send({ command })).catch(() => {});
  }
}

function buildGoArgs(limits: SearchLimits, infinite: boolean): string {
  const parts: string[] = [];
  if (limits.depth) parts.push(`depth ${limits.depth}`);
  if (limits.movetime) parts.push(`movetime ${limits.movetime}`);
  if (parts.length === 0 && infinite) parts.push("infinite");
  return parts.join(" ");
}
