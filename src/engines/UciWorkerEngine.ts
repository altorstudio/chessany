import type { BestMove, Engine, EngineInfo, EngineMeta, SearchLimits } from "./Engine";
import { parseBestMove, parseInfoLine } from "./uci";

type LineHandler = (line: string) => void;

/**
 * Drives a UCI-speaking Web Worker (Stockfish WASM, and any future engine).
 *
 * Engines differ only in their worker script and a few default options, so the
 * whole protocol lives here once. A new engine = a new `EngineMeta` + a worker
 * URL, nothing more.
 */
export class UciWorkerEngine implements Engine {
  readonly meta: EngineMeta;

  private worker: Worker | null = null;
  private readonly workerUrl: string;
  private readonly defaultOptions: Record<string, string | number>;
  private readonly lineHandlers = new Set<LineHandler>();
  private initPromise: Promise<void> | null = null;
  /** The current streaming-analysis handler (replaced on each new search). */
  private streamHandler: LineHandler | null = null;
  /** True while a `go` search is in progress (cleared on `bestmove`). */
  private searching = false;
  /** The next search to launch once the engine goes idle. */
  private pendingLaunch: (() => void) | null = null;

  constructor(
    meta: EngineMeta,
    workerUrl: string,
    defaultOptions: Record<string, string | number> = {},
  ) {
    this.meta = meta;
    this.workerUrl = workerUrl;
    this.defaultOptions = defaultOptions;
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        // Classic worker — the Stockfish build is a non-module script.
        this.worker = new Worker(this.workerUrl);
      } catch (err) {
        reject(err);
        return;
      }

      this.worker.onmessage = (e: MessageEvent) => {
        const data = typeof e.data === "string" ? e.data : e.data?.toString?.() ?? "";
        for (const line of data.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) this.lineHandlers.forEach((h) => h(trimmed));
        }
      };
      this.worker.onerror = (e) => reject(e);

      // Permanent watcher: a `bestmove` means the current search has ended, so
      // the engine is now idle and any queued next search can safely start.
      this.lineHandlers.add((line) => {
        if (line.startsWith("bestmove")) {
          this.searching = false;
          this.drainLaunch();
        }
      });

      // UCI handshake: send `uci`, wait for `uciok`.
      const onLine: LineHandler = (line) => {
        if (line === "uciok") {
          this.lineHandlers.delete(onLine);
          for (const [name, value] of Object.entries(this.defaultOptions)) {
            this.setOption(name, value);
          }
          // Some engines refuse to search until they've been told to start a
          // new game and allocate their hash table.
          this.send("ucinewgame");
          resolve();
        }
      };
      this.lineHandlers.add(onLine);
      this.send("uci");
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

  /**
   * Queue a search. If the engine is mid-search we send `stop` and defer the
   * launch until its `bestmove` arrives (engine idle) — this avoids sending a
   * new `position`/`go` into a running search, which corrupts the engine. A
   * timeout backstops the rare case where no `bestmove` is emitted.
   */
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
    if (this.searching) return; // wait for the in-flight search to end first
    const launch = this.pendingLaunch;
    this.pendingLaunch = null;
    if (launch) {
      this.searching = true;
      // Defer so a launch triggered from within `bestmove` dispatch doesn't add
      // a handler that observes the very line that triggered it.
      queueMicrotask(launch);
    }
  }

  /** Detach the current streaming-analysis handler, if any. */
  private clearStream(): void {
    if (this.streamHandler) {
      this.lineHandlers.delete(this.streamHandler);
      this.streamHandler = null;
    }
  }

  quit(): void {
    if (!this.worker) return;
    this.send("quit");
    this.worker.terminate();
    this.worker = null;
    this.initPromise = null;
    this.lineHandlers.clear();
  }

  private send(command: string): void {
    this.worker?.postMessage(command);
  }
}

function buildGoArgs(limits: SearchLimits, infinite: boolean): string {
  const parts: string[] = [];
  if (limits.depth) parts.push(`depth ${limits.depth}`);
  if (limits.movetime) parts.push(`movetime ${limits.movetime}`);
  // For analysis with no explicit limit, go infinite (until stop()).
  if (parts.length === 0 && infinite) parts.push("infinite");
  return parts.join(" ");
}
