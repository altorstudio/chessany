import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { figurine } from "../game/tree";
import { CLASS_META, type SingleMoveVerdict } from "../game/report";

const FLAGGED = new Set(["inaccuracy", "mistake", "blunder"]);

/**
 * Interactive move list (Play + Analysis Board), modelled on Lichess mobile:
 * tap any move to jump to that position, the current move stays highlighted and
 * auto-scrolls into view, ‹ / › step, and a Live pill jumps back to the game.
 * Browsing the past never disturbs the live game (see store `viewPly`).
 */
export function MoveList({
  verdicts,
  onSave,
  saved,
  canSave,
}: {
  verdicts?: (SingleMoveVerdict | null)[];
  /** Optional save-to-archive action shown as a compact icon in the header. */
  onSave?: () => void;
  saved?: boolean;
  canSave?: boolean;
}) {
  const history = useStore((s) => s.history);
  const viewPly = useStore((s) => s.viewPly);
  const setViewPly = useStore((s) => s.setViewPly);

  const total = history.length;
  const cur = viewPly ?? total; // number of half-moves currently shown
  const browsing = viewPly !== null && viewPly < total;

  // Keep the highlighted move centred as it changes — but scroll ONLY the move
  // list itself, never the page (scrollIntoView would scroll the whole window on
  // mobile, yanking the board out of view after each move).
  const activeRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = activeRef.current;
    const box = gridRef.current;
    if (!el || !box) return;
    const er = el.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const delta = er.top - br.top - (box.clientHeight - el.clientHeight) / 2;
    box.scrollBy({ top: delta, behavior: "smooth" });
  }, [cur, total]);

  // Arrow keys step through the game (desktop); Home/End jump to start/live.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setViewPly(cur - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setViewPly(cur + 1); }
      else if (e.key === "Home") { e.preventDefault(); setViewPly(0); }
      else if (e.key === "End") { e.preventDefault(); setViewPly(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, setViewPly]);

  const rows: { num: number; w: number; b: number | null }[] = [];
  for (let i = 0; i < total; i += 2) rows.push({ num: i / 2 + 1, w: i + 1, b: i + 1 < total ? i + 2 : null });

  // `ply` = number of half-moves up to and including this move (1-based).
  const cell = (san: string, ply: number) => {
    const active = cur === ply;
    const v = verdicts?.[ply - 1];
    const badge = v && FLAGGED.has(v.classification) ? CLASS_META[v.classification] : null;
    return (
      <button
        ref={active ? activeRef : null}
        className={`tree-cell${active ? " current" : ""}`}
        onClick={() => setViewPly(ply)}
      >
        <span className="tree-san">{figurine(san)}</span>
        {badge && <span className="mv-badge" style={{ color: badge.color }}>{badge.icon}</span>}
      </button>
    );
  };

  return (
    <div className="panel movelist-panel live-moves">
      <div className="movelist-head">
        <span className="panel-title">Moves</span>
        <div className="movelist-nav">
          {onSave && (
            <button
              className="mv-nav-btn mv-save"
              onClick={onSave}
              disabled={!canSave}
              aria-label="Save game to archive"
              title="Save game to archive"
            >
              {saved ? "✓" : "⤓"}
            </button>
          )}
          <button className="mv-nav-btn" onClick={() => setViewPly(cur - 1)} disabled={cur <= 0} aria-label="Previous move">‹</button>
          <button className="mv-nav-btn" onClick={() => setViewPly(cur + 1)} disabled={cur >= total} aria-label="Next move">›</button>
          <button
            className={`mv-live${browsing ? "" : " on"}`}
            onClick={() => setViewPly(null)}
            disabled={!browsing}
          >
            {browsing ? "Return to live" : "● Live"}
          </button>
        </div>
      </div>

      {total === 0 ? (
        <div className="game-state">No moves yet</div>
      ) : (
        <div className="tree-grid" ref={gridRef}>
          {rows.map((r) => (
            <div className="tree-row" key={r.num}>
              <span className="tree-rownum">{r.num}.</span>
              {cell(history[r.w - 1], r.w)}
              {r.b ? cell(history[r.b - 1], r.b) : <span className="tree-cell empty" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
