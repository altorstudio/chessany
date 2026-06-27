// Shared engine abstraction.
//
// Every engine in the app — Stockfish (WASM / native), or any future
// engine — is exposed through this single
// interface. The play and analysis features only ever talk to `Engine`, never
// to a specific engine, so adding an engine is just registering a new entry.

/** A single line of search output, parsed from a UCI `info` line. */
export interface EngineInfo {
  /** Search depth reached. */
  depth?: number;
  /** Index of this line when MultiPV > 1 (1-based). */
  multipv: number;
  /** Score in centipawns, from the perspective of the side to move. */
  scoreCp?: number;
  /** Forced mate in N moves (positive = side to move mates). */
  scoreMate?: number;
  /** Principal variation as UCI moves, e.g. ["e2e4", "e7e5"]. */
  pv: string[];
  nodes?: number;
  nps?: number;
  /** Elapsed time in milliseconds. */
  time?: number;
}

export interface BestMove {
  /** Best move in UCI notation, or null if no legal move / game over. */
  best: string | null;
  ponder?: string | null;
}

export interface SearchLimits {
  /** Search to a fixed depth. */
  depth?: number;
  /** Search for a fixed number of milliseconds. */
  movetime?: number;
  /** Number of principal variations to report (analysis). */
  multipv?: number;
  /** Transposition-table size in MB (UCI Hash). */
  hash?: number;
}

/** Static description shown in the engine picker. */
export interface EngineMeta {
  id: string;
  name: string;
  /** One-line description shown under the name. */
  description: string;
  /** True if strength can be limited (skill / Elo). */
  supportsStrength: boolean;
  /**
   * True if the engine runs in a way that can be interrupted mid-search (real
   * Web Worker thread, e.g. Stockfish). False for pure-JS / synchronous-WASM
   * engines that block the worker until a search finishes — for
   * those, live analysis uses a short capped search time so rapid position
   * changes don't pile up long, uninterruptible searches.
   */
  interruptible: boolean;
}

export interface Engine {
  readonly meta: EngineMeta;

  /** Boot the worker and complete the UCI handshake. Idempotent. */
  init(): Promise<void>;

  /** Resolve once the engine reports `readyok`. */
  ready(): Promise<void>;

  /** Set a UCI option (e.g. "Skill Level", "MultiPV"). */
  setOption(name: string, value: string | number): void;

  /**
   * Start an infinite/limited analysis of `fen`, streaming parsed info lines
   * to `onInfo` until `stop()` is called or the search ends.
   */
  analyze(fen: string, limits: SearchLimits, onInfo: (info: EngineInfo) => void): void;

  /** Search `fen` and resolve with the chosen move. */
  bestMove(fen: string, limits: SearchLimits): Promise<BestMove>;

  /**
   * Batch search: run `fen` to the given limit and resolve with the final
   * MultiPV lines when the search ends. Used by the game report (sequential,
   * one position at a time) — resolves exactly on the search's `bestmove`.
   */
  search(fen: string, limits: SearchLimits): Promise<EngineInfo[]>;

  /** Stop the current search (engine still alive). */
  stop(): void;

  /** Terminate the worker and release resources. */
  quit(): void;
}
