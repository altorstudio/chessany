import type { EngineInfo } from "../engines/Engine";
import type { BoardShape } from "../components/ChessgroundBoard";
import { CLASS_META, type MoveClass } from "./report";

// A chess.com-style classification badge on a square (the move's destination).
export function classificationShape(square: string, cls: MoveClass): BoardShape {
  const { color, icon } = CLASS_META[cls];
  const fontSize = icon.length > 1 ? 26 : 34;
  return {
    orig: square,
    customSvg: {
      center: "orig",
      html:
        `<circle cx="74" cy="26" r="21" fill="${color}" stroke="#ffffff" stroke-width="3"/>` +
        `<text x="74" y="27" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${icon}</text>`,
    },
  };
}

// Same hue for both lines: best = solid green, 2nd = lighter (pale) green.
const BRUSHES = ["green", "paleGreen"];

/** Arrows for the first move of the top engine lines (default top 2). */
export function bestMoveArrows(lines: EngineInfo[], count = 2): BoardShape[] {
  const out: BoardShape[] = [];
  for (let i = 0; i < Math.min(count, lines.length); i++) {
    const uci = lines[i]?.pv?.[0];
    if (uci && uci.length >= 4) {
      out.push({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: BRUSHES[i] ?? "blue" });
    }
  }
  return out;
}
