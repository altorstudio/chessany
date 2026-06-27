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

    // Non-interruptible engines block their worker for the whole
    // search, so a long search time makes rapid position changes pile up and
    // feel stuck. Cap their live-analysis search to stay responsive.
    const movetime = engine.meta.interruptible ? searchTimeMs : Math.min(searchTimeMs, 1000);

    (async () => {
      await engine.init();
      if (cancelled) return;
      engine.analyze(fen, { multipv, movetime, hash: hashMb }, (info) => {
        if (cancelled) return;
        setLines((cur) => {
          const next = cur.slice();
          const prev = next[info.multipv - 1];
          // Some updates (bound scores) carry a score but no PV — keep the last
          // known PV so the best-move arrows don't flicker out.
          next[info.multipv - 1] =
            info.pv.length === 0 && prev?.pv?.length ? { ...info, pv: prev.pv } : info;
          return next;
        });
      });
    })();

    return () => {
      cancelled = true;
      engine.stop();
    };
  }, [fen, screenEnabled, on, engineId, searchTimeMs, multipv, hashMb]);

  return lines.filter(Boolean).sort((a, b) => a.multipv - b.multipv);
}
