// A curated set of common named openings. Each lists its moves in SAN; the
// Openings screen plays them out on a board and can hand the position to the
// Analysis Board or Play. A small embedded book — no database required.

export interface Opening {
  eco: string;
  name: string;
  /** Moves in SAN order. */
  moves: string[];
}

export const OPENINGS: Opening[] = [
  { eco: "C60", name: "Ruy López", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"] },
  { eco: "C50", name: "Italian Game", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"] },
  { eco: "C45", name: "Scotch Game", moves: ["e4", "e5", "Nf3", "Nc6", "d4"] },
  { eco: "C44", name: "Ponziani Opening", moves: ["e4", "e5", "Nf3", "Nc6", "c3"] },
  { eco: "C42", name: "Petrov Defense", moves: ["e4", "e5", "Nf3", "Nf6"] },
  { eco: "C30", name: "King's Gambit", moves: ["e4", "e5", "f4"] },
  { eco: "C20", name: "Vienna Game", moves: ["e4", "e5", "Nc3"] },
  { eco: "B10", name: "Caro-Kann Defense", moves: ["e4", "c6"] },
  { eco: "B20", name: "Sicilian Defense", moves: ["e4", "c5"] },
  { eco: "B90", name: "Sicilian Najdorf", moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"] },
  { eco: "B22", name: "Sicilian Alapin", moves: ["e4", "c5", "c3"] },
  { eco: "C00", name: "French Defense", moves: ["e4", "e6"] },
  { eco: "B01", name: "Scandinavian Defense", moves: ["e4", "d5"] },
  { eco: "B07", name: "Pirc Defense", moves: ["e4", "d6", "d4", "Nf6", "Nc3", "g6"] },
  { eco: "B00", name: "Alekhine's Defense", moves: ["e4", "Nf6"] },
  { eco: "D06", name: "Queen's Gambit", moves: ["d4", "d5", "c4"] },
  { eco: "D30", name: "Queen's Gambit Declined", moves: ["d4", "d5", "c4", "e6"] },
  { eco: "D20", name: "Queen's Gambit Accepted", moves: ["d4", "d5", "c4", "dxc4"] },
  { eco: "D10", name: "Slav Defense", moves: ["d4", "d5", "c4", "c6"] },
  { eco: "E60", name: "King's Indian Defense", moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"] },
  { eco: "E20", name: "Nimzo-Indian Defense", moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"] },
  { eco: "E12", name: "Queen's Indian Defense", moves: ["d4", "Nf6", "c4", "e6", "Nf3", "b6"] },
  { eco: "A80", name: "Dutch Defense", moves: ["d4", "f5"] },
  { eco: "A45", name: "Trompowsky Attack", moves: ["d4", "Nf6", "Bg5"] },
  { eco: "A10", name: "English Opening", moves: ["c4"] },
  { eco: "A04", name: "Réti Opening", moves: ["Nf3"] },
  { eco: "A02", name: "Bird's Opening", moves: ["f4"] },
  { eco: "A40", name: "London System", moves: ["d4", "d5", "Bf4"] },
];
