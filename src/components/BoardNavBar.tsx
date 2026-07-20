import type { ReactNode } from "react";
import { tapHaptic } from "../feedback";

interface Props {
  onFirst?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onLast?: () => void;
  onFlip?: () => void;
  atStart?: boolean;
  atEnd?: boolean;
  /** Auto-play toggle (Analyze). Renders a play/pause button between prev and next. */
  playing?: boolean;
  onTogglePlay?: () => void;
  /** Extra control rendered at the right edge of the bar. */
  extra?: ReactNode;
}

/**
 * Persistent move-navigation bar shown at the bottom of the pinned board column
 * on mobile (hidden on desktop via CSS). Keeps first/prev/next/last + flip in the
 * thumb zone so the board never has to scroll out of view to be controlled.
 * Only renders buttons whose handler is supplied, so each screen configures it.
 */
// onFirst/onLast stay in Props (callers still pass them) but the bar renders
// only prev / play / next / flip — jump-to-ends wasn't worth the thumb space.
export function BoardNavBar({
  onPrev,
  onNext,
  onFlip,
  atStart,
  atEnd,
  playing,
  onTogglePlay,
  extra,
}: Props) {
  return (
    <div className="board-nav-bar">
      {onPrev && (
        <button
          className="btn nav-btn"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous move"
        >
          ‹
        </button>
      )}
      {onTogglePlay && (
        <button
          className={`btn nav-btn${playing ? " primary" : ""}`}
          onClick={() => { tapHaptic(); onTogglePlay(); }}
          disabled={atEnd && !playing}
          aria-label={playing ? "Pause" : "Auto-play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
      )}
      {onNext && (
        <button
          className="btn nav-btn"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next move"
        >
          ›
        </button>
      )}
      {onFlip && (
        <button
          className="btn nav-btn"
          onClick={() => { tapHaptic(); onFlip(); }}
          aria-label="Flip board"
        >
          ⇅
        </button>
      )}
      {extra}
    </div>
  );
}
