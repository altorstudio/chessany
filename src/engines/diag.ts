import { create } from "zustand";

// Captures engine `info string` lines (thread/cpu confirmations, errors) so the
// UI can surface them for debugging native performance.
interface DiagState {
  cpus: string; // persistent: which CPUs the engine subprocess may use
  lines: string[];
  push: (line: string) => void;
}

export const useEngineDiag = create<DiagState>((set) => ({
  cpus: "",
  lines: [],
  push: (line) =>
    set((s) =>
      line.startsWith("cpus_allowed")
        ? { cpus: line }
        : { lines: [...s.lines.slice(-3), line] },
    ),
}));
