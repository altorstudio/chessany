// Local games archive, persisted in localStorage. No backend needed.

import type { GameReport } from "./game/report";

export interface SavedGame {
  id: string;
  savedAt: number; // epoch ms
  pgn: string;
  result: string; // human-readable
  white: string;
  black: string;
  /** Accuracy %, set once a game report has been generated. */
  accuracy?: { white: number; black: number };
  /** The full analysis (classifications, evals, best lines), if analyzed. */
  report?: GameReport;
}

const KEY = "chessany.games";

function persist(games: SavedGame[]): void {
  localStorage.setItem(KEY, JSON.stringify(games));
}

export function listGames(): SavedGame[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as SavedGame[]).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function saveGame(game: Omit<SavedGame, "id" | "savedAt">): SavedGame {
  const games = listGames();
  // `crypto.randomUUID` is available in browsers and the Capacitor WebView.
  const entry: SavedGame = { ...game, id: crypto.randomUUID(), savedAt: Date.now() };
  games.unshift(entry);
  persist(games);
  return entry;
}

/**
 * Insert a game, or update the existing entry with the same PGN. Used when a
 * report finishes so analyzing a game (even one already in the archive) records
 * it once, refreshing its accuracy and timestamp rather than duplicating it.
 */
export function upsertGame(game: Omit<SavedGame, "id" | "savedAt">): SavedGame {
  const games = listGames();
  const existing = games.find((g) => g.pgn === game.pgn);
  if (existing) {
    Object.assign(existing, game, { savedAt: Date.now() });
    persist(games);
    return existing;
  }
  return saveGame(game);
}

export function findGameByPgn(pgn: string): SavedGame | undefined {
  return listGames().find((g) => g.pgn === pgn);
}

export function deleteGame(id: string): void {
  persist(listGames().filter((g) => g.id !== id));
}
