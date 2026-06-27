import { Chess, type Square } from "chess.js";

// A move tree modeled on lichess/lila: each node's children[0] is the mainline
// continuation; children[1..] are variations. A position is addressed by a
// `path` — the node ids from the root concatenated (each id is 2 chars), so
// prefix checks give ancestry (path utilities mirror lila's).

export interface TreeNode {
  id: string; // 2 chars; "" for the root
  ply: number;
  san: string; // "" for the root
  uci: string;
  fen: string;
  from?: string;
  to?: string;
  /** Clock remaining after this move (from the PGN's [%clk], e.g. "0:01:09"). */
  clock?: string;
  children: TreeNode[];
}

export type TreePath = string;

function sqIdx(sq: string): number {
  return (sq.charCodeAt(0) - 97) + (sq.charCodeAt(1) - 49) * 8; // a1=0 … h8=63
}

// Deterministic 2-char id for a move, so replaying the same move re-uses its
// node (follows the existing branch instead of duplicating it).
function nodeId(uci: string): string {
  const from = sqIdx(uci.slice(0, 2));
  const to = sqIdx(uci.slice(2, 4));
  const promo = "  nbrq".indexOf(uci[4] ?? " ");
  return String.fromCharCode(35 + from) + String.fromCharCode(35 + to + Math.max(0, promo) * 64);
}

export function newRoot(fen: string): TreeNode {
  return { id: "", ply: fen.split(" ")[1] === "b" ? 1 : 0, san: "", uci: "", fen, children: [] };
}

/** Build a root + a single mainline chain from SAN moves (+ optional clocks). */
export function treeFromMainline(startFen: string, sans: string[], clocks?: (string | undefined)[]): TreeNode {
  const root = newRoot(startFen);
  const c = new Chess(startFen);
  let node = root;
  for (let i = 0; i < sans.length; i++) {
    let m;
    try {
      m = c.move(sans[i]);
    } catch {
      break;
    }
    if (!m) break;
    const uci = m.from + m.to + (m.promotion ?? "");
    const child: TreeNode = {
      id: nodeId(uci),
      ply: node.ply + 1,
      san: m.san,
      uci,
      fen: c.fen(),
      from: m.from,
      to: m.to,
      clock: clocks?.[i],
      children: [],
    };
    node.children.push(child);
    node = child;
  }
  return root;
}

export function nodeAtPath(root: TreeNode, path: TreePath): TreeNode {
  let node = root;
  for (let i = 0; i < path.length; i += 2) {
    const seg = path.slice(i, i + 2);
    const next = node.children.find((c) => c.id === seg);
    if (!next) break;
    node = next;
  }
  return node;
}

/** The full mainline path (chain of first children). */
export function mainlinePath(root: TreeNode): TreePath {
  let path = "";
  let node = root;
  while (node.children.length) {
    node = node.children[0];
    path += node.id;
  }
  return path;
}

/** True if `path` lies on the mainline (chain of first children). */
export function isMainline(root: TreeNode, path: TreePath): boolean {
  let node = root;
  for (let i = 0; i < path.length; i += 2) {
    const seg = path.slice(i, i + 2);
    if (node.children[0]?.id !== seg) return false;
    node = node.children[0];
  }
  return true;
}

/**
 * Add a move (SAN) at `path`. Follows an existing child if the move is already
 * there, otherwise appends a new node (a variation if siblings exist). Returns
 * the new path, or null if the move is illegal.
 */
export function addMove(root: TreeNode, path: TreePath, san: string): TreePath | null {
  const node = nodeAtPath(root, path);
  const c = new Chess(node.fen);
  let m;
  try {
    m = c.move(san);
  } catch {
    return null;
  }
  if (!m) return null;
  const uci = m.from + m.to + (m.promotion ?? "");
  const id = nodeId(uci);
  const existing = node.children.find((ch) => ch.id === id);
  if (existing) return path + id;
  node.children.push({
    id,
    ply: node.ply + 1,
    san: m.san,
    uci,
    fen: c.fen(),
    from: m.from,
    to: m.to,
    children: [],
  });
  return path + id;
}

/** Add a sequence of SAN moves starting at `path`; returns the path of the first added move. */
export function addLine(root: TreeNode, path: TreePath, sans: string[]): TreePath {
  let cur = path;
  let firstPath: TreePath | null = null;
  for (const san of sans) {
    const next = addMove(root, cur, san);
    if (!next) break;
    if (firstPath === null) firstPath = next;
    cur = next;
  }
  return firstPath ?? path;
}

export function parentPath(path: TreePath): TreePath {
  return path.slice(0, -2);
}

export function nextMainlinePath(root: TreeNode, path: TreePath): TreePath {
  const node = nodeAtPath(root, path);
  return node.children.length ? path + node.children[0].id : path;
}

// ---------------------------------------------------------------------------
// Figurine notation: replace the piece letter in SAN with a chess glyph.
// ---------------------------------------------------------------------------
const GLYPH: Record<string, string> = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" };
export function figurine(san: string): string {
  return san.replace(/^[KQRBN]/, (c) => GLYPH[c]).replace(/=([KQRBN])/, (_, c) => "=" + GLYPH[c]);
}

export type { Square };
