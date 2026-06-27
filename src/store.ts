import { create } from "zustand";
import { Chess } from "chess.js";
import type { Square } from "./game/chess";
import { statusOf, uciToMove, type GameStatus } from "./game/chess";
import type { Engine } from "./engines/Engine";
import { DEFAULT_ENGINE_ID, getEngine } from "./engines/registry";
import { moveFeedback, useFeedback } from "./feedback";

export type Mode = "play" | "analysis";
export type Color = "white" | "black";

/** How hard the engine plays (approx. Elo + Skill Level + thinking time). */
export interface Difficulty {
  label: string;
  elo: number; // approximate playing strength, shown to the user
  skill: number; // 0-20 (Stockfish UCI "Skill Level")
  movetime: number; // ms per move
}

export const DIFFICULTIES: Difficulty[] = [
  { label: "Beginner", elo: 800, skill: 0, movetime: 300 },
  { label: "Casual", elo: 1200, skill: 3, movetime: 400 },
  { label: "Intermediate", elo: 1600, skill: 7, movetime: 600 },
  { label: "Advanced", elo: 2000, skill: 12, movetime: 900 },
  { label: "Expert", elo: 2400, skill: 17, movetime: 1400 },
  { label: "Maximum", elo: 3000, skill: 20, movetime: 2000 },
];

// The live game lives outside React state — it's a mutable object we read from.
const chess = new Chess();

interface State {
  // selection
  engineId: string;
  mode: Mode;
  playerColor: Color;
  difficulty: Difficulty;

  // engine lifecycle
  engineReady: boolean;
  engineThinking: boolean;

  /** FEN the current game started from (standard start, or a loaded position).
   *  Lets the coach replay the move list from the right root. */
  startFen: string;

  // derived board state (kept in sync after every move)
  fen: string;
  pgn: string;
  history: string[]; // SAN moves
  turn: "w" | "b";
  status: GameStatus;
  lastMove: [Square, Square] | null;
  checkSquare: Square | null;
  /** Manual game-over result (e.g. resignation) not derived from the board. */
  resignedResult: string | null;
  /** True once the user has started a game (vs. the initial setup screen). */
  playStarted: boolean;
  /**
   * Which ply the board is showing while reviewing past moves (number of
   * half-moves from the start). null = following the live game. Lets the user
   * click back through the game and return, without affecting play.
   */
  viewPly: number | null;
  /** Coach is evaluating the move just played; the engine's reply is deferred. */
  coachPending: boolean;
  /** Coach flagged a mistake/blunder — the game is paused for the user to decide. */
  coachPaused: boolean;

  // actions
  selectEngine: (id: string) => Promise<void>;
  setMode: (mode: Mode) => void;
  setDifficulty: (d: Difficulty) => void;
  newGame: (color: Color) => Promise<void>;
  loadFen: (fen: string) => boolean;
  userMove: (from: Square, to: Square, promotion?: string) => boolean;
  undo: () => void;
  flip: () => void;
  resign: () => void;
  setViewPly: (ply: number | null) => void;
  /** Coach reports its verdict for the just-played move; pauses if it was bad. */
  coachVerdict: (pause: boolean) => void;
  /** Continue from a coach pause — let the engine reply. */
  resumeEngine: () => void;
  /** Abandon the current game and return to the pre-game setup menu. */
  backToSetup: () => void;
  orientation: Color;
}

function snapshot() {
  const status = statusOf(chess);
  const hist = chess.history({ verbose: true });
  const last = hist[hist.length - 1];
  let checkSquare: Square | null = null;
  if (status.isCheck) {
    // find the king of the side to move
    for (const row of chess.board()) {
      for (const sq of row) {
        if (sq && sq.type === "k" && sq.color === status.turn) checkSquare = sq.square as Square;
      }
    }
  }
  return {
    fen: chess.fen(),
    pgn: chess.pgn(),
    history: chess.history(),
    turn: status.turn,
    status,
    lastMove: last ? ([last.from, last.to] as [Square, Square]) : null,
    checkSquare,
  };
}

// Switches run one at a time — rapid engine changes (or a change mid-init) must
// not interleave and collide on the shared native engine host.
let switchChain: Promise<void> = Promise.resolve();

