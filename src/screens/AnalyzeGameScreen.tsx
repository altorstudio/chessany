import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Chess } from "chess.js";
import { ChessgroundBoard } from "../components/ChessgroundBoard";
import { EvalBar } from "../components/EvalBar";
import { GameReport } from "../components/GameReport";
import { MoveTree } from "../components/MoveTree";
import { useAnalysis } from "../engines/useAnalysis";
import { getEngine, createEngine, isNativeEngine, availableEngineMetas } from "../engines/registry";
import { useStore } from "../store";
import { useNav } from "../nav";
import { OnlineGames } from "../components/OnlineGames";
import {
  CLASS_META,
  generateReport,
  parseGameForReport,
  type GameReport as Report,
  type MoveClass,
} from "../game/report";
import {
  addMove,
  isMainline,
  mainlinePath,
  nodeAtPath,
  nextMainlinePath,
  parentPath,
  treeFromMainline,
  figurine,
  type TreeNode,
  type TreePath,
} from "../game/tree";
import { bestMoveArrows, classificationShape } from "../game/shapes";
import { normalizePgn } from "../game/pgn";
import { MoveFeedback } from "../components/MoveFeedback";
import { BoardNavBar } from "../components/BoardNavBar";
import { moveFeedback, classificationHaptic, tapHaptic, type FeedbackLevel } from "../feedback";
import { upsertGame, findGameByPgn, listGames } from "../archive";
import { useFitViewport } from "../hooks/useFitViewport";

// Only notable moves get a distinct quality buzz; ordinary good moves just get
// the light move tap, so stepping through a game isn't a constant vibration.
function hapticLevel(cls: MoveClass): FeedbackLevel | null {
  if (cls === "blunder") return "bad";
  if (cls === "mistake" || cls === "inaccuracy") return "warn";
  return null; // book, good, best, excellent, brilliant, sharp
}

const DEMO_PGN =
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7';

// Per-position search limits for each report mode (shown in the Report tab).
// Deep is two-pass: scout everything fast, then re-search only the interesting
// positions (swings, non-best moves) at full depth — the deep time goes where
// the verdicts come from, so it's several times faster than deep-on-everything.
// That matters most on device, where ONE native engine runs positions in
// sequence (the web fans out across a worker pool).
const REPORT_MODES = {
  quick: { depth: 12, movetime: 1000 },
  deep: { depth: 12, movetime: 1000, refine: { depth: 18, movetime: 6000 } },
} as const;

interface ParsedPgn {
  start: string;
  mainline: string[];
  clocks: (string | undefined)[];
  white: string;
  black: string;
  result: string;
}

// Tidy a PGN clock "0:01:09" → "1:09" (drop a leading zero-hours field).
function formatClock(clk: string): string {
  const p = clk.split(":");
  if (p.length === 3) return p[0] === "0" ? `${Number(p[1])}:${p[2]}` : `${p[0]}:${p[1]}:${p[2]}`;
  return clk;
}

function resultText(raw?: string): string {
  switch (raw) {
    case "1-0": return "White won";
    case "0-1": return "Black won";
    case "1/2-1/2": return "Draw";
    default: return "Game";
  }
}

function parsePgn(pgn: string): ParsedPgn | null {
  const c = new Chess();
  try {
    c.loadPgn(normalizePgn(pgn));
  } catch {
    return null;
  }
  const verbose = c.history({ verbose: true }) as Array<{ san: string; before: string; after: string }>;
  if (verbose.length === 0) return null;
  const h = c.header() as Record<string, string | undefined>;
  const name = (n?: string | null, e?: string | null) => {
    if (!n || n === "?") return undefined;
    return e && e !== "?" ? `${n} (${e})` : n;
  };
  // Per-move clock from PGN [%clk] comments (keyed by the position after the move).
  const comments = c.getComments() as Array<{ fen: string; comment: string }>;
  const commentByFen = new Map(comments.map((x) => [x.fen, x.comment]));
  const clkRe = /\[%clk\s+([0-9:.]+)\]/;
  const clocks = verbose.map((m) => commentByFen.get(m.after)?.match(clkRe)?.[1]);
  return {
    start: verbose[0].before,
    mainline: verbose.map((m) => m.san),
    clocks,
    white: name(h.White, h.WhiteElo) ?? "White",
    black: name(h.Black, h.BlackElo) ?? "Black",
    result: resultText(h.Result),
  };
}

