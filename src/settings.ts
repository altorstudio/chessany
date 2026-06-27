import { create } from "zustand";

// Engine analysis settings shared by every analysis surface (Analysis Board,
// Analyze Game, Openings). These map directly to engine controls:
//   searchTimeMs → UCI `go movetime`
//   multipv      → UCI `MultiPV`
//   hashMb       → UCI `Hash`
export interface AnalysisSettings {
  /** Master on/off for live analysis. */
  on: boolean;
  /** How long the engine thinks per position, in ms. */
  searchTimeMs: number;
  /** Number of principal variations to show (1–5). */
  multipv: number;
  /** Transposition-table size in MB. */
  hashMb: number;

  setOn: (on: boolean) => void;
  toggle: () => void;
  setSearchTimeMs: (ms: number) => void;
  setMultipv: (n: number) => void;
  setHashMb: (mb: number) => void;
}

export const useSettings = create<AnalysisSettings>((set) => ({
  on: true,
  searchTimeMs: 8000,
  multipv: 1, // one line = deepest search (best for finding tactics); raise for more lines
  hashMb: 128,

  setOn: (on) => set({ on }),
  toggle: () => set((s) => ({ on: !s.on })),
  setSearchTimeMs: (searchTimeMs) => set({ searchTimeMs }),
  setMultipv: (multipv) => set({ multipv }),
  setHashMb: (hashMb) => set({ hashMb }),
}));
