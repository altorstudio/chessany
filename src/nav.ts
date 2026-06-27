import { create } from "zustand";
import { getEngine } from "./engines/registry";
import { useStore } from "./store";

export type View =
  | "play"
  | "analyzeGame"
  | "boardEditor"
  | "archive"
  | "openings";

export interface NavItem {
  view: View;
  label: string;
  icon: string; // emoji glyph, kept simple and dependency-free
}

export const NAV_ITEMS: NavItem[] = [
  { view: "play", label: "Play Chess", icon: "♟️" },
  { view: "analyzeGame", label: "Analyze Game", icon: "📈" },
  { view: "boardEditor", label: "Board Editor", icon: "✏️" },
  { view: "archive", label: "Games Archive", icon: "🗂️" },
  { view: "openings", label: "Openings", icon: "📖" },
];

interface NavState {
  view: View;
  drawerOpen: boolean;
  /** PGN handed to the Analyze Game screen (e.g. from the archive). */
  pendingPgn: string | null;
  setView: (view: View) => void;
  openAnalysis: (pgn: string) => void;
  /**
   * Open the Play screen in free-analysis mode at the current board position
   * (move both sides, live engine eval, no opponent). Used by the "Analyze"
   * action on the Board Editor and Openings screens — there's no separate
   * Analysis Board screen; analysis is just the Play screen in `analysis` mode.
   */
  analyzePosition: () => void;
  consumePendingPgn: () => string | null;
  toggleDrawer: () => void;
  closeDrawer: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  view: "play",
  drawerOpen: false,
  pendingPgn: null,
  openAnalysis: (pgn) => {
    try {
      getEngine(useStore.getState().engineId).stop();
    } catch {
      /* ignore */
    }
    set({ pendingPgn: pgn, view: "analyzeGame", drawerOpen: false });
  },
  consumePendingPgn: () => {
    const pgn = get().pendingPgn;
    set({ pendingPgn: null });
    return pgn;
  },
  setView: (view) => {
    // Reaching the Play screen through normal navigation always means a real
    // game vs the engine — reset to play mode so a prior "Analyze" handoff (which
    // left the board in analysis mode) doesn't linger.
    if (view === "play") useStore.getState().setMode("play");
    if (view === get().view) {
      set({ drawerOpen: false });
      return;
    }
    // Stop whatever the active engine was doing so screens don't fight over it.
    try {
      getEngine(useStore.getState().engineId).stop();
    } catch {
      /* engine may not be initialised yet */
    }
    set({ view, drawerOpen: false });
  },
  analyzePosition: () => {
    try {
      getEngine(useStore.getState().engineId).stop();
    } catch {
      /* ignore */
    }
    useStore.getState().setMode("analysis");
    set({ view: "play", drawerOpen: false });
  },
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  closeDrawer: () => set({ drawerOpen: false }),
}));
