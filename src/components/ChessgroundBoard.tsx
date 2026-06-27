import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import { destsForFen } from "../game/chess";

import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

/** An arrow/highlight/badge drawn on the board (engine lines, move glyphs). */
export interface BoardShape {
  orig: string;
  dest?: string;
  brush?: string; // "green" | "blue" | "red" | … (arrows/highlights)
  /** Custom SVG badge on the square (100×100 viewBox centered at 50,50). */
  customSvg?: { html: string; center?: "orig" | "dest" | "label" };
}

export interface ChessgroundBoardProps {
  fen: string;
  orientation?: "white" | "black";
  /** Side(s) allowed to move; undefined = board is not interactive for moves. */
  movableColor?: "white" | "black" | "both";
  lastMove?: [string, string] | null;
  check?: boolean;
  /** Render-only board (no piece dragging). */
  viewOnly?: boolean;
  /** Show legal-move dots (defaults to true when movableColor is set). */
  showDests?: boolean;
  /** Arrows drawn automatically (engine lines). */
  shapes?: BoardShape[];
  onMove?: (from: string, to: string) => void;
  /** Square click callback — used by the Board Editor. */
  onSelect?: (square: string) => void;
}

/**
 * Presentational chessground board. Holds no game state — every screen drives
 * it through props, so it's reused by Play, Analysis, Analyze Game, Openings,
 * and the Board Editor.
 */
export function ChessgroundBoard(props: ChessgroundBoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  // Keep latest callbacks in refs so we don't rebind on every render.
  const onMove = useRef(props.onMove);
  const onSelect = useRef(props.onSelect);
  onMove.current = props.onMove;
  onSelect.current = props.onSelect;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { coordinates: true, drawable: { enabled: true } });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    if (!api.current) return;
    const { fen, orientation = "white", movableColor, lastMove, check, viewOnly } = props;
    const dests = movableColor ? (destsForFen(fen) as unknown as Map<Key, Key[]>) : undefined;

    api.current.set({
      fen,
      orientation,
      viewOnly: viewOnly ?? false,
      turnColor: fen.split(" ")[1] === "b" ? "black" : "white",
      lastMove: (lastMove as [Key, Key] | undefined) ?? undefined,
      check: check ? true : undefined,
      // Apply engine arrows / classification badges in the SAME render as the
      // position — a standalone setAutoShapes() doesn't reliably trigger a
      // redraw when only the shapes change (e.g. reviewing a move in place).
      drawable: { enabled: true, autoShapes: (props.shapes ?? []) as never },
      movable: {
        free: false,
        color: movableColor,
        dests,
        showDests: props.showDests ?? true,
        events: {
          after: (from: Key, to: Key) => onMove.current?.(from, to),
        },
      },
      // Enabled so a piece can be tapped then its destination tapped
      // (click/tap-to-move) — essential on mobile, where dragging fights with
      // the OS swipe gestures. Drag still works too.
      selectable: { enabled: true },
      events: {
        select: (key: Key) => onSelect.current?.(key),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.fen,
    props.orientation,
    props.movableColor,
    props.viewOnly,
    props.lastMove,
    props.check,
    props.showDests,
    props.shapes,
  ]);

  return (
    <div className="board-wrap">
      <div ref={el} className="board" />
    </div>
  );
}
