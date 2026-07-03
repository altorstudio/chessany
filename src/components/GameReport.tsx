import { useRef, useState } from "react";
import { CLASS_META, CLASS_ORDER, winPct, type GameReport as Report, type ReportMove } from "../game/report";
import { figurine } from "../game/tree";

interface Props {
  report: Report;
  whiteName: string;
  blackName: string;
  onClose: () => void;
  onJump?: (ply: number) => void;
  /** Mainline ply the board is currently showing (marks it on the graph). */
  currentPly?: number;
}

const W = 600;
const H = 180;

// Classifications worth a marker dot on the graph (the notable moments).
const MARKED = new Set(["brilliant", "sharp", "inaccuracy", "mistake", "blunder"]);
const MARKER_R: Record<string, number> = { blunder: 4.5, mistake: 4, inaccuracy: 3.2, brilliant: 4, sharp: 3.2 };

function evalText(cp: number): string {
  if (cp >= 2000) return "+M";
  if (cp <= -2000) return "−M";
  const p = cp / 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}`;
}

/** Light quadratic smoothing through midpoints — keeps peaks, kills jaggies. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 3) return pts.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last[0]} ${last[1]}`;
}

/**
 * Win-probability area chart (chess.com/lichess style). White's territory is
 * the light region growing down from the top; the boundary is the win% curve —
 * the same logistic the accuracy math uses, so swings in equal positions show
 * large while "winning by 12 vs 15" barely moves. Scrub (hover/drag) for a
 * per-move tooltip; click/tap to jump the board there.
 */
function EvalGraph({
  evals,
  moves,
  currentPly,
  onJump,
}: {
  evals: number[];
  moves: ReportMove[];
  currentPly?: number;
  onJump?: (ply: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = evals.length;
  if (n < 2) return null;

  const X = (i: number) => (i / (n - 1)) * W;
  // White's share of the chart: win% straight down from the top edge.
  const Y = (i: number) => (winPct(evals[i]) / 100) * H;
  const pts: Array<[number, number]> = evals.map((_, i) => [+X(i).toFixed(1), +Y(i).toFixed(1)]);
  const line = smoothPath(pts);
  const area = `M0 0 L0 ${pts[0][1]} ${line.slice(1)} L${W} 0 Z`;

  const idxFromEvent = (e: React.PointerEvent | React.MouseEvent): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(f * (n - 1));
  };

  const markers = moves.filter((m) => MARKED.has(m.classification));
  // A vertical tick every 10 full moves for orientation.
  const ticks: number[] = [];
  for (let p = 20; p < n - 1; p += 20) ticks.push(p);

  const hoverMove = hover != null && hover > 0 ? moves[hover - 1] : null;
  const hoverMeta =
    hoverMove && hoverMove.classification !== "good" && hoverMove.classification !== "book"
      ? CLASS_META[hoverMove.classification]
      : null;

  return (
    <div className="report-graph">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="graph-svg"
        onPointerMove={(e) => setHover(idxFromEvent(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onJump?.(idxFromEvent(e))}
      >
        {/* Black's territory below, White's light area above the win% boundary. */}
        <rect x={0} y={0} width={W} height={H} fill="#2a2825" />
        <path d={area} fill="#e7e4de" />
        {/* Center/quarter guides + move-number ticks. */}
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#888" strokeWidth={0.6} strokeDasharray="4 3" />
        <line x1={0} y1={H / 4} x2={W} y2={H / 4} stroke="#888" strokeWidth={0.3} strokeDasharray="2 4" opacity={0.5} />
        <line x1={0} y1={(3 * H) / 4} x2={W} y2={(3 * H) / 4} stroke="#888" strokeWidth={0.3} strokeDasharray="2 4" opacity={0.5} />
        {ticks.map((p) => (
          <line key={p} x1={X(p)} y1={0} x2={X(p)} y2={H} stroke="#888" strokeWidth={0.3} opacity={0.35} />
        ))}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
        {/* Where the board currently is. */}
        {currentPly != null && currentPly > 0 && currentPly < n && (
          <line x1={X(currentPly)} y1={0} x2={X(currentPly)} y2={H} stroke="var(--accent)" strokeWidth={1} opacity={0.7} />
        )}
        {/* Notable moves, on the curve, coloured by classification. */}
        {markers.map((m) => (
          <circle
            key={m.ply}
            cx={X(m.ply)}
            cy={Y(m.ply)}
            r={MARKER_R[m.classification] ?? 3.5}
            fill={CLASS_META[m.classification].color}
            stroke="rgba(0,0,0,.6)"
            strokeWidth={0.6}
          />
        ))}
        {/* Scrub cursor. */}
        {hover != null && (
          <>
            <line x1={X(hover)} y1={0} x2={X(hover)} y2={H} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="3 3" />
            <circle cx={X(hover)} cy={Y(hover)} r={4} fill="var(--accent)" stroke="#fff" strokeWidth={1} />
          </>
        )}
      </svg>
      <span className="graph-side-label white">White</span>
      <span className="graph-side-label black">Black</span>
      {hover != null && (
        <div
          className="graph-tip"
          style={{ left: `clamp(70px, ${((hover / (n - 1)) * 100).toFixed(1)}%, calc(100% - 70px))` }}
        >
          <span className="graph-tip-move">
            {hoverMove
              ? `${Math.ceil(hoverMove.ply / 2)}${hoverMove.color === "w" ? "." : "…"} ${figurine(hoverMove.san)}`
              : "Start"}
          </span>
          <span className="graph-tip-eval">{evalText(evals[hover])}</span>
          {hoverMeta && <span className="graph-tip-class" style={{ color: hoverMeta.color }}>{hoverMeta.label}</span>}
        </div>
      )}
    </div>
  );
}

export function GameReport({ report, whiteName, blackName, onClose, onJump, currentPly }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal report" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Game Report</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <EvalGraph evals={report.evals} moves={report.moves} currentPly={currentPly} onJump={onJump} />
        <div className="graph-hint">Hover or drag to inspect a move · tap to open it on the board</div>

        {/* Accuracy */}
        <div className="report-accuracy">
          <AccuracyRow name={whiteName} pct={report.white.accuracy} side="white" />
          <AccuracyRow name={blackName} pct={report.black.accuracy} side="black" />
        </div>

        {report.opening && <div className="report-opening">{report.opening}</div>}

        {/* Classification counts */}
        <div className="report-counts">
          <div className="rc-head">
            <span>{whiteName}</span>
            <span />
            <span>{blackName}</span>
          </div>
          {CLASS_ORDER.map((c) => {
            const meta = CLASS_META[c];
            return (
              <div className="rc-row" key={c}>
                <span className="rc-num">{report.white.counts[c]}</span>
                <span className="rc-label">
                  <span className="rc-icon" style={{ background: meta.color }}>{meta.icon}</span>
                  {meta.label}
                </span>
                <span className="rc-num">{report.black.counts[c]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AccuracyRow({ name, pct, side }: { name: string; pct: number; side: "white" | "black" }) {
  return (
    <div className="acc-row">
      <span className={`acc-dot ${side}`} />
      <span className="acc-name">{name}</span>
      <div className="acc-bar">
        <div className="acc-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="acc-pct">{pct.toFixed(1)}%</span>
    </div>
  );
}
