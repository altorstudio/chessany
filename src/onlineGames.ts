// A game fetched from an online provider (Lichess, Chess.com). Both providers
// normalize their API responses into this one shape so the UI is provider-agnostic.

export interface OnlineGame {
  id: string;
  white: string;
  whiteRating?: number;
  black: string;
  blackRating?: number;
  opening?: string;
  speed?: string;
  winner?: "white" | "black";
  createdAt: number; // epoch ms
  pgn: string;
}
