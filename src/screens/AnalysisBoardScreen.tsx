import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";
import { Board } from "../components/Board";
import { BoardNavBar } from "../components/BoardNavBar";
import { EngineConfig } from "../components/EngineConfig";
import { AnalysisLines } from "../components/AnalysisLines";
import { EvalBar } from "../components/EvalBar";
import { MoveList } from "../components/MoveList";
import { useAnalysis } from "../engines/useAnalysis";
import { bestMoveArrows } from "../game/shapes";
import { useFitViewport } from "../hooks/useFitViewport";

export function AnalysisBoardScreen() {
  const setMode = useStore((s) => s.setMode);
  const newGame = useStore((s) => s.newGame);
  const undo = useStore((s) => s.undo);
  const flip = useStore((s) => s.flip);
  const fen = useStore((s) => s.fen);
  const orientation = useStore((s) => s.orientation);
  const status = useStore((s) => s.status);
  const history = useStore((s) => s.history);
  const viewPly = useStore((s) => s.viewPly);
  const setViewPly = useStore((s) => s.setViewPly);
  const layoutRef = useRef<HTMLDivElement>(null);
  useFitViewport(layoutRef);

  useEffect(() => {
    setMode("analysis");
  }, [setMode]);

  const lines = useAnalysis(fen, !status.isGameOver);
  const shapes = useMemo(() => bestMoveArrows(lines), [lines]);
  const cur = viewPly ?? history.length;

  return (
    <div className="layout board-screen" ref={layoutRef}>
      <section className="board-col">
        <div className="board-eval-row">
          <EvalBar lines={lines} fen={fen} orientation={orientation} />
          <Board shapes={shapes} />
        </div>
        <BoardNavBar
          onFirst={() => setViewPly(0)}
          onPrev={() => setViewPly(cur - 1)}
          onNext={() => setViewPly(cur + 1)}
          onLast={() => setViewPly(null)}
          onFlip={flip}
          atStart={cur <= 0}
          atEnd={viewPly === null || cur >= history.length}
        />
      </section>
      <aside className="side-col">
        <EngineConfig />
        <div className="panel">
          <div className="panel-title">Analysis</div>
          {status.isGameOver ? (
            <div className="game-state">{status.result}</div>
          ) : (
            <AnalysisLines fen={fen} lines={lines} />
          )}
        </div>
        <div className="row">
          <button className="btn" onClick={() => newGame("white")}>Reset</button>
          <button className="btn" onClick={undo}>Undo</button>
          <button className="btn" onClick={flip}>Flip</button>
        </div>
        <MoveList />
      </aside>
    </div>
  );
}
