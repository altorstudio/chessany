import type { EngineInfo } from "../engines/Engine";

interface Props {
  lines: EngineInfo[];
  fen: string;
  orientation?: "white" | "black";
}

// Tick lines at every ~2 pawns (the 50% one is the equality accent).
const TICKS = [12.5, 25, 37.5, 62.5, 75, 87.5];

/**
 * Vertical evaluation gauge beside the board, in the style of Lichess: a light
 * bar (White's share) with a dark overlay falling from the top (Black's share),
 * tick marks, a zero line, and an inset shadow. Theme-aware via CSS variables.
 */
export function EvalBar({ lines, fen, orientation = "white" }: Props) {
  const top = lines[0];
  const whiteToMove = fen.split(" ")[1] !== "b";

  let label = "0.0";
  let whitePct = 50;
  if (top) {
    const sign = whiteToMove ? 1 : -1;
    if (top.scoreMate !== undefined) {
      const m = sign * top.scoreMate;
      whitePct = m > 0 ? 100 : 0;
      label = `M${Math.abs(m)}`;
    } else if (top.scoreCp !== undefined) {
      const cp = (sign * top.scoreCp) / 100;
      whitePct = 50 + 50 * Math.max(-1, Math.min(1, cp / 8)); // ±8 pawns ≈ saturated
      label = `${cp >= 0 ? "+" : ""}${cp.toFixed(1)}`;
    }
  }

  const whiteAtBottom = orientation === "white";
  const blackPct = 100 - whitePct;
  // Black's overlay sits at the top normally, or the bottom when the board is
  // flipped — done in JS (not a CSS flip) so the number never renders mirrored.
  const blackStyle = whiteAtBottom ? { top: 0, height: `${blackPct}%` } : { bottom: 0, height: `${blackPct}%` };
  const whiteAhead = whitePct >= 50;
  const numAtBottom = whiteAhead === whiteAtBottom; // number sits on the winning side

  return (
    <div className="eval-gauge" title={`Evaluation: ${label}`} aria-label={`Evaluation ${label}`}>
      <div className="eval-gauge-black" style={blackStyle} />
      {TICKS.map((p) => (
        <i key={p} className="eval-tick" style={{ top: `${p}%` }} />
      ))}
      <i className="eval-tick zero" style={{ top: "50%" }} />
      <span className={`eval-num ${numAtBottom ? "bottom" : "top"} ${whiteAhead ? "on-white" : "on-black"}`}>{label}</span>
    </div>
  );
}
