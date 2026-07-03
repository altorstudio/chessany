import { useEffect, useRef, type CSSProperties } from "react";
import { CLASS_META, type MoveClass } from "../game/report";
import { figurine, type TreeNode, type TreePath } from "../game/tree";

interface Ctx {
  current: TreePath;
  onJump: (path: TreePath) => void;
  classOf: (path: TreePath, node: TreeNode) => MoveClass | undefined;
}

function showBadge(cls: MoveClass | undefined): cls is MoveClass {
  return !!cls && cls !== "best" && cls !== "excellent" && cls !== "good" && cls !== "book";
}

/** Tidy a PGN clock "0:01:09" → "1:09" (drop a zero hours field). */
function formatClock(clk: string): string {
  const p = clk.split(":");
  if (p.length === 3) return p[0] === "0" ? `${Number(p[1])}:${p[2]}` : `${p[0]}:${p[1]}:${p[2]}`;
  return clk;
}

/** One move occupying a White/Black grid cell (mainline). */
function MoveCell({ node, path, ctx }: { node: TreeNode; path: TreePath; ctx: Ctx }) {
  const cls = ctx.classOf(path, node);
  const badge = showBadge(cls);
  // Tint the whole cell (left bar + background + SAN) with the classification
  // colour so blunders/mistakes/inaccuracies stand out when scanning the list,
  // not just a tiny glyph. Exposed as a CSS var so the rules live in CSS.
  const color = badge ? CLASS_META[cls].color : undefined;
  return (
    <button
      className={`tree-cell${path === ctx.current ? " current" : ""}${badge ? ` flagged ${cls}` : ""}`}
      style={color ? ({ "--cls-color": color } as CSSProperties) : undefined}
      onClick={() => ctx.onJump(path)}
    >
      <span className="tree-san">{figurine(node.san)}</span>
      {badge && (
        <span className="tree-badge" style={{ color }}>{CLASS_META[cls].icon}</span>
      )}
      {node.clock && <span className="tree-clock">{formatClock(node.clock)}</span>}
    </button>
  );
}

/** Compact inline move (used inside variation blocks). */
function InlineMove({ node, path, numbered, ctx }: { node: TreeNode; path: TreePath; numbered: boolean; ctx: Ctx }) {
  const white = node.ply % 2 === 1;
  const num = Math.ceil(node.ply / 2);
  const label = white ? `${num}.` : numbered ? `${num}…` : "";
  const cls = ctx.classOf(path, node);
  return (
    <button className={`tree-move${path === ctx.current ? " current" : ""}`} onClick={() => ctx.onJump(path)}>
      {label && <span className="tree-num">{label}</span>}
      <span className="tree-san">{figurine(node.san)}</span>
      {showBadge(cls) && (
        <span className="tree-badge" style={{ color: CLASS_META[cls].color }}>{CLASS_META[cls].icon}</span>
      )}
    </button>
  );
}

/** A variation subtree rendered inline (parenthesised, recursively). */
function InlineLine({ node, path, ctx, forceNumber }: { node: TreeNode; path: TreePath; ctx: Ctx; forceNumber: boolean }): JSX.Element | null {
  if (!node.children.length) return null;
  const [main, ...vars] = node.children;
  const mainPath = path + main.id;
  return (
    <>
      <InlineMove node={main} path={mainPath} numbered={forceNumber} ctx={ctx} />{" "}
      {vars.map((v) => (
        <span className="tree-variation" key={v.id}>
          (<InlineMove node={v} path={path + v.id} numbered ctx={ctx} />{" "}
          <InlineLine node={v} path={path + v.id} ctx={ctx} forceNumber={false} />)
        </span>
      ))}
      <InlineLine node={main} path={mainPath} ctx={ctx} forceNumber={vars.length > 0} />
    </>
  );
}

/** Full-width indented row holding one variation that branches off the mainline. */
function VariationRow({ first, parentPath, ctx }: { first: TreeNode; parentPath: TreePath; ctx: Ctx }) {
  const path = parentPath + first.id;
  return (
    <div className="tree-var-row">
      <InlineMove node={first} path={path} numbered ctx={ctx} />{" "}
      <InlineLine node={first} path={path} ctx={ctx} forceNumber={false} />
    </div>
  );
}

interface Entry {
  node: TreeNode;
  path: TreePath;
  vars: TreeNode[];
  parentPath: TreePath;
}

const emptyCell = <span className="tree-cell empty" />;

export function MoveTree({
  root,
  current,
  onJump,
  classOf,
}: {
  root: TreeNode;
  current: TreePath;
  onJump: (path: TreePath) => void;
  classOf: (path: TreePath, node: TreeNode) => MoveClass | undefined;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Keep the highlighted move visible while stepping through the game — on
  // phones the visible list is short and the current move drifts off-screen
  // within a few taps otherwise.
  useEffect(() => {
    wrapRef.current?.querySelector(".tree-cell.current")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!root.children.length) return <div className="game-state">No moves yet</div>;
  const ctx: Ctx = { current, onJump, classOf };

  // Flatten the mainline (children[0] chain), keeping each move's variation
  // siblings so they can be shown as indented blocks beneath their row.
  const main: Entry[] = [];
  let cur: TreeNode = root;
  let curPath: TreePath = "";
  while (cur.children.length) {
    const [m, ...vars] = cur.children;
    const p = curPath + m.id;
    main.push({ node: m, path: p, vars, parentPath: curPath });
    cur = m;
    curPath = p;
  }

  const rows: JSX.Element[] = [];
  let i = 0;
  while (i < main.length) {
    const e = main[i];
    const num = Math.ceil(e.node.ply / 2);
    const isWhite = e.node.ply % 2 === 1;

    if (isWhite) {
      const black = main[i + 1];
      // A White move with its own variations breaks the row, so Black starts fresh.
      const breakRow = e.vars.length > 0;
      rows.push(
        <div className="tree-row" key={e.path}>
          <span className="tree-rownum">{num}.</span>
          <MoveCell node={e.node} path={e.path} ctx={ctx} />
          {!breakRow && black ? <MoveCell node={black.node} path={black.path} ctx={ctx} /> : emptyCell}
        </div>,
      );
      e.vars.forEach((v) => rows.push(<VariationRow key={e.parentPath + v.id} first={v} parentPath={e.parentPath} ctx={ctx} />));
      if (!breakRow && black) {
        black.vars.forEach((v) => rows.push(<VariationRow key={black.parentPath + v.id} first={v} parentPath={black.parentPath} ctx={ctx} />));
        i += 2;
      } else {
        i += 1;
      }
    } else {
      // Black move on its own row (after a White-variation break, or rare odd start).
      rows.push(
        <div className="tree-row" key={e.path}>
          <span className="tree-rownum">{num}…</span>
          {emptyCell}
          <MoveCell node={e.node} path={e.path} ctx={ctx} />
        </div>,
      );
      e.vars.forEach((v) => rows.push(<VariationRow key={e.parentPath + v.id} first={v} parentPath={e.parentPath} ctx={ctx} />));
      i += 1;
    }
  }

  return <div className="tree-grid" ref={wrapRef}>{rows}</div>;
}