// Replay `idx` moves of a SAN line from `startFen` — for stepping a coach line
// without touching the game tree (so the user can't get lost in a variation).
function replayLine(startFen: string, sans: string[], idx: number): { fen: string; lastMove: [string, string] | null } {
  const c = new Chess(startFen);
  let last: [string, string] | null = null;
  for (let i = 0; i < idx; i++) {
    let m;
    try { m = c.move(sans[i]); } catch { break; }
    if (!m) break;
    last = [m.from, m.to];
  }
  return { fen: c.fen(), lastMove: last };
}

// Walk children[0] from `path` to the end of the current line.
function lineEnd(root: TreeNode, path: TreePath): TreePath {
  let p = path;
  let n = nodeAtPath(root, p);
  while (n.children.length) {
    n = n.children[0];
    p += n.id;
  }
  return p;
}

export function AnalyzeGameScreen() {
  const consumePendingPgn = useNav((s) => s.consumePendingPgn);
  const engineId = useStore((s) => s.engineId);
  const selectEngine = useStore((s) => s.selectEngine);

  const [tab, setTab] = useState<"pgn" | "lichess" | "chesscom">("pgn");
  const [pgnText, setPgnText] = useState("");
  const [game, setGame] = useState<ParsedPgn | null>(null);
  const [loadedPgn, setLoadedPgn] = useState("");
  const treeRef = useRef<TreeNode | null>(null);
  const [path, setPath] = useState<TreePath>("");
  const [autoplay, setAutoplay] = useState(false);
  const [loop, setLoop] = useState(false); // looping auto-replay (analysis playback)
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [report, setReport] = useState<Report | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showReport, setShowReport] = useState(false);
  // "Analysis" was removed as a tab — the board's eval bar + best-move arrows
  // already surface the live engine; the move list and report carry the rest.
  const [panelTab, setPanelTab] = useState<"moves" | "report">("moves");
  const reportAbort = useRef<AbortController | null>(null); // cancels an in-flight report
  const layoutRef = useRef<HTMLDivElement>(null);

  // On mobile, size the fixed layout to exactly fill from its top to the bottom
  // of the viewport so the scrollable panel is never pushed off-screen.
  useFitViewport(layoutRef);

  // Stop auto-play / looping replay — called on every manual interaction.
  const stopAuto = () => { setAutoplay(false); setLoop(false); };

  // Cancel an in-flight report (its engines stop; its result is discarded).
  const cancelReport = () => {
    reportAbort.current?.abort();
    reportAbort.current = null;
    setProgress(null);
  };

  const load = (text: string) => {
    const parsed = parsePgn(text);
    if (!parsed) {
      setError("Could not parse that PGN.");
      setGame(null);
      treeRef.current = null;
      return;
    }
    cancelReport(); // abort any analysis still running for the previous game
    setError(null);
    setGame(parsed);
    setLoadedPgn(text);
    treeRef.current = treeFromMainline(parsed.start, parsed.mainline, parsed.clocks);
    setPath("");
    // Restore a saved analysis for this exact game, if we have one.
    const restored = findGameByPgn(text)?.report ?? null;
    setReport(restored);
    // Land on the Report tab (analyze CTA) for an unanalyzed game so it's the
    // first thing seen; jump straight to the moves if it's already analyzed.
    // Open on the Report tab so analysis (engine + Quick/Deep) is right there;
    // after a report runs we switch to Moves to watch the annotated replay.
    setPanelTab("report");
    stopAuto();
  };

  useEffect(() => {
    const pending = consumePendingPgn();
    if (pending) {
      setPgnText(pending);
      load(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = treeRef.current;
  const node = useMemo(() => (tree ? nodeAtPath(tree, path) : null), [tree, path]);
  const fen = node?.fen ?? new Chess().fen();
  const last: [string, string] | null = node?.from && node?.to ? [node.from, node.to] : null;
  const mainPath = useMemo(() => (tree ? mainlinePath(tree) : ""), [tree, path]);
  const onMain = !!tree && isMainline(tree, path);

  // Each side's remaining clock at the current position, walking the moves
  // played up to `path` and keeping the latest [%clk] seen for each color.
  const sideClocks = useMemo(() => {
    let white: string | undefined;
    let black: string | undefined;
    if (tree) {
      let n: TreeNode = tree;
      for (let i = 0; i < path.length; i += 2) {
        const next = n.children.find((c) => c.id === path.slice(i, i + 2));
        if (!next) break;
        n = next;
        if (n.clock) {
          if (n.ply % 2 === 1) white = n.clock; // odd ply = a White move
          else black = n.clock;
        }
      }
    }
    return { white, black };
  }, [tree, path]);

  const lines = useAnalysis(fen, !!game && !progress);

  // Classification badge for the current (mainline) move + best-move arrows.
  const classOf = useMemo(
    () => (p: TreePath, n: TreeNode): MoveClass | undefined =>
      report && tree && isMainline(tree, p) && n.ply >= 1 ? report.moves[n.ply - 1]?.classification : undefined,
    [report, tree],
  );
  const classBadge = useMemo(() => {
    if (!node || !onMain || !report || node.ply < 1 || !node.to) return [];
    const cls = report.moves[node.ply - 1]?.classification;
    return cls ? [classificationShape(node.to, cls)] : [];
  }, [node, onMain, report]);
  const shapes = useMemo(() => [...bestMoveArrows(lines), ...classBadge], [lines, classBadge]);

  // Play a move on the board → follow/branch the tree.
  const onMove = (from: string, to: string) => {
    if (!tree || !node) return;
    let san: string;
    try {
      const m = new Chess(node.fen).move({ from, to, promotion: "q" });
      if (!m) return;
      san = m.san;
    } catch {
      return;
    }
    const newPath = addMove(tree, path, san);
    if (newPath) {
      stopAuto();
      setPath(newPath);
    }
  };

  // A coach line opened for step-through — shown as a read-only board preview
  // with tappable chips, NOT a tree variation, so the user never gets lost.
  const [preview, setPreview] = useState<{ kind: "best" | "punish"; sans: string[]; startFen: string } | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  useEffect(() => { setPreview(null); setPreviewIdx(0); }, [path]); // close when navigating

  const showBestLine = (atPath: TreePath, bestLine: string[]) => {
    if (!tree || !bestLine.length) return;
    stopAuto();
    // The best move was available in the position BEFORE the played move.
    const startFen = nodeAtPath(tree, parentPath(atPath)).fen;
    setPreview({ kind: "best", sans: bestLine, startFen });
    setPreviewIdx(0);
  };

  const showRefutationLine = (atPath: TreePath, line: string[]) => {
    if (!tree || !line.length) return;
    stopAuto();
    // The refutation runs from the position AFTER the played move.
    const startFen = nodeAtPath(tree, atPath).fen;
    setPreview({ kind: "punish", sans: line, startFen });
    setPreviewIdx(0);
  };

  const previewView = preview ? replayLine(preview.startFen, preview.sans, previewIdx) : null;

  // The current move's classification (when on a classified mainline move).
  const currentMove =
    tree && report && node && onMain && node.ply >= 1 ? report.moves[node.ply - 1] ?? null : null;
  const feedbackEl = currentMove ? (
    <MoveFeedback
      move={currentMove}
      onShowLine={currentMove.bestLine?.length ? () => showBestLine(path, currentMove.bestLine!) : undefined}
      onShowRefutation={currentMove.refutation?.length ? () => showRefutationLine(path, currentMove.refutation!) : undefined}
    />
  ) : null;

  // Move sound + a single haptic per step. If the move has a notable
  // classification (inaccuracy/mistake/blunder) we fire that quality buzz;
  // otherwise just the light move tap — never both, so it stays gentle.
  const prevPath = useRef("");
  useEffect(() => {
    // Stay silent while the report is generating (the board auto-plays then) —
    // otherwise it'd click ~once a second through the whole analysis.
    if (progress) { prevPath.current = path; return; }
    if (node && node.san && path !== prevPath.current) {
      const level = currentMove ? hapticLevel(currentMove.classification) : null;
      moveFeedback({ san: node.san, haptics: !level });
      if (level) classificationHaptic(level);
    }
    prevPath.current = path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, node]);

  // Auto-play along the current line (1 move/sec). When `loop` is on (analysis
  // playback) it restarts from the start at the end instead of stopping.
  useEffect(() => {
    if (!autoplay || !tree) return;
    const next = nextMainlinePath(tree, path);
    if (next === path) {
      if (loop) {
        const id = setTimeout(() => setPath(""), 1000);
        return () => clearTimeout(id);
      }
      setAutoplay(false);
      return;
    }
    const id = setTimeout(() => setPath(next), 1000);
    return () => clearTimeout(id);
  }, [autoplay, path, tree, loop]);

  // Keyboard navigation.
  useEffect(() => {
    if (!tree) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // While a coach line (best / "how it's punished") is open, the arrows step
      // THROUGH that line instead of the game — ‹/› move along it, Home/End jump
      // to its ends, and ← past the start (or Esc) returns to the game.
      if (preview) {
        const last = preview.sans.length;
        if (e.key === "ArrowRight") { e.preventDefault(); setPreviewIdx((i) => Math.min(i + 1, last)); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); if (previewIdx <= 0) setPreview(null); else setPreviewIdx((i) => Math.max(0, i - 1)); }
        else if (e.key === "Home") { e.preventDefault(); setPreviewIdx(0); }
        else if (e.key === "End") { e.preventDefault(); setPreviewIdx(last); }
        else if (e.key === "Escape") { e.preventDefault(); setPreview(null); }
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); stopAuto(); setPath((p) => parentPath(p)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stopAuto(); setPath((p) => nextMainlinePath(tree, p)); }
      else if (e.key === "Home") { e.preventDefault(); stopAuto(); setPath(""); }
      else if (e.key === "End") { e.preventDefault(); stopAuto(); setPath((p) => lineEnd(tree, p)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tree, preview, previewIdx]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => { setPgnText(t); load(t); });
  };

  const runReport = async (mode: "quick" | "deep") => {
    const parsed = parseGameForReport(loadedPgn);
    if (!parsed) return;
    // Quick = shallow & fast; Deep = slow & accurate.
    const base = REPORT_MODES[mode];
    const cores = navigator.hardwareConcurrency || 4;
    // A native engine is one shared multi-threaded process — REUSE it (don't
    // spawn a second instance: the native host runs one engine at a time, so a
    // pool would collide). The single-threaded WASM engine instead runs as a
    // pool of fresh workers — one position each — for ~Nx faster reports.
    const native = isNativeEngine(engineId);
    const makeEngine = native
      ? () => getEngine(engineId)
      : () => createEngine(engineId, { Hash: 16 });
    const concurrency = native ? 1 : Math.max(1, Math.min(cores - 1, 4));
    const opts = { ...base, concurrency, keepAlive: native };
    const controller = new AbortController();
    reportAbort.current = controller;
    // On native, the report drives the SAME shared engine instance as the live
    // analysis (useAnalysis) — the native host runs one engine process. Setting
    // `progress` disables live analysis, but its engine.stop() teardown runs in a
    // React effect. If that teardown landed *after* the report had queued its
    // first search, stop() would clear the native engine's single pending-search
    // slot and the report would hang forever at 0/total (this is the "analysis
    // stuck on mobile" bug). flushSync forces the disable + its teardown to run
    // synchronously now, so the engine is released before generateReport drives
    // it below. (Web reports use fresh per-position engines, so there's no
    // overlap there — this is harmless for them.)
    flushSync(() => {
      setProgress({ done: 0, total: parsed.fens.length });
      // Auto-play through the game while we analyze, and keep looping afterward.
      setPath("");
      setLoop(true);
      setAutoplay(true);
    });
    // The shared native engine may still carry play mode's strength cap
    // (UCI_LimitStrength / ~800 Elo) from a game just played against the bot —
    // clear it before analyzing, or every eval in the report is bot-strength.
    if (native) {
      const engine = getEngine(engineId);
      await engine.init();
      if (engine.meta.supportsStrength) {
        engine.setOption("UCI_LimitStrength", "false");
        engine.setOption("Skill Level", 20);
      }
    }
    try {
      const rep = await generateReport(makeEngine, parsed, opts, (done, total) => {
        if (!controller.signal.aborted) setProgress({ done, total });
      }, controller.signal);
      if (controller.signal.aborted) return; // a different game was loaded — discard
      setReport(rep);
      setShowReport(true);
      setPanelTab("moves"); // watch the annotated replay in the move list
      stopAuto(); // the report is ready — stop the auto-replay
      setPath(""); // back to the start, now annotated with classifications
      // Analyzed games go into the archive (updating in place if already there).
      if (game) {
        upsertGame({
          pgn: loadedPgn,
          result: game.result,
          white: game.white,
          black: game.black,
          accuracy: { white: rep.white.accuracy, black: rep.black.accuracy },
          report: rep,
        });
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") throw err; // cancelled → ignore
    } finally {
      if (reportAbort.current === controller) {
        reportAbort.current = null;
        setProgress(null);
      }
    }
  };

  const atEnd = !!tree && nextMainlinePath(tree, path) === path;
  const mainLen = mainPath.length / 2;

  // Key moments = the plies worth reviewing (brilliancies and errors). The
  // review bar's ‹ › buttons cycle the board through them so nobody has to
  // hunt for the coloured cells by scrolling the list.
  const keyMoments = useMemo(
    () =>
      report
        ? report.moves
            .filter((m) => ["brilliant", "sharp", "inaccuracy", "mistake", "blunder"].includes(m.classification))
            .map((m) => m.ply)
        : [],
    [report],
  );
  const curPly = onMain && node ? node.ply : 0;
  const momentIdx = keyMoments.indexOf(curPly);
  const jumpMoment = (dir: 1 | -1) => {
    if (!keyMoments.length || !tree) return;
    stopAuto();
    const next =
      dir === 1
        ? keyMoments.find((p) => p > curPly) ?? keyMoments[0]
        : [...keyMoments].reverse().find((p) => p < curPly) ?? keyMoments[keyMoments.length - 1];
    setPath(mainPath.slice(0, next * 2));
  };

  // One-tap re-open of recent archived games on the loader (mobile users
  // shouldn't have to re-paste a PGN they already analyzed).
  const recent = useMemo(() => (tree ? [] : listGames().slice(0, 4)), [tree]);

  // ONE mental model for every navigation control (nav bar, desktop buttons,
  // swipes, arrow keys): they move whatever the board is showing. While a coach
  // line ("best" / "how it's punished") is open they step THAT line — and
  // stepping back past its start closes it, returning to the game. Anything
  // else (arrows stepping the game underneath an open line) reads as broken.
  const stepPrev = () => {
    if (preview) {
      if (previewIdx <= 0) setPreview(null);
      else setPreviewIdx((i) => i - 1);
      return;
    }
    stopAuto();
    setPath(parentPath(path));
  };
  const stepNext = () => {
    if (preview) {
      setPreviewIdx((i) => Math.min(i + 1, preview.sans.length));
      return;
    }
    if (!tree) return;
    stopAuto();
    setPath(nextMainlinePath(tree, path));
  };
  const stepFirst = () => {
    if (preview) { setPreviewIdx(0); return; }
    stopAuto();
    setPath("");
  };
  const stepLast = () => {
    if (preview) { setPreviewIdx(preview.sans.length); return; }
    stopAuto();
    setPath(mainPath);
  };
  // In a preview, ‹ is never disabled — at the line's start it closes the line.
  const navAtStart = preview ? false : !path;
  const navAtEnd = preview ? previewIdx >= preview.sans.length : atEnd;

  // Swipe the board horizontally to step (mobile). Ignored when the touch
  // starts on a piece so it never fights making a move by drag.
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onBoardTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("piece")) { swipeRef.current = null; return; }
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onBoardTouchEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Date.now() - s.t > 600 || Math.abs(dx) < 48 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    if (dx < 0) stepNext();
    else stepPrev();
  };

  // The move the game hinged on: the costliest mistake/blunder. One tappable
  // line under the review bar ("the game turned on 5. Nxf7??").
  const turning = useMemo(() => {
    if (!report) return null;
    let best: Report["moves"][number] | null = null;
    for (const m of report.moves) {
      if (m.classification !== "mistake" && m.classification !== "blunder") continue;
      if (!best || m.cpLoss > best.cpLoss) best = m;
    }
    return best;
  }, [report]);

  // Name + remaining clock for one side, shown above/below the board (the side
  // to move's name is highlighted). `pos` only tweaks the padding.
  const playerStrip = (color: "white" | "black", pos: "top" | "bottom") => {
    if (!game) return null;
    const name = color === "white" ? game.white : game.black;
    const clock = color === "white" ? sideClocks.white : sideClocks.black;
    const toMove = fen.split(" ")[1] === (color === "white" ? "w" : "b");
    return (
      <div className={`player-strip${pos === "bottom" ? " you" : ""}${toMove ? " to-move" : ""}`}>
        <span className={`player-dot${color === "white" ? " light" : ""}`} />
        <span className="player-name">{name}</span>
        {clock && <span className="player-clock">{formatClock(clock)}</span>}
      </div>
    );
  };

  return (
    <div className="layout analyze-layout board-screen" ref={layoutRef}>
      <section className="board-col">
        {game && playerStrip(orientation === "white" ? "black" : "white", "top")}
        <div className="board-eval-row" onTouchStart={onBoardTouchStart} onTouchEnd={onBoardTouchEnd}>
          <EvalBar lines={lines} fen={fen} orientation={orientation} />
          <ChessgroundBoard
            fen={previewView ? previewView.fen : fen}
            orientation={orientation}
            lastMove={previewView ? previewView.lastMove : last}
            shapes={previewView ? undefined : shapes}
            movableColor={previewView || !tree ? undefined : fen.split(" ")[1] === "b" ? "black" : "white"}
            onMove={onMove}
          />
          {/* While auto-playing (during analysis or replay), name the move the
              board is showing — otherwise pieces just fly around anonymously. */}
          {(progress || autoplay) && !preview && node?.san && (
            <div
              className="autoplay-move"
              style={currentMove ? { borderColor: CLASS_META[currentMove.classification].color } : undefined}
            >
              {Math.ceil(node.ply / 2)}{node.ply % 2 === 1 ? "." : "…"} {figurine(node.san)}
              {currentMove && (
                <span style={{ color: CLASS_META[currentMove.classification].color, fontWeight: 800 }}>
                  {" "}{CLASS_META[currentMove.classification].icon}
                </span>
              )}
            </div>
          )}
        </div>
        {game && playerStrip(orientation, "bottom")}
        {preview && (
          <div className="line-preview">
            <div className="line-preview-head">
              <span>{preview.kind === "punish" ? "How it's punished" : "Best line"}</span>
              <button className="link-btn" onClick={() => setPreview(null)}>✕ Back to game</button>
            </div>
            <div className="line-preview-moves">
              <button className={`line-move${previewIdx === 0 ? " current" : ""}`} onClick={() => setPreviewIdx(0)}>start</button>
              {preview.sans.map((san, i) => (
                <button key={i} className={`line-move${previewIdx === i + 1 ? " current" : ""}`} onClick={() => setPreviewIdx(i + 1)}>
                  {figurine(san)}
                </button>
              ))}
            </div>
          </div>
        )}
        {tree && (
          <>
            {/* Desktop control row (hidden on mobile, where BoardNavBar takes
                over). All controls step whatever the board shows — the open
                coach line when there is one, else the game. */}
            <div className="row nav-row">
              <button className="btn" onClick={stepPrev} disabled={navAtStart}>‹</button>
              <button className={`btn${autoplay ? " primary" : ""}`} onClick={() => { setLoop(false); setAutoplay((a) => !a); }} disabled={(atEnd && !loop) || !!preview} title="Auto-play">
                {autoplay ? "⏸" : "▶"}
              </button>
              <button className="btn" onClick={stepNext} disabled={navAtEnd}>›</button>
              <button className="btn" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} title="Flip board">⇅</button>
            </div>
            <div className="nav-hint">Tap a piece then its target to move · ← / → to step · ⇅ flips</div>
            {/* Mobile thumb-zone control bar (hidden on desktop). */}
            <BoardNavBar
              onFirst={stepFirst}
              onPrev={stepPrev}
              onNext={stepNext}
              onLast={stepLast}
              onFlip={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
              atStart={navAtStart}
              atEnd={navAtEnd}
              playing={autoplay}
              onTogglePlay={preview ? undefined : () => { setLoop(false); setAutoplay((a) => !a); }}
            />
          </>
        )}
      </section>

      <aside className={`side-col${tree ? " side-tabbed" : ""}`}>
        {!tree ? (
          <div className="panel">
            <div className="loader-tabs">
              <button className={`loader-tab${tab === "pgn" ? " active" : ""}`} onClick={() => { tapHaptic(); setTab("pgn"); }}>PGN</button>
              <button className={`loader-tab${tab === "lichess" ? " active" : ""}`} onClick={() => { tapHaptic(); setTab("lichess"); }}>Lichess</button>
              <button className={`loader-tab${tab === "chesscom" ? " active" : ""}`} onClick={() => { tapHaptic(); setTab("chesscom"); }}>Chess.com</button>
            </div>
            {tab === "pgn" ? (
              <>
                <textarea className="pgn-input" value={pgnText} onChange={(e) => setPgnText(e.target.value)} placeholder="Paste PGN here…" rows={7} />
                <input ref={fileRef} type="file" accept=".pgn,.txt" hidden onChange={onFile} />
                <button className="link-btn" onClick={() => fileRef.current?.click()}>Choose PGN file</button>
                {error && <div className="game-state warn">{error}</div>}
                <div className="row">
                  <button className="btn primary" onClick={() => load(pgnText)} disabled={!pgnText.trim()}>Load PGN</button>
                  <button className="btn" onClick={() => { setPgnText(DEMO_PGN); load(DEMO_PGN); }}>Example</button>
                </div>
                {recent.length > 0 && (
                  <div className="recent-games">
                    <div className="recent-title">Recent games</div>
                    {recent.map((g) => (
                      <button key={g.id} className="recent-game" onClick={() => { setPgnText(g.pgn); load(g.pgn); }}>
                        <span className="recent-players">{g.white} vs {g.black}</span>
                        <span className="recent-meta">
                          {g.accuracy
                            ? `analyzed · ${g.accuracy.white.toFixed(0)}% / ${g.accuracy.black.toFixed(0)}%`
                            : g.result}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              // key: remount per provider so the username + list are that
              // provider's own (and the auto-fetch re-runs on tab switch).
              <OnlineGames key={tab} provider={tab} onPick={load} />
            )}
          </div>
        ) : (
          <>
            <div className="panel-tabs">
              <button className={`panel-tab${panelTab === "moves" ? " active" : ""}`} onClick={() => { tapHaptic(); setPanelTab("moves"); }}>Moves</button>
              <button className={`panel-tab${panelTab === "report" ? " active" : ""}`} onClick={() => { tapHaptic(); setPanelTab("report"); }}>
                Report{progress ? "…" : ""}
              </button>
            </div>

            <div className="tab-content">
              {/* Verdict pinned at the top of the scroll area (Moves/Analysis). */}
              {panelTab !== "report" && feedbackEl}
              {panelTab === "moves" && (
                <>
                  {report && !progress && (
                    <div className="review-bar">
                      <button className="review-acc" onClick={() => setShowReport(true)} title="Open the full report">
                        <span className="review-chip white">{report.white.accuracy.toFixed(0)}%</span>
                        <span className="review-vs">·</span>
                        <span className="review-chip black">{report.black.accuracy.toFixed(0)}%</span>
                      </button>
                      {keyMoments.length > 0 && (
                        <div className="review-moments">
                          <button className="btn moment-btn" onClick={() => jumpMoment(-1)} aria-label="Previous key moment">‹</button>
                          <span className="moment-label">
                            {momentIdx >= 0 ? `Moment ${momentIdx + 1}/${keyMoments.length}` : `${keyMoments.length} key moments`}
                          </span>
                          <button className="btn moment-btn" onClick={() => jumpMoment(1)} aria-label="Next key moment">›</button>
                        </div>
                      )}
                    </div>
                  )}
                  {report && !progress && turning && (
                    <button
                      className="review-summary"
                      onClick={() => { stopAuto(); setPath(mainPath.slice(0, turning.ply * 2)); }}
                    >
                      The game turned on{" "}
                      <strong style={{ color: CLASS_META[turning.classification].color }}>
                        {Math.ceil(turning.ply / 2)}{turning.color === "w" ? "." : "…"} {figurine(turning.san)}
                      </strong>{" "}
                      — tap to see it
                    </button>
                  )}
                  <div className="panel movelist-panel">
                    <div className="panel-title movelist-title">
                      <span>Moves · {node?.ply ?? 0}/{mainLen}</span>
                      <button
                        className="link-btn movelist-new"
                        onClick={() => { cancelReport(); stopAuto(); setGame(null); treeRef.current = null; setReport(null); setPath(""); setPanelTab("moves"); }}
                      >
                        + New game
                      </button>
                    </div>
                    {!onMain && (
                      <div className="variation-hint">Exploring a variation — tap any move to jump back.</div>
                    )}
                    <MoveTree root={tree} current={path} onJump={(p) => { stopAuto(); setPath(p); }} classOf={classOf} />
                  </div>
                </>
              )}

              {panelTab === "report" && (
                <div className="panel report-card">
                  <div className="panel-title">Game report</div>
                  {!progress && availableEngineMetas().length > 1 && (
                    <label className="report-engine">
                      <span>Engine</span>
                      <select value={engineId} onChange={(e) => selectEngine(e.target.value)}>
                        {availableEngineMetas().map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!progress && (
                    <div className="report-config">
                      <div className="report-config-row">
                        <span>Backend</span>
                        <span>
                          {isNativeEngine(engineId)
                            ? `native · ${Math.max(1, (navigator.hardwareConcurrency || 4) - 1)} threads`
                            : `in-browser · ${Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 4))}-worker pool`}
                          {/* Live speed readout from the running analysis, so
                              engine performance is visible on device. */}
                          {lines[0]?.nps ? ` · ${lines[0].nps >= 1e6 ? `${(lines[0].nps / 1e6).toFixed(1)}M` : `${Math.round(lines[0].nps / 1e3)}k`} nps` : ""}
                        </span>
                      </div>
                      <div className="report-config-row">
                        <span>Quick</span>
                        <span>depth {REPORT_MODES.quick.depth} · ≤{REPORT_MODES.quick.movetime / 1000}s/move</span>
                      </div>
                      <div className="report-config-row">
                        <span>Deep</span>
                        <span>depth {REPORT_MODES.deep.refine.depth} on key moments</span>
                      </div>
                    </div>
                  )}
                  {progress ? (
                    <div className="report-progress">
                      <div className="report-progress-bar"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
                      <span>Analyzing… {progress.done}/{progress.total} · playing through the game</span>
                    </div>
                  ) : report ? (
                    <>
                      <div className="report-stats">
                        <div className="report-stat">
                          <span className="report-stat-val">{report.white.accuracy.toFixed(0)}%</span>
                          <span className="report-stat-label">White</span>
                        </div>
                        <div className="report-stat">
                          <span className="report-stat-val">{report.black.accuracy.toFixed(0)}%</span>
                          <span className="report-stat-label">Black</span>
                        </div>
                      </div>
                      <button className="btn primary block" onClick={() => setShowReport(true)}>Open full report</button>
                      <div className="report-rerun-row">
                        <span>Re-analyze:</span>
                        <button className="link-btn" onClick={() => runReport("quick")}>Quick</button>
                        <button className="link-btn" onClick={() => runReport("deep")}>Deep</button>
                      </div>
                    </>
                  ) : (
                    <div className="analyze-cta">
                      <p className="analyze-cta-title">Analyze this game</p>
                      <button className="btn primary block" onClick={() => runReport("quick")}>Quick analysis</button>
                      <button className="btn block" onClick={() => runReport("deep")}>Deep analysis</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {showReport && report && game && (
        <GameReport
          report={report}
          whiteName={game.white}
          blackName={game.black}
          currentPly={onMain ? node?.ply : undefined}
          onClose={() => setShowReport(false)}
          onJump={(p) => { setShowReport(false); if (tree) setPath(mainPath.slice(0, p * 2)); }}
        />
      )}
    </div>
  );
}
