import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { getEngine } from "./registry";
import type { EngineInfo } from "./Engine";

/**
 * Live analysis of `fen` with the selected engine, driven by the shared
 * analysis settings (search time, MultiPV, hash). Restarts when the position,
 * engine, or any setting changes, and stops the engine on unmount. Intended for
 * one visible screen at a time — they share the single engine worker.
 */
export function useAnalysis(fen: string, screenEnabled: boolean): EngineInfo[] {
  const engineId = useStore((s) => s.engineId);
  const on = useSettings((s) => s.on);
  const searchTimeMs = useSettings((s) => s.searchTimeMs);
  const multipv = useSettings((s) => s.multipv);
  const hashMb = useSettings((s) => s.hashMb);
  const [lines, setLines] = useState<EngineInfo[]>([]);

  useEffect(() => {
    const enabled = screenEnabled && on;
    if (!enabled) {
      setLines([]);
      return;
    }
    let cancelled = false;
    const engine = getEngine(engineId);
    setLines([]);

    // Throttle UI updates: a searching engine emits dozens of info lines per
    // second (per PV), and pushing each one through setState re-renders the
    // whole screen (move list, gauge, board arrows) — that's the main-thread
    // stutter felt while navigating moves. Accumulate into a buffer and flush
    // at most every FLUSH_MS; the first update after a quiet spell flushes
    // immediately so a new position still evaluates visibly fast.
    const FLUSH_MS = 120;
    const pending: EngineInfo[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFlush = 0;
    const flush = () => {
      flushTimer = null;
      lastFlush = performance.now();
      setLines(pending.slice());
    };

    // Non-interruptible engines block their worker for the whole
    // search, so a long search time makes rapid position changes pile up and
    // feel stuck. Cap their live-analysis search to stay responsive.
    const movetime = engine.meta.interruptible ? searchTimeMs : Math.min(searchTimeMs, 1000);

    (async () => {
      await engine.init();
      if (cancelled) return;
      // The shared engine may still carry play mode's strength cap
      // (UCI_LimitStrength / UCI_Elo) from a game vs the bot — clear it so the
      // eval bar and lines reflect full-strength analysis, not ~800-Elo search.
      if (engine.meta.supportsStrength) {
        engine.setOption("UCI_LimitStrength", "false");
        engine.setOption("Skill Level", 20);
      }
      engine.analyze(fen, { multipv, movetime, hash: hashMb }, (info) => {
        if (cancelled) return;
        const prev = pending[info.multipv - 1];
        // Some updates (bound scores) carry a score but no PV — keep the last
        // known PV so the best-move arrows don't flicker out.
        pending[info.multipv - 1] =
          info.pv.length === 0 && prev?.pv?.length ? { ...info, pv: prev.pv } : info;
        if (flushTimer == null) {
          flushTimer = setTimeout(flush, Math.max(0, FLUSH_MS - (performance.now() - lastFlush)));
        }
      });
    })();

    return () => {
      cancelled = true;
      if (flushTimer != null) clearTimeout(flushTimer);
      engine.stop();
    };
  }, [fen, screenEnabled, on, engineId, searchTimeMs, multipv, hashMb]);

  return lines.filter(Boolean).sort((a, b) => a.multipv - b.multipv);
}
