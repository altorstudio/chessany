import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Chess } from "chess.js";
import { useStore } from "../store";
import { useFeedback } from "../feedback";
import { Board } from "../components/Board";
import { BoardNavBar } from "../components/BoardNavBar";
import { EnginePicker } from "../components/EnginePicker";
import { PlayPanel } from "../components/PlayPanel";
import { MoveList } from "../components/MoveList";
import { MoveFeedback } from "../components/MoveFeedback";
import { useFitViewport } from "../hooks/useFitViewport";
import { saveGame } from "../archive";
import { ENGINE_METAS } from "../engines/registry";
import { useCoach } from "../engines/useCoach";
import { figurine } from "../game/tree";
import type { BoardShape } from "../components/ChessgroundBoard";
import { CLASS_META, type ReportMove } from "../game/report";
import type { Square } from "../game/chess";

const FLAGGED = new Set(["inaccuracy", "mistake", "blunder"]);

/** Position (FEN) after the first `ply` half-moves of `history`. */
function fenAtPly(history: string[], ply: number): string {
  const c = new Chess();
  for (let i = 0; i < ply; i++) {
    try { if (!c.move(history[i])) break; } catch { break; }
  }
  return c.fen();
}

/** Replay `idx` moves of a SAN line from `startFen`; returns the position + last move. */
function replayLine(startFen: string, sans: string[], idx: number): { fen: string; lastMove: [Square, Square] | null } {
  const c = new Chess(startFen);
  let last: [Square, Square] | null = null;
  for (let i = 0; i < idx; i++) {
    let m;
    try { m = c.move(sans[i]); } catch { break; }
    if (!m) break;
    last = [m.from as Square, m.to as Square];
  }
  return { fen: c.fen(), lastMove: last };
}

