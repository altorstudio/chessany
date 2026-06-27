import { CLASS_META, CLASS_ORDER, type GameReport as Report } from "../game/report";

interface Props {
  report: Report;
  whiteName: string;
  blackName: string;
  onClose: () => void;
  onJump?: (ply: number) => void;
}

const W = 600;
const H = 180;

// Squash a centipawn eval to a -1..1 vertical position.
function norm(cp: number): number {
  return Math.max(-1, Math.min(1, cp / 600));
}

export function GameReport({ report, whiteName, blackName, onClose, onJump }: Props) {
  const n = report.evals.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (cp: number) => H / 2 - norm(cp) * (H / 2);

  // Boundary line = eval; fill below it (black's territory) dark.
  const linePts = report.evals.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`);
  const areaPts = `0,${H} ${linePts.join(" ")} ${W},${H}`;

  const markers = report.moves.filter(
    (m) => m.classification === "blunder" || m.classification === "mistake" || m.classification === "inaccuracy",
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal report" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Game Report</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Eval graph */}
        <div className="report-graph">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="graph-svg">
            <rect x={0} y={0} width={W} height={H} fill="#e9e7e2" />
            <polygon points={areaPts} fill="#2a2825" />
            <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#888" strokeWidth={0.5} strokeDasharray="3 3" />
            <polyline points={linePts.join(" ")} fill="none" stroke="#5b9bd5" strokeWidth={1.5} />
            {markers.map((m) => (
              <circle
                key={m.ply}
                cx={x(m.ply)}
                cy={y(m.evalCp)}
                r={3.5}
                fill={CLASS_META[m.classification].color}
                stroke="#000"
                strokeWidth={0.5}
                onClick={() => onJump?.(m.ply)}
                style={{ cursor: onJump ? "pointer" : "default" }}
              />
            ))}
          </svg>
        </div>

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
