import { useMemo, useRef, useState } from "react";
import { ChessgroundBoard } from "../components/ChessgroundBoard";
import { useStore } from "../store";
import { useNav } from "../nav";
import { useFitViewport } from "../hooks/useFitViewport";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

const GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

function startSquares(): Record<string, string> {
  const sq: Record<string, string> = {};
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  FILES.forEach((f, i) => {
    sq[`${f}1`] = back[i];
    sq[`${f}2`] = "P";
    sq[`${f}7`] = "p";
    sq[`${f}8`] = back[i].toLowerCase();
  });
  return sq;
}

function buildFen(sq: Record<string, string>, side: "w" | "b"): string {
  const rows = RANKS.map((r) => {
    let row = "";
    let empty = 0;
    for (const f of FILES) {
      const p = sq[`${f}${r}`];
      if (p) {
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += p;
      } else {
        empty++;
      }
    }
    if (empty) row += empty;
    return row;
  });

  // Derive castling rights from king/rook home squares.
  let castling = "";
  if (sq.e1 === "K") {
    if (sq.h1 === "R") castling += "K";
    if (sq.a1 === "R") castling += "Q";
  }
  if (sq.e8 === "k") {
    if (sq.h8 === "r") castling += "k";
    if (sq.a8 === "r") castling += "q";
  }
  if (!castling) castling = "-";

  return `${rows.join("/")} ${side} ${castling} - 0 1`;
}

export function BoardEditorScreen() {
  const [squares, setSquares] = useState<Record<string, string>>(startSquares);
  const [side, setSide] = useState<"w" | "b">("w");
  const [brush, setBrush] = useState<string>("P");
  const loadFen = useStore((s) => s.loadFen);
  const setMode = useStore((s) => s.setMode);
  const setView = useNav((s) => s.setView);
  const analyzePosition = useNav((s) => s.analyzePosition);
  const layoutRef = useRef<HTMLDivElement>(null);
  useFitViewport(layoutRef);

  const fen = useMemo(() => buildFen(squares, side), [squares, side]);
  const kings = useMemo(() => {
    const vals = Object.values(squares);
    return { w: vals.filter((p) => p === "K").length, b: vals.filter((p) => p === "k").length };
  }, [squares]);
  const valid = kings.w === 1 && kings.b === 1;

  const onSquare = (sqKey: string) => {
    setSquares((cur) => {
      const next = { ...cur };
      if (brush === "") delete next[sqKey];
      else next[sqKey] = brush;
      return next;
    });
  };

  // Play this position vs the engine.
  const playFrom = () => {
    if (!valid) return;
    if (loadFen(fen)) setView("play");
  };

  // Open this position in free-analysis mode (Play screen, no opponent).
  const analyze = () => {
    if (!valid) return;
    setMode("analysis"); // before loadFen so the engine doesn't auto-reply
    if (loadFen(fen)) analyzePosition();
  };

  const palette = ["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"];

  return (
    <div className="layout board-screen" ref={layoutRef}>
      <section className="board-col">
        <ChessgroundBoard fen={fen} movableColor={undefined} onSelect={onSquare} />
      </section>

      <aside className="side-col">
        <div className="panel">
          <div className="panel-title">Pieces — click a piece, then a square</div>
          <div className="palette">
            {palette.map((p) => (
              <button
                key={p}
                className={`palette-btn${brush === p ? " selected" : ""}`}
                onClick={() => setBrush(p)}
                title={p}
              >
                {GLYPH[p]}
              </button>
            ))}
            <button
              className={`palette-btn erase${brush === "" ? " selected" : ""}`}
              onClick={() => setBrush("")}
              title="Erase"
            >
              ⌫
            </button>
          </div>
        </div>

        <div className="panel">
          <label className="field">
            <span>Side to move</span>
            <select value={side} onChange={(e) => setSide(e.target.value as "w" | "b")}>
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
          </label>
          <div className="row">
            <button className="btn" onClick={() => setSquares(startSquares())}>Start position</button>
            <button className="btn" onClick={() => setSquares({})}>Clear</button>
          </div>
          <div className="fen-box" title="Current FEN">{fen}</div>
          {!valid && (
            <div className="game-state warn">Need exactly one white and one black king.</div>
          )}
          <div className="row">
            <button className="btn primary" disabled={!valid} onClick={analyze}>
              Analyze
            </button>
            <button className="btn" disabled={!valid} onClick={playFrom}>
              Play from here
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