export const useStore = create<State>((set, get) => {
  // Internal: run the engine for the side it controls (play mode only).
  async function maybeEngineMove() {
    const s = get();
    if (s.mode !== "play" || s.status.isGameOver || s.resignedResult) return;
    const engineTurn = s.playerColor === "white" ? "b" : "w";
    if (s.turn !== engineTurn) return;

    const engine = getEngine(s.engineId);
    await engine.init();
    if (engine.meta.supportsStrength) {
      // Stockfish honors UCI_Elo for an accurate target rating; Skill Level is
      // a fallback. Engines ignore options they don't implement.
      engine.setOption("Skill Level", s.difficulty.skill);
      if (s.difficulty.elo < 2850) {
        engine.setOption("UCI_LimitStrength", "true");
        engine.setOption("UCI_Elo", Math.max(1320, s.difficulty.elo));
      } else {
        engine.setOption("UCI_LimitStrength", "false");
      }
    }

    set({ engineThinking: true });
    const { best } = await engine.bestMove(chess.fen(), { movetime: s.difficulty.movetime });
    set({ engineThinking: false });

    // Guard: the user may have started a new game while the engine was thinking.
    if (best && get().fen === s.fen) {
      let move;
      try {
        move = chess.move(uciToMove(best));
      } catch {
        return; // ignore a stale/illegal move rather than crashing
      }
      set(snapshot());
      moveFeedback({ san: move.san, flags: move.flags, captured: !!move.captured, gameOver: chess.isGameOver() });
      void maybeEngineMove(); // in case of (rare) consecutive engine turns
    }
  }

  return {
    engineId: DEFAULT_ENGINE_ID,
    mode: "play",
    playerColor: "white",
    difficulty: DIFFICULTIES[2],

    engineReady: false,
    engineThinking: false,

    ...snapshot(),
    startFen: chess.fen(),
    resignedResult: null,
    playStarted: false,
    viewPly: null,
    coachPending: false,
    coachPaused: false,
    orientation: "white",

    selectEngine(id) {
      // Serialize: chain after any in-flight switch so they can't overlap.
      switchChain = switchChain.then(async () => {
        if (get().engineId === id && get().engineReady) return;
        const prev = get().engineId;
        if (prev !== id) {
          try {
            getEngine(prev).quit(); // release the previous engine first
          } catch {
            /* ignore */
          }
        }
        set({ engineId: id, engineReady: false });
        try {
          const engine: Engine = getEngine(id);
          await engine.init();
          set({ engineReady: true });
          void maybeEngineMove();
        } catch (err) {
          // A failed start must not throw (would surface as an app crash) —
          // leave the engine not-ready and let the user retry/switch.
          console.warn("engine init failed", err);
          set({ engineReady: false });
        }
      });
      return switchChain;
    },

    setMode(mode) {
      getEngine(get().engineId).stop();
      set({ mode });
      if (mode === "play") void maybeEngineMove();
    },

    setDifficulty(d) {
      set({ difficulty: d });
    },

    async newGame(color) {
      getEngine(get().engineId).stop();
      chess.reset();
      set({
        ...snapshot(),
        startFen: chess.fen(),
        playerColor: color,
        orientation: color,
        engineThinking: false,
        resignedResult: null,
        playStarted: true,
        viewPly: null,
        coachPending: false,
        coachPaused: false,
      });
      if (get().mode === "play") void maybeEngineMove();
    },

    loadFen(fen) {
      try {
        chess.load(fen);
      } catch {
        return false;
      }
      getEngine(get().engineId).stop();
      set({ ...snapshot(), startFen: chess.fen(), engineThinking: false, resignedResult: null, coachPending: false, coachPaused: false });
      if (get().mode === "play") void maybeEngineMove();
      return true;
    },

    userMove(from, to, promotion) {
      let move;
      try {
        move = chess.move({ from, to, promotion: promotion ?? "q" });
        if (!move) return false;
      } catch {
        return false; // illegal move
      }
      // A new move always jumps back to the live position.
      set({ ...snapshot(), viewPly: null });
      moveFeedback({ san: move.san, flags: move.flags, captured: !!move.captured, gameOver: chess.isGameOver() });
      if (get().mode === "play") {
        // With Coach on, hold the engine's reply until the coach has graded this
        // move — so a mistake is shown (and can be paused on) before the bot
        // moves and the moment passes. Otherwise reply immediately.
        if (useFeedback.getState().coach && !chess.isGameOver()) {
          set({ coachPending: true });
        } else {
          void maybeEngineMove();
        }
      }
      return true;
    },

    undo() {
      const s = get();
      // In play mode, undo a full pair so it's the human's turn again.
      chess.undo();
      if (s.mode === "play" && chess.history().length > 0) {
        const undoneTurn = s.playerColor === "white" ? "w" : "b";
        if (statusOf(chess).turn !== undoneTurn) chess.undo();
      }
      // Undoing also takes back a resignation / clears any coach pause.
      set({ ...snapshot(), engineThinking: false, resignedResult: null, coachPending: false, coachPaused: false });
    },

    flip() {
      set({ orientation: get().orientation === "white" ? "black" : "white" });
    },

    resign() {
      const s = get();
      if (s.status.isGameOver || s.resignedResult) return; // already over
      getEngine(s.engineId).stop();
      const winner = s.playerColor === "white" ? "Black" : "White";
      set({ resignedResult: `${winner} wins — you resigned`, engineThinking: false, coachPending: false, coachPaused: false });
    },

    setViewPly(ply) {
      const total = get().history.length;
      // Clamp; reaching the latest ply means "back to live" (null).
      if (ply === null || ply >= total) set({ viewPly: null });
      else set({ viewPly: Math.max(0, ply) });
    },

    coachVerdict(pause) {
      if (!get().coachPending) return;
      if (pause) {
        // Hold here so the player sees the mistake before the bot replies.
        set({ coachPending: false, coachPaused: true });
      } else {
        set({ coachPending: false, coachPaused: false });
        void maybeEngineMove();
      }
    },

    resumeEngine() {
      if (!get().coachPending && !get().coachPaused) return;
      set({ coachPending: false, coachPaused: false });
      void maybeEngineMove();
    },

    backToSetup() {
      getEngine(get().engineId).stop();
      chess.reset();
      set({
        ...snapshot(),
        startFen: chess.fen(),
        engineThinking: false,
        resignedResult: null,
        playStarted: false,
        viewPly: null,
        coachPending: false,
        coachPaused: false,
      });
    },
  };
});

// Dev-only handle for debugging in the browser console.
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__store = useStore;