export function PlayScreen() {
  const setMode = useStore((s) => s.setMode);
  const pgn = useStore((s) => s.pgn);
  const status = useStore((s) => s.status);
  const playerColor = useStore((s) => s.playerColor);
  const engineId = useStore((s) => s.engineId);
  const difficulty = useStore((s) => s.difficulty);
  const engineThinking = useStore((s) => s.engineThinking);
  const history = useStore((s) => s.history);
  const viewPly = useStore((s) => s.viewPly);
  const setViewPly = useStore((s) => s.setViewPly);
  const flip = useStore((s) => s.flip);
  const coachPaused = useStore((s) => s.coachPaused);
  const resumeEngine = useStore((s) => s.resumeEngine);
  const undo = useStore((s) => s.undo);
  const coachOn = useFeedback((s) => s.coach);
  const [saved, setSaved] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  useFitViewport(layoutRef);

  useEffect(() => {
    setMode("play");
  }, [setMode]);

  const verdicts = useCoach();

  // The move that led to the position currently shown (live or being reviewed).
  const cur = viewPly ?? history.length;
  const reviewed = cur - 1;
  const verdict = reviewed >= 0 ? verdicts[reviewed] : null;
  const flagged = !!verdict && FLAGGED.has(verdict.classification);

  // A coach line opened for step-through. `idx` = how many of its moves are
  // applied to `startFen` (0 = the line's starting position).
  const [preview, setPreview] = useState<{ kind: "best" | "punish"; sans: string[]; startFen: string } | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  // Reset whenever the reviewed move changes.
  useEffect(() => { setPreview(null); setPreviewIdx(0); }, [reviewed]);

  // While a coach line ("best" / "how it's punished") is open, step through it
  // with the arrow keys — ‹/› move along the line, Home/End jump to its ends,
  // and ← past the start (or Esc) closes it back to the game. Only bound while a
  // preview is open, so it never interferes with live play.
  useEffect(() => {
    if (!preview) return;
    const last = preview.sans.length;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); setPreviewIdx((i) => Math.min(i + 1, last)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (previewIdx <= 0) setPreview(null); else setPreviewIdx((i) => Math.max(0, i - 1)); }
      else if (e.key === "Home") { e.preventDefault(); setPreviewIdx(0); }
      else if (e.key === "End") { e.preventDefault(); setPreviewIdx(last); }
      else if (e.key === "Escape") { e.preventDefault(); setPreview(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, previewIdx]);

  const openLine = (kind: "best" | "punish") => {
    if (!verdict) return;
    if (preview?.kind === kind) { setPreview(null); return; } // toggle off
    const sans = (kind === "punish" ? verdict.refutation : verdict.bestLine) ?? [];
    const startFen = fenAtPly(history, kind === "punish" ? reviewed + 1 : reviewed);
    setPreview({ kind, sans, startFen });
    setPreviewIdx(0);
  };

  const previewView = preview ? replayLine(preview.startFen, preview.sans, previewIdx) : null;

  // No arrows while stepping a line; otherwise a single better-move hint arrow.
  const shapes: BoardShape[] | undefined =
    !preview && flagged && verdict?.bestUci
      ? [{ orig: verdict.bestUci.slice(0, 2), dest: verdict.bestUci.slice(2, 4), brush: "green" }]
      : undefined;

  // A ReportMove view of the verdict so we can reuse the analysis feedback card.
  const coachMove: ReportMove | null =
    flagged && verdict
      ? {
          ply: reviewed + 1,
          san: history[reviewed],
          color: reviewed % 2 === 0 ? "w" : "b",
          evalCp: 0,
          cpLoss: verdict.cpLoss,
          classification: verdict.classification,
          best: verdict.best,
          bestLine: verdict.bestLine,
          reason: verdict.reason,
          refutation: verdict.refutation,
        }
      : null;

  const engineName = ENGINE_METAS.find((m) => m.id === engineId)?.name ?? "Engine";

  const save = () => {
    saveGame({
      pgn,
      result: status.result ?? "In progress",
      white: playerColor === "white" ? "You" : `${engineName} (${difficulty.elo})`,
      black: playerColor === "black" ? "You" : `${engineName} (${difficulty.elo})`,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className={`layout board-screen${coachPaused ? " coach-paused" : ""}`} ref={layoutRef}>
      <section className="board-col">
        <div className="player-strip opponent">
          <span className="player-dot" />
          <span className="player-name">{engineName}</span>
          <span className="player-elo">{difficulty.elo}</span>
          {engineThinking && <span className="player-thinking">thinking…</span>}
        </div>
        <Board shapes={shapes} previewFen={previewView?.fen ?? null} previewLastMove={previewView?.lastMove ?? null} />
        <div className="player-strip you">
          <span className="player-dot light" />
          <span className="player-name">You</span>
        </div>
        {/* Coach line stepper lives directly under the (pinned) board so the
            board never has to scroll out of view while stepping through it. */}
        {preview && (
          <div className="line-preview">
            <div className="line-preview-head">
              <span>{preview.kind === "punish" ? "How it's punished" : "Best line"}</span>
              <button className="link-btn" onClick={() => setPreview(null)}>✕ Back to game</button>
            </div>
            <div className="line-preview-moves">
              <button
                className={`line-move${previewIdx === 0 ? " current" : ""}`}
                onClick={() => setPreviewIdx(0)}
              >
                start
              </button>
              {preview.sans.map((san, i) => (
                <button
                  key={i}
                  className={`line-move${previewIdx === i + 1 ? " current" : ""}`}
                  onClick={() => setPreviewIdx(i + 1)}
                >
                  {figurine(san)}
                </button>
              ))}
            </div>
          </div>
        )}
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
        <EnginePicker />
        <PlayPanel />
        {coachMove && (
          <MoveFeedback
            move={coachMove}
            onShowRefutation={verdict?.refutation?.length ? () => openLine("punish") : undefined}
            onShowLine={verdict?.bestLine?.length ? () => openLine("best") : undefined}
          />
        )}
        {coachPaused && (
          <div
            className="coach-pause"
            style={verdict ? ({ "--cls-color": CLASS_META[verdict.classification].color } as CSSProperties) : undefined}
          >
            <span className="coach-pause-label">
              {verdict ? (
                <>
                  <strong style={{ color: CLASS_META[verdict.classification].color }}>
                    {CLASS_META[verdict.classification].label}
                  </strong>{" "}
                  — review before the engine replies.
                </>
              ) : (
                "Paused — take a look before the engine replies."
              )}
            </span>
            <div className="row">
              <button className="btn primary" onClick={resumeEngine}>Continue</button>
              <button className="btn" onClick={undo}>Take back</button>
            </div>
          </div>
        )}
        <MoveList verdicts={coachOn ? verdicts : undefined} onSave={save} saved={saved} canSave={!!pgn} />
      </aside>
    </div>
  );
}
