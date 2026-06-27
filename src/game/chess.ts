import { Chess, type Move, type Square } from "chess.js";

export type { Move, Square };

export interface GameStatus {
  isGameOver: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  /** "w" | "b" — side to move. */
  turn: "w" | "b";
  /** Human-readable result line, or null if the game is ongoing. */
  result: string | null;
}

export function statusOf(chess: Chess): GameStatus {
  let result: string | null = null;
  if (chess.isCheckmate()) {
    result = chess.turn() === "w" ? "Black wins by checkmate" : "White wins by checkmate";
  } else if (chess.isStalemate()) {
    result = "Draw — stalemate";
  } else if (chess.isInsufficientMaterial()) {
    result = "Draw — insufficient material";
  } else if (chess.isThreefoldRepetition()) {
    result = "Draw — threefold repetition";
  } else if (chess.isDraw()) {
    result = "Draw — 50-move rule";
  }

  return {
    isGameOver: chess.isGameOver(),
    isCheck: chess.isCheck(),
    isCheckmate: chess.isCheckmate(),
    isDraw: chess.isDraw(),
    turn: chess.turn(),
    result,
  };
}

/** All legal destination squares per origin square — used to gate board moves. */
export function legalDests(chess: Chess): Map<Square, Square[]> {
  const dests = new Map<Square, Square[]>();
  for (const move of chess.moves({ verbose: true }) as Move[]) {
    const arr = dests.get(move.from) ?? [];
    arr.push(move.to);
    dests.set(move.from, arr);
  }
  return dests;
}

/** Legal destinations for a position given as a FEN (for board components). */
export function destsForFen(fen: string): Map<Square, Square[]> {
  const c = new Chess();
  try {
    c.load(fen);
  } catch {
    return new Map();
  }
  return legalDests(c);
}

/** Convert a UCI move string (e2e4, e7e8q) into a chess.js move object. */
export function uciToMove(uci: string): { from: Square; to: Square; promotion?: string } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}
