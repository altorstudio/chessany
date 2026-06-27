import { useMemo } from "react";
import { Chess } from "chess.js";
import { useStore } from "../store";
import { ChessgroundBoard, type BoardShape } from "./ChessgroundBoard";
import type { Square } from "../game/chess";

/**
 * The live-game board, wired to the global store (Play + Analysis Board).
 * `previewFen` overrides everything to show a hypothetical position (read-only)
 * — used to step through a coach line without touching the real game.
 */
export function Board({
  shapes,
  previewFen,
  previewLastMove,
}: {
  shapes?: BoardShape[];
  previewFen?: string | null;
  previewLastMove?: [Square, Square] | null;
}) {
  const fen = useStore((s) => s.fen);
  const orientation = useStore((s) => s.orientation);
  const turn = useStore((s) => s.turn);
  const mode = useStore((s) => s.mode);
  const playerColor = useStore((s) => s.playerColor);
  const lastMove = useStore((s) => s.lastMove);
  const checkSquare = useStore((s) => s.checkSquare);
  const userMove = useStore((s) => s.userMove);
  const gameOver = useStore((s) => s.status.isGameOver || !!s.resignedResult);
  const history = useStore((s) => s.history);
  const viewPly = useStore((s) => s.viewPly);

  // Reviewing a past move: show that position (read-only) instead of the live one.
  const browsing = viewPly !== null && viewPly < history.length;
  const view = useMemo(() => {
    if (!browsing) return { fen, lastMove, check: !!checkSquare };
    const c = new Chess();
    let last: [Square, Square] | null = null;
    for (let i = 0; i < viewPly!; i++) {
      const m = c.move(history[i]);
      if (i === viewPly! - 1 && m) last = [m.from as Square, m.to as Square];
    }
    return { fen: c.fen(), lastMove: last, check: c.isCheck() };
  }, [browsing, viewPly, history, fen, lastMove, checkSquare]);

  const previewing = !!previewFen;
  let previewCheck = false;
  if (previewing) {
    try { previewCheck = new Chess(previewFen!).isCheck(); } catch { /* ignore */ }
  }

  const turnColor = turn === "w" ? "white" : "black";
  // In analysis you move both sides; in play only your color on your turn. Never
  // while the game is over, reviewing a past move, or previewing a coach line.
  const movableColor =
    previewing || gameOver || browsing
      ? undefined
      : mode === "analysis"
        ? "both"
        : playerColor === turnColor
          ? playerColor
          : undefined;

  return (
    <ChessgroundBoard
      fen={previewing ? previewFen! : view.fen}
      orientation={orientation}
      movableColor={movableColor}
      lastMove={previewing ? previewLastMove ?? null : view.lastMove}
      check={previewing ? previewCheck : view.check}
      shapes={previewing ? undefined : shapes}
      onMove={(from, to) => userMove(from as Square, to as Square)}
    />
  );
}
