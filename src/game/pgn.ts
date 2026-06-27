// PGNs pasted from the web — Lichess move lists especially, but also Chess.com
// and others — frequently carry Unicode that chess.js's strict tokenizer
// rejects, so a copy-paste that looks fine to the eye fails to load. The export
// box gives clean ASCII, but text copied from the rendered notation picks up:
//   - a leading BOM (U+FEFF)
//   - zero-width characters (U+200B-U+200D, U+2060)
//   - non-breaking / typographic spaces (U+00A0, U+2007, U+202F, en/em spaces)
//     in place of ordinary spaces
//   - figurine piece glyphs (U+2654-U+265F) instead of letters (N, B, ...)
// Normalize all of these back to plain ASCII before parsing.
//
// The substitutions use \u escapes (not literal glyphs) so they stay
// reviewable — an invisible character pasted into source can't be audited.

// White (U+2654-) then black (U+265A-) figurines → the SAN piece letter.
// Pawns (U+2659 / U+265F) carry no letter in SAN, so they map to "".
const FIGURINE: Record<string, string> = {
  "♔": "K", "♕": "Q", "♖": "R", "♗": "B", "♘": "N", "♙": "",
  "♚": "K", "♛": "Q", "♜": "R", "♝": "B", "♞": "N", "♟": "",
};

export function normalizePgn(raw: string): string {
  return raw
    .replace(/^﻿/, "") // strip a leading byte-order mark
    .replace(/[​-‍⁠]/g, "") // drop zero-width characters
    // Unicode spaces chess.js doesn't treat as token separators → ASCII space.
    .replace(/[  -    　]/g, " ")
    .replace(/[♔-♟]/g, (m) => FIGURINE[m] ?? m)
    .trim();
}
