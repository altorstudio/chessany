import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { useStore } from "../store";
import { useFeedback } from "../feedback";
import { createEngine, getEngine, isNativeEngine } from "./registry";
import type { Engine } from "./Engine";
import { explainSingleMove, type PosInfo, type SingleMoveVerdict } from "../game/report";

// Shallow but quick — enough to spot real inaccuracies/blunders live without
// bogging down the device while a game is in progress.
const COACH_DEPTH = 12;
const COACH_MOVETIME = 600;

/**
 * Live move coaching for Play mode. When the `coach` preference is on, a
 * DEDICATED engine instance (separate from the one making the bot's moves)
 * quietly evaluates each position and classifies every move as it's played —
 * yours or the bot's. Returns a verdict per ply (index i = the i-th half-move),
 * or null while it's still being evaluated.
 */
export function useCoach(): (SingleMoveVerdict | null)[] {
  const coach = useFeedback((s) => s.coach);
  const mode = useStore((s) => s.mode);
  const history = useStore((s) => s.history);
  const startFen = useStore((s) => s.startFen);
  const engineId = useStore((s) => s.engineId);

  const coachPending = useStore((s) => s.coachPending);
  const [verdicts, setVerdicts] = useState<(SingleMoveVerdict | null)[]>([]);
  const engineRef = useRef<Engine | null>(null);
  // True when the coach OWNS its engine (a dedicated web worker it may quit).
  // On native the coach borrows the app-wide shared engine — quitting that
  // would kill the single native host process and strand every other consumer
  // (the post-game report would then hang forever at 0/N).
  const ownedRef = useRef(false);
  const evalsRef = useRef<Map<number, PosInfo>>(new Map()); // ply → eval of that position

  // Release the coach's engine: tear down an owned worker for good; merely
  // interrupt (never kill) the shared native engine.
  const releaseEngine = () => {
    if (!engineRef.current) return;
    try {
      if (ownedRef.current) engineRef.current.quit();
      else engineRef.current.stop();
    } catch { /* ignore */ }
    engineRef.current = null;
  };

  // Safety net: never let a deferred engine reply hang if grading stalls.
  useEffect(() => {
    if (!coachPending) return;
    const t = setTimeout(() => {
      const st = useStore.getState();
      if (st.coachPending) st.resumeEngine();
    }, 6000);
    return () => clearTimeout(t);
  }, [coachPending]);

  // Release the engine on unmount (quit if owned, stop if shared).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseEngine(), []);

  useEffect(() => {
    const active = coach && mode === "play";
    if (!active) {
      releaseEngine();
      evalsRef.current.clear();
      setVerdicts([]);
      return;
    }

    // Replay the game once to get every position's FEN and each move's UCI.
    // Replay from the game's actual start (a loaded position, not always the
    // standard start) so the coach evaluates the right FENs. chess.js throws on
    // an unexpected SAN, so guard each move — a desync must not crash the screen.
    const chess = new Chess(startFen);
    const fens = [chess.fen()];
    const ucis: string[] = [];
    for (const san of history) {
      let m;
      try { m = chess.move(san); } catch { break; }
      if (!m) break;
      ucis.push(m.from + m.to + (m.promotion ?? ""));
      fens.push(chess.fen());
    }
    // Drop cached evals past the current game length (after undo / new game).
    for (const k of [...evalsRef.current.keys()]) if (k >= fens.length) evalsRef.current.delete(k);

    let cancelled = false;
    const recompute = () => {
      const out: (SingleMoveVerdict | null)[] = [];
      for (let i = 0; i < history.length; i++) {
        const before = evalsRef.current.get(i);
        const after = evalsRef.current.get(i + 1);
        out[i] =
          before && after
            ? explainSingleMove({
                fenBefore: fens[i],
                fenAfter: fens[i + 1],
                playedUci: ucis[i],
                playedSan: history[i],
                color: fens[i].split(" ")[1] === "b" ? "b" : "w",
                before,
                after,
              })
            : null;
      }
      if (cancelled) return;
      setVerdicts(out);
      // If the engine is waiting on this move's grade, report it: pause on any
      // flagged move (inaccuracy / mistake / blunder) so the player can review
      // it before the bot replies; otherwise let the bot move.
      const st = useStore.getState();
      if (st.coachPending && st.viewPly == null) {
        const last = out[history.length - 1];
        const flagged =
          last?.classification === "inaccuracy" ||
          last?.classification === "mistake" ||
          last?.classification === "blunder";
        if (last) st.coachVerdict(flagged);
      }
    };

    (async () => {
      let engine = engineRef.current;
      if (!engine) {
        // Native runs ONE engine process for the whole app — a second instance
        // would restart that host, and its quit() would kill it under every
        // other consumer. Borrow the shared engine there (its search serializer
        // interleaves coach searches with the bot's replies); the web gets a
        // dedicated small-hash worker as before.
        const native = isNativeEngine(engineId);
        engine = native ? getEngine(engineId) : createEngine(engineId, { Hash: 16 });
        ownedRef.current = !native;
        engineRef.current = engine;
        await engine.init();
      }
      if (cancelled) return;
      // Evaluate newest positions first so the move just played is graded fastest.
      for (let p = fens.length - 1; p >= 0; p--) {
        if (cancelled) return;
        if (evalsRef.current.has(p)) continue;
        // On the shared engine, play mode re-applies UCI_LimitStrength/Elo
        // before every bot reply — undo that before each grading search so the
        // coach judges at full strength, not at the bot's ~800-Elo setting.
        if (!ownedRef.current && engine.meta.supportsStrength) {
          engine.setOption("UCI_LimitStrength", "false");
          engine.setOption("Skill Level", 20);
        }
        try {
          const lines = await engine.search(fens[p], { multipv: 1, depth: COACH_DEPTH, movetime: COACH_MOVETIME });
          if (cancelled) return;
          const l1 = lines.find((l) => l.multipv === 1);
          evalsRef.current.set(p, { cp: l1?.scoreCp, mate: l1?.scoreMate, bestUci: l1?.pv?.[0] ?? null, pv: l1?.pv ?? [] });
        } catch {
          // On engine error, store a neutral eval so the move resolves (and any
          // pending engine reply isn't blocked forever).
          evalsRef.current.set(p, { cp: 0, mate: undefined, bestUci: null, pv: [] });
        }
        recompute();
      }
    })();

    return () => { cancelled = true; };
  }, [coach, mode, history, startFen, engineId]);

  return verdicts;
}
