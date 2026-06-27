import { useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { ChessgroundBoard } from "../components/ChessgroundBoard";
import { AnalysisLines } from "../components/AnalysisLines";
import { EvalBar } from "../components/EvalBar";
import { EngineConfig } from "../components/EngineConfig";
import { OPENINGS, type Opening } from "../openings";
import { useAnalysis } from "../engines/useAnalysis";
import { useStore } from "../store";
import { useNav } from "../nav";
import { useFitViewport } from "../hooks/useFitViewport";

function fenAfter(moves: string[]): { fen: string; last: [string, string] | null } {
  const c = new Chess();
  let last: [string, string] | null = null;
  for (const san of moves) {
    try {
      const m = c.move(san);
      if (m) last = [m.from, m.to];
    } catch {
      break;
    }
  }
  return { fen: c.fen(), last };
}

export function OpeningsScreen() {
  const [selected, setSelected] = useState<Opening>(OPENINGS[0]);
  const loadFen = useStore((s) => s.loadFen);
  const setMode = useStore((s) => s.setMode);
  const setView = useNav((s) => s.setView);
  const analyzePosition = useNav((s) => s.analyzePosition);
  const layoutRef = useRef<HTMLDivElement>(null);
  useFitViewport(layoutRef);

  const { fen, last } = useMemo(() => fenAfter(selected.moves), [selected]);
  const lines = useAnalysis(fen, true);

  // Play this opening position vs the engine.
  const playFrom = () => {
    if (loadFen(fen)) setView("play");
  };

  // Explore this opening position in free-analysis mode (Play screen, no opponent).
  const analyze = () => {
    setMode("analysis"); // before loadFen so the engine doesn't auto-reply
    if (loadFen(fen)) analyzePosition();
  };

  return (
    <div className="layout board-screen" ref={layoutRef}>
      <section className="board-col">
        <div className="board-eval-row">
          <EvalBar lines={lines} fen={fen} />
          <ChessgroundBoard fen={fen} viewOnly lastMove={last} />
        </div>
      </section>

      <aside className="side-col">
        {/* Opening detail scrolls with the panel so only the board stays pinned. */}
        <div className="panel">
          <div className="panel-title">{selected.eco} · {selected.name}</div>
          <div className="opening-moves">
            {selected.moves.map((m, i) => (
              <span key={i} className="mv">
                {i % 2 === 0 ? `${i / 2 + 1}. ` : ""}
                {m}{" "}
              </span>
            ))}
          </div>
          <div className="evalbar-wrap"><AnalysisLines fen={fen} lines={lines} /></div>
          <div className="row">
            <button className="btn primary" onClick={analyze}>Analyze</button>
            <button className="btn" onClick={playFrom}>Play from here</button>
          </div>
        </div>
        <EngineConfig />
        <div className="panel openings-list">
          <div className="panel-title">Openings</div>
          {OPENINGS.map((o) => (
            <button
              key={o.eco + o.name}
              className={`opening-row${o === selected ? " selected" : ""}`}
              onClick={() => setSelected(o)}
            >
              <span className="eco">{o.eco}</span>
              <span className="oname">{o.name}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
