import { Chess } from "chess.js";
import type { EngineInfo } from "../engines/Engine";
import { figurine } from "../game/tree";

// Score from the side-to-move's perspective → White's perspective string.
function formatScore(info: EngineInfo, whiteToMove: boolean): string {
  const sign = whiteToMove ? 1 : -1;
  if (info.scoreMate !== undefined) {
    const m = sign * info.scoreMate;
    return `#${m > 0 ? m : `-${Math.abs(m)}`}`;
  }
  if (info.scoreCp !== undefined) {
    const cp = (sign * info.scoreCp) / 100;
    return `${cp > 0 ? "+" : ""}${cp.toFixed(2)}`;
  }
  return "…";
}

// Nodes/sec — a quick way to confirm the engine is multi-threaded on device
// (native multi-threaded ≈ several M n/s; single-threaded WASM ≈ <1M).
function formatNps(nps?: number): string {
  if (!nps) return "";
  return nps >= 1e6 ? `${(nps / 1e6).toFixed(1)}M nps` : `${Math.round(nps / 1e3)}k nps`;
}

function pvToSan(fen: string, pv: string[], max = 8): string {
  const c = new Chess();
  try {
    c.load(fen);
  } catch {
    return "";
  }
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!m) break;
      out.push(figurine(m.san));
    } catch {
      break;
    }
  }
  return out.join(" ");
}

interface Props {
  fen: string;
  lines: EngineInfo[];
  emptyLabel?: string;
}

/** Ranked engine lines (score · depth · PV). The eval bar lives beside the board. */
export function AnalysisLines({ fen, lines, emptyLabel = "Analyzing…" }: Props) {
  const whiteToMove = fen.split(" ")[1] !== "b";

  if (lines.length === 0) return <div className="game-state">{emptyLabel}</div>;

  const top = lines[0];
  const nps = formatNps(top?.nps);

  return (
    <>
      {(top?.depth || nps) && (
        <div className="lines-stat">
          {top?.depth ? `depth ${top.depth}` : ""}
          {nps ? <span className="lines-nps">· {nps}</span> : null}
        </div>
      )}
    <ol className="lines">
      {lines.map((line) => (
        <li key={line.multipv} className="line">
          <span className="line-score">{formatScore(line, whiteToMove)}</span>
          <span className="line-depth">d{line.depth ?? 0}</span>
          <span className="line-pv">{pvToSan(fen, line.pv)}</span>
        </li>
      ))}
    </ol>
    </>
  );
}
