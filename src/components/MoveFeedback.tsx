import { CLASS_META, explainMove, type ReportMove } from "../game/report";
import { figurine } from "../game/tree";

interface Props {
  move: ReportMove;
  /** Show the engine's best line as a variation on the board. */
  onShowLine?: () => void;
  /** Show the opponent's punishment line (how this move goes wrong) on the board. */
  onShowRefutation?: () => void;
}

/**
 * Persistent, in-panel verdict for the current move (chess.com/lichess style).
 *
 * Replaces the old transient toast that popped over the board on every step:
 * this lives in the analysis column, updates as you navigate, and never covers
 * the board. Colour-coded to the classification so it reads at a glance.
 */
export function MoveFeedback({ move, onShowLine, onShowRefutation }: Props) {
  const meta = CLASS_META[move.classification];
  const { message } = explainMove(move);
  const moveNo = Math.ceil(move.ply / 2);
  const dots = move.color === "w" ? "." : "...";
  const hasLine = !!move.bestLine?.length;
  const hasRefutation = !!move.refutation?.length;

  return (
    <div className="move-feedback" style={{ borderLeftColor: meta.color }}>
      <div className="move-feedback-head">
        <span className="move-feedback-badge" style={{ background: meta.color }}>{meta.icon}</span>
        <span className="move-feedback-move">{moveNo}{dots} {figurine(move.san)}</span>
        <span className="move-feedback-label" style={{ color: meta.color }}>{meta.label}</span>
      </div>
      <div className="move-feedback-msg">{message}</div>
      {hasRefutation && onShowRefutation && (
        <button className="move-feedback-line refutation" onClick={onShowRefutation}>
          See how it's punished
          <span className="move-feedback-line-pv">{move.refutation!.slice(0, 4).map(figurine).join(" ")}</span>
        </button>
      )}
      {hasLine && onShowLine && (
        <button className="move-feedback-line" onClick={onShowLine}>
          Show best line
          <span className="move-feedback-line-pv">{move.bestLine!.slice(0, 4).map(figurine).join(" ")}</span>
        </button>
      )}
    </div>
  );
}
