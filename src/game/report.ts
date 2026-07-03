import { Chess, type Square } from "chess.js";
import type { Engine, EngineInfo } from "../engines/Engine";
import { OPENINGS } from "../openings";
import { normalizePgn } from "./pgn";

// Move classification.
//
// Approach follows the well-documented chess.com / freechess (WintrChess)
// method, reimplemented here from the public definitions (we do NOT vendor the
// CC-BY-NC-SA freechess source):
//   - centipawn-loss tiers for best/good/inaccuracy/mistake/blunder
//   - "brilliant"  = a Best move that sacrifices material (≥ a minor) with
//     compensation, while not losing and not already completely winning
//   - "sharp/great" = a Best move that is the *only* good move (large gap to the
//     second-best move) in a critical position
export type MoveClass =
  | "book"
  | "brilliant"
  | "sharp"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export const CLASS_META: Record<MoveClass, { label: string; icon: string; color: string }> = {
  book: { label: "Book", icon: "📖", color: "#9b8b7a" },
  brilliant: { label: "Brilliant", icon: "!!", color: "#26c6b3" },
  sharp: { label: "Great", icon: "!", color: "#5b9bd5" },
  best: { label: "Best", icon: "★", color: "#7bbf5a" },
  excellent: { label: "Excellent", icon: "👍", color: "#6aa84f" },
  good: { label: "Good", icon: "✓", color: "#8bb38b" },
  inaccuracy: { label: "Inaccuracy", icon: "?!", color: "#e0b03b" },
  mistake: { label: "Mistake", icon: "?", color: "#e08a3b" },
  blunder: { label: "Blunder", icon: "??", color: "#d05656" },
};

export const CLASS_ORDER: MoveClass[] = [
  "book",
  "brilliant",
  "sharp",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
];

export interface ReportMove {
  ply: number;
  san: string;
  color: "w" | "b";
  evalCp: number; // after the move, White POV
  cpLoss: number;
  classification: MoveClass;
  /** SAN of the engine's best move in the position before this move. */
  best?: string;
  /** The engine's best line (SAN) from the position before this move. */
  bestLine?: string[];
  /**
   * The "punishment" line (SAN) from the position AFTER this move — how the
   * opponent exploits it. Shown so the user can play through exactly what goes
   * wrong. Only set for inaccuracy/mistake/blunder.
   */
  refutation?: string[];
  /**
   * Plain-language reason this move was an inaccuracy/mistake/blunder, derived
   * from the engine's refutation line + board logic (hung piece, allowed mate,
   * missed win, fork…). Undefined when no concrete tactical cause was found —
   * explainMove() then falls back to the generic per-class text.
   */
  reason?: string;
}

/** Human-readable explanation of a classified move (for the toast). */
export function explainMove(m: ReportMove): { title: string; message: string } {
  const { mover } = sideWords(m.color);
  const base: Record<MoveClass, string> = {
    brilliant: "A brilliant move — a sound sacrifice the engine confirms is best.",
    sharp: "A great move — critical to the outcome (the only good move).",
    best: "The best move available.",
    excellent: "An excellent move — nearly optimal.",
    good: "A solid, reasonable move.",
    book: "A known opening (book) move.",
    inaccuracy: "A slight inaccuracy — a better move was available.",
    mistake: `A mistake — it hands back some of ${mover}'s advantage.`,
    blunder: `A blunder — ${mover} loses significant advantage or material.`,
  };
  const isBad =
    m.classification === "inaccuracy" || m.classification === "mistake" || m.classification === "blunder";
  // A concrete tactical reason (computed at report time) replaces the generic
  // text entirely — it already names the best move where relevant.
  if (isBad && m.reason) {
    return { title: CLASS_META[m.classification].label, message: m.reason };
  }
  let message = base[m.classification];
  if (m.best && isBad) {
    message += ` Best was ${m.best}.`;
  }
  return { title: CLASS_META[m.classification].label, message };
}

export interface PlayerReport {
  accuracy: number;
  counts: Record<MoveClass, number>;
}

export interface GameReport {
  moves: ReportMove[];
  evals: number[];
  white: PlayerReport;
  black: PlayerReport;
  opening: string;
}

const MATE_CP = 2000;
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Win probability (0–100) from centipawns. An Elo-style logistic that's steeper
// than lichess's curve, so eval swings translate to bigger expected-points
// changes — matching chess.com's stricter classification & accuracy.
/** Win probability (0–100) from centipawns — also drives the report graph. */
export function winPct(cp: number): number {
  return 100 / (1 + Math.pow(10, -cp / 340));
}
function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
}

// chess.com classifies by EXPECTED POINTS lost (win-probability, 0–1), not raw
// centipawns — so a small eval swing matters in an equal position but not when
// already winning. (Best is handled separately: it's the engine's top move.)
//   Excellent ≤0.02 · Good ≤0.05 · Inaccuracy ≤0.10 · Mistake ≤0.20 · Blunder >0.20
function classifyByExpectedLoss(epLoss: number): MoveClass {
  if (epLoss <= 0.02) return "excellent";
  if (epLoss <= 0.05) return "good";
  if (epLoss <= 0.1) return "inaccuracy";
  if (epLoss <= 0.2) return "mistake";
  return "blunder";
}

// Verdicts name the side that moved ("White"/"Black") rather than addressing
// "you" — the move being graded may be either player's (in analysis, or the
// bot's during coached play), so second person is ambiguous and confusing.
function sideWords(color: "w" | "b"): { mover: string; opp: string } {
  return color === "w" ? { mover: "White", opp: "Black" } : { mover: "Black", opp: "White" };
}

/** "1 point" / "3 points" — material is counted in pawns (Q=9, R=5, B/N=3). */
const points = (n: number) => `${n} point${n === 1 ? "" : "s"}`;

function bookPlies(sans: string[]): { count: number; name: string } {
  let best = { count: 0, name: "" };
  for (const o of OPENINGS) {
    let n = 0;
    while (n < o.moves.length && n < sans.length && o.moves[n] === sans[n]) n++;
    if (n === o.moves.length && n > best.count) best = { count: n, name: `${o.eco}: ${o.name}` };
  }
  return best;
}

interface ParsedGame {
  start: string;
  sans: string[];
  uci: string[];
  fens: string[];
  colors: ("w" | "b")[];
}

export function parseGameForReport(pgn: string): ParsedGame | null {
  const c = new Chess();
  try {
    c.loadPgn(normalizePgn(pgn));
  } catch {
    return null;
  }
  const v = c.history({ verbose: true }) as Array<{
    san: string; from: string; to: string; promotion?: string; color: "w" | "b"; before: string; after: string;
  }>;
  if (v.length === 0) return null;
  return {
    start: v[0].before,
    sans: v.map((m) => m.san),
    uci: v.map((m) => m.from + m.to + (m.promotion ?? "")),
    fens: [v[0].before, ...v.map((m) => m.after)],
    colors: v.map((m) => m.color),
  };
}

function evalWhiteCp(cp: number | undefined, mate: number | undefined, whiteToMove: boolean): number {
  if (mate !== undefined) return (whiteToMove ? mate : -mate) > 0 ? MATE_CP : -MATE_CP;
  const c = cp ?? 0;
  return whiteToMove ? c : -c;
}

interface PosEval {
  white: number; // best line, White POV
  bestMove: string | null; // uci
  bestPv: string[]; // best line (uci) from this position
  secondWhite: number | null; // second line, White POV
  mateWhite: number | null; // forced-mate distance, White POV (+ white mates, − white mated); null if no mate
}

/** Convert a UCI PV into SAN moves played from `fen`. */
function pvToSan(fen: string, pv: string[], max = 12): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    let m;
    try {
      m = c.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] as "q") ?? "q" });
    } catch {
      break;
    }
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/** Value of the piece (if any) the move at index i captured. */
function capturedValue(game: ParsedGame, i: number): number {
  const to = game.uci[i].slice(2, 4) as Square;
  const p = new Chess(game.fens[i]).get(to);
  return p ? PIECE_VALUE[p.type] : 0;
}

/**
 * True if, after the player's move, the opponent has a favorable capture of one
 * of the player's pieces worth ≥ a minor (a genuine sacrifice). Static 1-ply
 * exchange check, so it works even if the opponent declines or the game ends on
 * the sac. Trades (we already won equal/greater material) don't count.
 */
function isSacrifice(game: ParsedGame, i: number): boolean {
  const fenAfter = game.fens[i + 1];
  const wonByUs = capturedValue(game, i);
  let maxGain = 0;
  const board = new Chess(fenAfter); // opponent to move
  for (const mv of board.moves({ verbose: true }) as Array<{
    from: string; to: string; piece: string; captured?: string; promotion?: string;
  }>) {
    if (!mv.captured) continue;
    const victim = PIECE_VALUE[mv.captured]; // our piece they'd win
    if (victim < 3 || victim <= wonByUs) continue; // ignore pawns and fair trades
    const sim = new Chess(fenAfter);
    try {
      sim.move({ from: mv.from as Square, to: mv.to as Square, promotion: (mv.promotion as "q") ?? "q" });
    } catch {
      continue;
    }
    const canRecapture = (sim.moves({ verbose: true }) as Array<{ to: string }>).some((m) => m.to === mv.to);
    const gain = victim - (canRecapture ? PIECE_VALUE[mv.piece] : 0);
    if (gain > maxGain) maxGain = gain;
  }
  // Require a genuine minor-piece-or-more sacrifice (≥3). Exchange-sac noise
  // (rook for minor ≈ 2) is "Great", not "Brilliant" — this keeps brilliants rare.
  return maxGain >= 3;
}

const PIECE_WORD: Record<string, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};
const pieceWord = (t: string) => PIECE_WORD[t] ?? "piece";

/** Plain-word assessment of a position from the mover's POV (centipawns). */
function assess(cp: number): string {
  if (cp >= 500) return "winning";
  if (cp >= 200) return "clearly better";
  if (cp >= 80) return "slightly better";
  if (cp > -80) return "about equal";
  if (cp > -200) return "slightly worse";
  if (cp > -500) return "clearly worse";
  return "losing";
}

/** Total material value of one side on the board. */
function materialOf(c: Chess, color: "w" | "b"): number {
  let sum = 0;
  for (const row of c.board()) for (const p of row) if (p && p.color === color) sum += PIECE_VALUE[p.type];
  return sum;
}

/** The most valuable piece type `color` has fewer of at `leaf` than at `start`. */
function biggestLostPiece(start: Chess, leaf: Chess, color: "w" | "b"): string | null {
  const count = (c: Chess) => {
    const m: Record<string, number> = {};
    for (const row of c.board()) for (const p of row) if (p && p.color === color) m[p.type] = (m[p.type] ?? 0) + 1;
    return m;
  };
  const cs = count(start), cl = count(leaf);
  let best: string | null = null;
  let bestVal = -1;
  for (const t of Object.keys(cs)) {
    if ((cs[t] ?? 0) - (cl[t] ?? 0) > 0 && PIECE_VALUE[t] > bestVal) { bestVal = PIECE_VALUE[t]; best = t; }
  }
  return best;
}

/**
 * Remove the piece on `sq` and return a sanitised FEN, or null if the result is
 * illegal. Castling/en-passant are cleared (removal can invalidate them and they
 * barely affect the eval), and we reject positions where the mover's king would
 * be left in check on the opponent's move.
 */
function removePiece(fen: string, sq: Square, moverColor: "w" | "b"): string | null {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return null;
  }
  if (!c.remove(sq)) return null;
  const parts = c.fen().split(" ");
  parts[2] = "-";
  parts[3] = "-";
  const clean = parts.join(" ");
  // Illegal if removing this piece exposes the mover's own king to check while
  // it's still the opponent's turn (e.g. a discovered attack).
  const flip = [...parts];
  flip[1] = moverColor;
  try {
    if (new Chess(flip.join(" ")).isCheck()) return null;
    new Chess(clean); // final legality gate
  } catch {
    return null;
  }
  return clean;
}

/**
 * Can the side `byColor` profitably capture the piece on `sq` in position `b`?
 * Used to reject "forks" whose forking piece is just hanging — the defender
 * takes it and there's no fork at all (e.g. a knight that lands on e3 forking
 * two pieces but is met by a simple fxe3).
 */
function canCaptureSafely(b: Chess, sq: Square, byColor: "w" | "b"): boolean {
  const target = b.get(sq);
  if (!target) return false;
  const targetVal = PIECE_VALUE[target.type];
  const opp: "w" | "b" = byColor === "w" ? "b" : "w";
  const defended = b.attackers(sq, opp).length > 0;
  let cheapest = Infinity;
  for (const aSq of b.attackers(sq, byColor)) {
    const p = b.get(aSq as Square);
    if (!p) continue;
    if (p.type === "k" && defended) continue; // the king can't take a defended piece
    cheapest = Math.min(cheapest, PIECE_VALUE[p.type]);
  }
  if (cheapest === Infinity) return false; // no (legal) capturer
  if (!defended) return true; // capture it for free
  return cheapest <= targetVal; // capture trades evenly or wins → threat is defused
}

/**
 * Mover pieces (word + value) that the piece landing on `uci`'s target square
 * attacks after `uci` is played from `fen` — i.e. the prongs of a fork/double
 * attack created by that move. `moverColor` is the side being forked. Returns
 * [] when the forking piece can simply be captured (then it isn't a real fork).
 */
function forkTargets(fen: string, uci: string, moverColor: "w" | "b"): Array<{ word: string; val: number; type: string }> {
  const to = uci.slice(2, 4) as Square;
  const b = new Chess(fen);
  try {
    if (!b.move({ from: uci.slice(0, 2) as Square, to, promotion: (uci[4] as "q") ?? "q" })) return [];
  } catch {
    return [];
  }
  // If the mover can just take the forking piece, it's not a fork.
  if (canCaptureSafely(b, to, moverColor)) return [];
  const opp = moverColor === "w" ? "b" : "w";
  const hits: Array<{ word: string; val: number; type: string }> = [];
  for (const file of "abcdefgh") {
    for (const rank of "12345678") {
      const sq = (file + rank) as Square;
      const p = b.get(sq);
      if (!p || p.color !== moverColor) continue;
      // Only count it as a prong if the freshly-moved piece (on `to`) attacks it.
      if (b.attackers(sq, opp).includes(to)) hits.push({ word: pieceWord(p.type), val: PIECE_VALUE[p.type], type: p.type });
    }
  }
  return hits;
}

/**
 * What VERIFIABLY happens to `side` when the engine's PV is played out from
 * `fen`. Every claim a verdict makes must be corroborated against this: the
 * refutation line is exactly what the user steps through ("see how it's
 * punished"), so the words and the line must tell the same story — a static
 * one-ply guess ("this hangs your queen") is worthless if the line itself shows
 * the queen escaping or the material coming back.
 */
interface PvFacts {
  /** How many PV plies actually replayed. */
  plies: number;
  /** `side`'s NET material loss over the line, in points (can be negative = side gains). */
  drop: number;
  /** Most valuable `side` piece that is actually gone at the end of the line. */
  lost: string | null;
  /** 0-based ply at which that piece was captured (-1 if unknown). */
  lostAt: number;
  /** The line ends with `side` checkmated. */
  mated: boolean;
  /** `side`'s opponent promotes a pawn somewhere in the line. */
  oppPromotes: boolean;
}

function pvFacts(fen: string, pv: string[], side: "w" | "b", max = 12): PvFacts | null {
  let start: Chess;
  try {
    start = new Chess(fen);
  } catch {
    return null;
  }
  const leaf = new Chess(fen);
  const opp: "w" | "b" = side === "w" ? "b" : "w";
  let plies = 0;
  let oppPromotes = false;
  const capturedAt: Record<string, number> = {}; // side's piece type → first ply it was taken
  for (const u of pv.slice(0, max)) {
    let mv;
    try {
      mv = leaf.move({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: (u[4] as "q") ?? "q" });
    } catch {
      break;
    }
    if (!mv) break;
    if (mv.captured && mv.color === opp && capturedAt[mv.captured] === undefined) capturedAt[mv.captured] = plies;
    if (mv.promotion && mv.color === opp) oppPromotes = true;
    plies++;
  }
  if (!plies) return null;
  const drop =
    materialOf(start, side) - materialOf(start, opp) - (materialOf(leaf, side) - materialOf(leaf, opp));
  const lost = biggestLostPiece(start, leaf, side);
  return {
    plies,
    drop,
    lost,
    lostAt: lost != null && capturedAt[lost] !== undefined ? capturedAt[lost] : -1,
    mated: leaf.isCheckmate() && leaf.turn() === side,
    oppPromotes,
  };
}

/**
 * Concrete reason a sub-par move was bad, derived from the engine's own lines
 * plus board logic. Returns undefined when no concrete cause is found — the
 * caller then probes (counterfactual) and finally falls back to evalSwingReason.
 *
 * Every claim is CORROBORATED against the engine's refutation PV (see pvFacts)
 * so the message and the "see how it's punished" line always tell the same
 * story. Priority: allowed mate → missed mate → PV mate → promotion →
 * confirmed fork → net material loss (immediate/slow, compensation-aware) →
 * missed material win (confirmed from the best line).
 */
function buildReason(
  game: ParsedGame,
  i: number,
  posEvals: PosEval[],
  color: "w" | "b",
  moverMateBefore: number | null,
  moverMateAfter: number | null,
  bestSan: string | undefined,
): string | undefined {
  const fenBefore = game.fens[i];
  const fenAfter = game.fens[i + 1];
  const refUci = posEvals[i + 1].bestMove; // opponent's best reply to the played move
  const refSan = refUci ? pvToSan(fenAfter, [refUci], 1)[0] : undefined;
  const bestTail = bestSan ? ` Best was ${bestSan}.` : "";
  const { mover, opp } = sideWords(color);

  // How many points the move actually cost, from the engine's own eval swing
  // (mover's POV). This is the NET — it already accounts for material won back
  // in the exchange (e.g. a queen given up for a rook reads as ~4, not ~9), so
  // it's a truer figure than counting one capture on a square.
  const beforeMover = color === "w" ? posEvals[i].white : -posEvals[i].white;
  const afterMover = color === "w" ? posEvals[i + 1].white : -posEvals[i + 1].white;
  const lostPts = Math.round(Math.max(0, beforeMover - afterMover) / 100);

  // Allowed a forced mate that wasn't already being forced.
  if (moverMateAfter != null && moverMateAfter < 0 && !(moverMateBefore != null && moverMateBefore < 0)) {
    const n = Math.abs(moverMateAfter);
    return `This lets ${opp} force checkmate in ${n}${refSan ? `, starting with ${refSan}` : ""}.${bestTail}`;
  }
  // Threw away a forced mate that was available.
  if (moverMateBefore != null && moverMateBefore > 0 && !(moverMateAfter != null && moverMateAfter > 0)) {
    return bestSan
      ? `${mover} had a forced checkmate here — ${bestSan} would have mated in ${moverMateBefore}.`
      : `${mover} had a forced checkmate in ${moverMateBefore} here and let it slip.`;
  }
  // Ground truth: replay the engine's refutation line ONCE and read what
  // verifiably happens in it. Every story below must match these facts — the
  // refutation is exactly what the user steps through, so a claim the line
  // doesn't corroborate ("hangs your queen" when the queen escapes, "fork" when
  // both pieces are saved) must never be shown. `net` folds in what the played
  // move itself captured: taking a knight and losing the queen costs ~6, not 9.
  const facts = posEvals[i + 1].bestPv?.length ? pvFacts(fenAfter, posEvals[i + 1].bestPv, color) : null;
  const wonByPlayed = capturedValue(game, i);
  const net = facts ? Math.round(facts.drop - wonByPlayed) : 0;

  // Backup mate detection: the refutation line itself ends in checkmate (the
  // eval-based branches above normally catch this via mate scores).
  if (facts?.mated) {
    return `This runs into a forced checkmate${refSan ? `, starting with ${refSan}` : ""}.${bestTail}`;
  }
  // A passed pawn queens somewhere in the punishing line.
  if (facts?.oppPromotes) {
    return `This lets ${opp}'s pawn march down and become a new queen${refSan ? ` — it starts with ${refSan}` : ""}.${bestTail}`;
  }
  // Fork / double attack — only when the line CONFIRMS a prong actually falls.
  // The king counts as a prong (fork-with-check) since it can't be defended.
  if (refUci && facts && facts.lostAt >= 1 && net >= 2) {
    const all = forkTargets(fenAfter, refUci, color);
    const hasKing = all.some((h) => h.type === "k");
    const heavy = all.filter((h) => h.val >= 3).sort((a, b) => b.val - a.val);
    const fallen = heavy.find((h) => h.type === facts.lost);
    if (fallen && hasKing) {
      return `This lets ${refSan ?? opp} attack ${mover}'s king and ${fallen.word} at the same time — the king must move, and the ${fallen.word} falls (about ${points(net)}).${bestTail}`;
    }
    if (fallen && heavy.length >= 2) {
      return `This lets ${refSan ?? opp} attack ${mover}'s ${heavy[0].word} and ${heavy[1].word} at once — only one can be saved, and the line wins the ${fallen.word} (about ${points(net)}).${bestTail}`;
    }
  }
  // Material verdict from the line itself: which piece actually falls, when,
  // and the NET cost after everything won back (including by the played move).
  if (facts && facts.lost && net >= 1) {
    const v = pieceWord(facts.lost);
    const lostVal = PIECE_VALUE[facts.lost];
    const immediate = facts.lostAt === 0; // the very next move takes it
    const take = refSan ?? "the reply";
    if (lostVal <= 1) {
      return immediate
        ? `This drops a pawn — ${take} just takes it.${bestTail}`
        : `This loses a pawn over the next few moves${refSan ? ` — it starts with ${refSan}` : ""}.${bestTail}`;
    }
    if (net >= lostVal - 1) {
      // Costs roughly the whole piece — a genuine hang / trap.
      return immediate
        ? `This hangs ${mover}'s ${v} — ${take} wins it, about ${points(net)} down.${bestTail}`
        : `This loses ${mover}'s ${v} a few moves later${refSan ? ` — it starts with ${refSan}` : ""}, about ${points(net)} down.${bestTail}`;
    }
    // The piece falls but real material comes back (the played move's own
    // capture and/or the line's recaptures) — state the net, never the piece.
    return immediate
      ? `${take} wins ${mover}'s ${v}; ${mover} gets material back for it, but still ends about ${points(net)} down.${bestTail}`
      : `${mover}'s ${v} falls in the line${refSan ? ` starting with ${refSan}` : ""}; even with material back, ${mover} ends about ${points(net)} down.${bestTail}`;
  }
  // Missed win: the engine's best move led to a concrete gain — corroborated by
  // replaying the BEST line, not guessed from its first move's target square.
  const bUci = posEvals[i].bestMove;
  if (bUci && bUci.slice(0, 4) !== game.uci[i].slice(0, 4) && lostPts >= 2) {
    const oppC: "w" | "b" = color === "w" ? "b" : "w";
    const bf = posEvals[i].bestPv?.length ? pvFacts(fenBefore, posEvals[i].bestPv, oppC) : null;
    if (bf?.mated) {
      return `${mover} missed ${bestSan ?? "a stronger move"} — it leads to a forced checkmate.`;
    }
    if (bf && bf.drop >= 2) {
      const what = bf.lost ? `${opp}'s ${pieceWord(bf.lost)}` : "material";
      return `${mover} missed ${bestSan ?? "a stronger move"} — it wins ${what} (about ${points(Math.round(bf.drop))}).`;
    }
  }
  return undefined; // no concrete cause — caller probes, then uses eval-swing text
}

/**
 * Soft fallback when no concrete cause is found: there's no single tactic to
 * point at, so explain the *consequence* in plain, everyday words. We don't
 * claim a specific reason we can't prove.
 */
function evalSwingReason(
  beforeMover: number,
  afterMover: number,
  bestSan: string | undefined,
  color: "w" | "b",
): string | undefined {
  const { mover, opp } = sideWords(color);
  const before = assess(beforeMover);
  const after = assess(afterMover);
  if (before === after) {
    // A tiny slip within the same bucket — reassure, don't overstate.
    return bestSan
      ? `Only a small slip — ${bestSan} was a bit more precise, but ${mover}'s position is still ${after}.`
      : undefined;
  }
  // A real drop, but from a quiet move with no single tactic behind it.
  const tail = bestSan ? ` ${bestSan} would have kept things ${before}.` : "";
  return `Nothing is lost right away, but this quietly hands ${opp} the edge — ${mover}'s position goes from ${before} to ${after}.${tail}`;
}

/**
 * Read the concrete outcome at the end of an engine line played from `fenAfter`
 * (the position after the blunder). Returns a short reason + the SAN line to
 * show the user, or null if the line resolves nothing concrete. This is the
 * "run the moves forward and see what actually happens" step.
 */
function lineOutcome(
  fenAfter: string,
  pv: string[],
  color: "w" | "b",
): { reason: string; line: string[] } | null {
  if (!pv || pv.length < 4) return null;
  const opp: "w" | "b" = color === "w" ? "b" : "w";
  const start = new Chess(fenAfter);
  const leaf = new Chess(fenAfter);
  const san: string[] = [];
  let promoByOpp = false;
  for (const u of pv.slice(0, 24)) {
    let mv;
    try {
      mv = leaf.move({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, promotion: (u[4] as "q") ?? "q" });
    } catch {
      break;
    }
    if (!mv) break;
    san.push(mv.san);
    if (mv.promotion && mv.color === opp) promoByOpp = true;
  }
  if (san.length < 4) return null;
  const line = san.slice(0, 8);

  const { mover, opp: oppName } = sideWords(color);
  // The line forces mate against the mover.
  if (leaf.isCheckmate() && leaf.turn() === color) {
    return { reason: `this forces checkmate against ${mover}`, line };
  }
  // A passed pawn queens.
  if (promoByOpp) {
    return { reason: `${mover} can't stop ${oppName}'s pawn from becoming a new queen`, line };
  }
  // The mover comes out materially worse by the end of the forcing line.
  const drop =
    materialOf(start, color) - materialOf(start, opp) - (materialOf(leaf, color) - materialOf(leaf, opp));
  if (drop >= 2) {
    const lost = biggestLostPiece(start, leaf, color);
    return lost
      ? { reason: `${mover} ends up losing the ${pieceWord(lost)} (about ${points(Math.round(drop))})`, line }
      : { reason: `${mover} ends up about ${points(Math.round(drop))} down on material`, line };
  }
  return null;
}

/**
 * Counterfactual probe (last resort, costs engine searches). Re-evaluate the
 * post-move position with each candidate opponent piece removed; the removal
 * that most improves the mover's eval names the piece that's really hurting
 * them. Returns a reason, or undefined when nothing dominates.
 */
async function probeReason(
  engine: Engine,
  fenAfter: string,
  color: "w" | "b", // the mover (the worse side)
  bestSan: string | undefined,
  limits: { depth: number; movetime: number },
  signal?: AbortSignal,
): Promise<string | undefined> {
  const opp: "w" | "b" = color === "w" ? "b" : "w";
  const board = new Chess(fenAfter);

  // fenAfter has the opponent to move, so scoreCp is opponent-POV → mover = −cp.
  const moverCpOf = (l: EngineInfo | undefined): number | null =>
    !l ? null : l.scoreMate !== undefined ? (l.scoreMate > 0 ? -MATE_CP : MATE_CP) : -(l.scoreCp ?? 0);

  // Baseline at the SAME reduced depth as the probes, so the comparison is fair
  // (the report's eval was searched deeper and isn't directly comparable).
  let baselineMoverCp: number;
  try {
    const base = await engine.search(fenAfter, { multipv: 1, depth: limits.depth, movetime: limits.movetime });
    const b = moverCpOf(base.find((l) => l.multipv === 1));
    if (b == null) return undefined;
    baselineMoverCp = b;
  } catch {
    return undefined;
  }

  // Candidates: opponent pieces (not the king) and advanced/passed pawns only.
  let candidates: Array<{ sq: Square; type: string }> = [];
  for (const row of board.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== opp || cell.type === "k") continue;
      if (cell.type === "p") {
        const rank = Number(cell.square[1]);
        const advanced = opp === "w" ? rank >= 5 : rank <= 4;
        if (!advanced) continue;
      }
      candidates.push({ sq: cell.square as Square, type: cell.type });
    }
  }
  // Bound the work: prefer the heavier/more-advanced pieces, cap the count.
  candidates.sort((a, b) => PIECE_VALUE[b.type] - PIECE_VALUE[a.type]);
  candidates = candidates.slice(0, 12);

  // Removing ANY piece helps the mover by roughly its material value, so raw
  // gain says nothing — a queen removal "gains" ~900 in every position. A piece
  // is only THE problem when removing it helps far beyond its face value (its
  // threats, not its material, are what hurt) — rank by that excess.
  let best: { sq: Square; type: string; excess: number; moverCp: number } | null = null;
  for (const cand of candidates) {
    if (signal?.aborted) return undefined;
    const perturbed = removePiece(fenAfter, cand.sq, color);
    if (!perturbed) continue;
    let lines: EngineInfo[];
    try {
      lines = await engine.search(perturbed, { multipv: 1, depth: limits.depth, movetime: limits.movetime });
    } catch {
      continue;
    }
    const moverCp = moverCpOf(lines.find((l) => l.multipv === 1));
    if (moverCp == null) continue;
    const excess = moverCp - baselineMoverCp - PIECE_VALUE[cand.type] * 100;
    if (!best || excess > best.excess) best = { sq: cand.sq, type: cand.type, excess, moverCp };
  }
  // Only claim it when the piece clearly punches above its weight AND the
  // "you'd be fine without it" part is actually true of the probed position —
  // never assert "about equal" the engine didn't show.
  if (!best || best.excess < 200 || best.moverCp < -100) return undefined;
  const bestTail = bestSan ? ` Best was ${bestSan}.` : "";
  const where = best.type === "p" ? `pawn on ${best.sq}` : pieceWord(best.type);
  const standing = Math.abs(best.moverCp) <= 100 ? "the game would be about equal" : `${sideWords(color).mover} would be doing well`;
  return `${sideWords(color).opp}'s ${where} is the real problem here — without it on the board, ${standing}.${bestTail}`;
}

export interface ReportOptions {
  depth: number;
  movetime: number;
  /** How many engine workers to run in parallel (positions are independent). */
  concurrency?: number;
  /** Don't quit the engines when done (the caller owns/reuses them). */
  keepAlive?: boolean;
  /**
   * Counterfactual probing for positional mistakes/blunders with no concrete
   * tactical cause (extra engine searches on a few moves). Defaults to on.
   */
  probe?: boolean;
}

export async function generateReport(
  makeEngine: () => Engine,
  game: ParsedGame,
  opts: ReportOptions,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<GameReport> {
  const total = game.fens.length;
  // Positions are independent, so analyze them across a pool of single-threaded
  // engine workers — ~Nx faster on an N-core device, no SharedArrayBuffer needed.
  const poolSize = Math.max(1, Math.min(opts.concurrency ?? 1, total));
  const pool = Array.from({ length: poolSize }, () => makeEngine());
  await Promise.all(pool.map((e) => e.init()));

  const posEvals: PosEval[] = new Array(total);
  let next = 0;
  let done = 0;

  // Cancellation: stop the engines so any in-flight search resolves, letting the
  // workers exit promptly when the caller aborts (e.g. loads a different game).
  const onAbort = () => pool.forEach((e) => { try { e.stop(); } catch { /* ignore */ } });
  signal?.addEventListener("abort", onAbort);

  // Each worker pulls the next position index until the queue is drained.
  const runWorker = async (engine: Engine) => {
    while (true) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= total) return;
      const fen = game.fens[i];
      const whiteToMove = fen.split(" ")[1] !== "b";
      const { best, second } = await evaluatePosition(engine, fen, opts.depth, opts.movetime);
      if (signal?.aborted) return;
      posEvals[i] = {
        white: evalWhiteCp(best.cp, best.mate, whiteToMove),
        bestMove: best.pv[0] ?? null,
        bestPv: best.pv,
        secondWhite: second ? evalWhiteCp(second.cp, second.mate, whiteToMove) : null,
        mateWhite: best.mate !== undefined ? (whiteToMove ? best.mate : -best.mate) : null,
      };
      onProgress(++done, total);
    }
  };

  try {
    await Promise.all(pool.map((e) => runWorker(e)));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  // Aborted partway → don't classify a half-filled report; let the caller bail.
  // (Keep the pool alive through the classification + probing passes below.)
  if (signal?.aborted) {
    if (!opts.keepAlive) pool.forEach((e) => e.quit());
    throw new DOMException("Report cancelled", "AbortError");
  }

  const evals = posEvals.map((p) => p.white);
  const book = bookPlies(game.sans);

  const emptyCounts = (): Record<MoveClass, number> =>
    Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<MoveClass, number>;
  const wCounts = emptyCounts();
  const bCounts = emptyCounts();
  let wAcc = 0, wN = 0, bAcc = 0, bN = 0;

  const moves: ReportMove[] = [];
  const probeIdx: number[] = []; // positional mistakes/blunders queued for probing

  for (let i = 0; i < game.sans.length; i++) {
    const color = game.colors[i];
    const isWhite = color === "w";
    const before = evals[i];
    const after = evals[i + 1];
    const beforeMover = isWhite ? before : -before;
    const afterMover = isWhite ? after : -after;
    const secondMover =
      posEvals[i].secondWhite != null ? (isWhite ? posEvals[i].secondWhite! : -posEvals[i].secondWhite!) : null;

    const cpLoss = Math.max(0, beforeMover - afterMover);
    // Expected-points (win-probability) loss from the mover's perspective.
    const winBefore = winPct(beforeMover);
    const winAfter = winPct(afterMover);
    const epLoss = Math.max(0, (winBefore - winAfter) / 100);

    const played = game.uci[i];
    const isBest = !posEvals[i].bestMove || played.slice(0, 4) === posEvals[i].bestMove!.slice(0, 4);

    let cls: MoveClass;
    if (i < book.count) cls = "book";
    else if (isBest) cls = "best";
    else cls = classifyByExpectedLoss(epLoss);

    if (cls === "best") {
      const winningAlready = beforeMover >= 450 || (secondMover ?? -Infinity) >= 450;
      // Even a moderate lead makes a sac "good", not brilliant — a true brilliancy
      // comes from a roughly balanced (or worse) position.
      const clearlyAhead = beforeMover >= 250;
      const isPromo = game.sans[i].includes("=");

      // Brilliant: the best move sacrifices a real piece (≥ a minor) for
      // compensation, from a non-winning position, and you're not losing after.
      if (
        !clearlyAhead &&
        !isPromo &&
        afterMover >= -50 &&
        secondMover != null &&
        isSacrifice(game, i)
      ) {
        cls = "brilliant";
      } else if (
        // Great: the only good move — clearly best, every alternative much worse,
        // and the position is genuinely critical (not already winning).
        !winningAlready &&
        secondMover != null &&
        beforeMover - secondMover >= 250 &&
        afterMover >= -100
      ) {
        cls = "sharp";
      }
    }

    const acc = moveAccuracy(winBefore, winAfter);
    if (isWhite) { wCounts[cls]++; wAcc += acc; wN++; }
    else { bCounts[cls]++; bAcc += acc; bN++; }

    // SAN of the engine's best move (for the explanation toast).
    let bestSan: string | undefined;
    const bestUci = posEvals[i].bestMove;
    if (bestUci) {
      try {
        const c = new Chess(game.fens[i]);
        bestSan = c.move({ from: bestUci.slice(0, 2) as Square, to: bestUci.slice(2, 4) as Square, promotion: (bestUci[4] as "q") ?? "q" })?.san;
      } catch {
        /* leave undefined */
      }
    }

    const bestLine = pvToSan(game.fens[i], posEvals[i].bestPv);

    // Concrete "why" for sub-par moves, from the engine's lines + board logic.
    // No concrete cause → soft eval-swing text now; for mistakes/blunders also
    // queue a counterfactual probe (second pass) to try for a sharper reason.
    let reason: string | undefined;
    let refutation: string[] | undefined;
    if (cls === "inaccuracy" || cls === "mistake" || cls === "blunder") {
      // The opponent's punishment line from the position after this move — shown
      // so the user can play through exactly what goes wrong.
      refutation = pvToSan(game.fens[i + 1], posEvals[i + 1].bestPv, 12);
      const mw = (e: PosEval) => (e.mateWhite == null ? null : isWhite ? e.mateWhite : -e.mateWhite);
      reason = buildReason(game, i, posEvals, color, mw(posEvals[i]), mw(posEvals[i + 1]), bestSan);
      if (!reason) {
        reason = evalSwingReason(beforeMover, afterMover, bestSan, color);
        if (cls === "mistake" || cls === "blunder") probeIdx.push(i);
      }
    }

    moves.push({ ply: i + 1, san: game.sans[i], color, evalCp: after, cpLoss, classification: cls, best: bestSan, bestLine, reason, refutation });
  }

  // Second pass: counterfactual probing to sharpen the reason for residual
  // positional mistakes/blunders. Reuses the pool, bounded and best-effort; the
  // eval-swing fallback already set above stands if a probe finds nothing.
  try {
    if (opts.probe !== false && probeIdx.length && !signal?.aborted) {
      const targets = probeIdx.slice(0, 24); // bound the total probed positions
      // Deepen the forcing line a bit beyond the eval depth so it resolves into a
      // concrete outcome we can name (a promotion, a won piece, a mate).
      const lineLimits = { depth: Math.min(opts.depth + 6, 22), movetime: Math.min(opts.movetime * 2, 2500) };
      // Piece-removal probe is the cheaper fallback when the line stays murky.
      const removeLimits = { depth: Math.min(opts.depth, 10), movetime: Math.min(opts.movetime, 400) };
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      let pn = 0;
      const probeWorker = async (engine: Engine) => {
        while (true) {
          if (signal?.aborted) return;
          const k = pn++;
          if (k >= targets.length) return;
          const m = moves[targets[k]];
          const fenAfter = game.fens[targets[k] + 1];
          const bestTail = m.best ? ` Best was ${m.best}.` : "";
          try {
            // 1. Play the line forward and read what concretely happens at its end.
            const lines = await engine.search(fenAfter, { multipv: 1, depth: lineLimits.depth, movetime: lineLimits.movetime });
            const pv = lines.find((l) => l.multipv === 1)?.pv ?? [];
            const outcome = lineOutcome(fenAfter, pv, m.color);
            if (outcome) {
              m.reason = `${cap(outcome.reason)}.${bestTail}`;
              m.refutation = outcome.line; // show this concrete line instead
              continue;
            }
            // 2. Otherwise, counterfactual probe to name the dominant piece.
            const r = await probeReason(engine, fenAfter, m.color, m.best, removeLimits, signal);
            if (r) m.reason = r;
          } catch {
            /* keep the eval-swing fallback */
          }
        }
      };
      await Promise.all(pool.map((e) => probeWorker(e)));
    }
  } finally {
    if (!opts.keepAlive) pool.forEach((e) => e.quit());
  }

  return {
    moves,
    evals,
    opening: book.name,
    white: { accuracy: wN ? wAcc / wN : 100, counts: wCounts },
    black: { accuracy: bN ? bAcc / bN : 100, counts: bCounts },
  };
}

async function evaluatePosition(
  engine: Engine,
  fen: string,
  depth: number,
  movetime: number,
): Promise<{ best: { cp?: number; mate?: number; pv: string[] }; second: { cp?: number; mate?: number } | null }> {
  // Search to a fixed depth for stable, accurate evals (a 250ms budget is too
  // shallow and under-counts mistakes). A movetime cap guards against hangs.
  const lines = await engine.search(fen, { multipv: 2, depth, movetime });
  const l1 = lines.find((l) => l.multipv === 1);
  const l2 = lines.find((l) => l.multipv === 2);
  return {
    best: { cp: l1?.scoreCp, mate: l1?.scoreMate, pv: l1?.pv ?? [] },
    second: l2 ? { cp: l2.scoreCp, mate: l2.scoreMate } : null,
  };
}

// ---------------------------------------------------------------------------
// Live single-move coaching (Play mode). A lighter, synchronous cousin of
// generateReport: classify + explain ONE just-played move from quick engine
// evals of the positions before and after it. Reuses the same classification
// and reason machinery — no brilliancy/book/probing (kept cheap for live use).
// ---------------------------------------------------------------------------

/** Engine readout of one position, from the side-to-move's perspective. */
export interface PosInfo {
  cp?: number;
  mate?: number;
  bestUci: string | null;
  pv: string[];
}

export interface SingleMoveVerdict {
  classification: MoveClass;
  cpLoss: number;
  reason?: string;
  /** SAN of the engine's best move in the position before the move. */
  best?: string;
  /** UCI of that best move (for drawing a board arrow). */
  bestUci?: string;
  bestLine?: string[];
  refutation?: string[];
}

export function explainSingleMove(args: {
  fenBefore: string;
  fenAfter: string;
  playedUci: string;
  playedSan: string;
  color: "w" | "b";
  before: PosInfo;
  after: PosInfo;
}): SingleMoveVerdict {
  const { fenBefore, fenAfter, playedUci, playedSan, color, before, after } = args;
  const isWhite = color === "w";
  const whiteBefore = fenBefore.split(" ")[1] !== "b";
  const whiteAfter = fenAfter.split(" ")[1] !== "b";

  const posEvals: PosEval[] = [
    {
      white: evalWhiteCp(before.cp, before.mate, whiteBefore),
      bestMove: before.bestUci,
      bestPv: before.pv,
      secondWhite: null,
      mateWhite: before.mate !== undefined ? (whiteBefore ? before.mate : -before.mate) : null,
    },
    {
      white: evalWhiteCp(after.cp, after.mate, whiteAfter),
      bestMove: after.bestUci,
      bestPv: after.pv,
      secondWhite: null,
      mateWhite: after.mate !== undefined ? (whiteAfter ? after.mate : -after.mate) : null,
    },
  ];
  const game: ParsedGame = {
    start: fenBefore,
    sans: [playedSan],
    uci: [playedUci],
    fens: [fenBefore, fenAfter],
    colors: [color],
  };

  const beforeMover = isWhite ? posEvals[0].white : -posEvals[0].white;
  const afterMover = isWhite ? posEvals[1].white : -posEvals[1].white;
  const cpLoss = Math.max(0, beforeMover - afterMover);
  const epLoss = Math.max(0, (winPct(beforeMover) - winPct(afterMover)) / 100);

  const bestUci = posEvals[0].bestMove ?? undefined;
  const isBest = !bestUci || playedUci.slice(0, 4) === bestUci.slice(0, 4);
  const classification: MoveClass = isBest ? "best" : classifyByExpectedLoss(epLoss);

  let best: string | undefined;
  if (bestUci) {
    try {
      best = new Chess(fenBefore).move({
        from: bestUci.slice(0, 2) as Square,
        to: bestUci.slice(2, 4) as Square,
        promotion: (bestUci[4] as "q") ?? "q",
      })?.san;
    } catch {
      /* leave undefined */
    }
  }

  let reason: string | undefined;
  let refutation: string[] | undefined;
  if (classification === "inaccuracy" || classification === "mistake" || classification === "blunder") {
    refutation = pvToSan(fenAfter, posEvals[1].bestPv, 12);
    const mw = (e: PosEval) => (e.mateWhite == null ? null : isWhite ? e.mateWhite : -e.mateWhite);
    reason =
      buildReason(game, 0, posEvals, color, mw(posEvals[0]), mw(posEvals[1]), best) ??
      evalSwingReason(beforeMover, afterMover, best, color);
  }

  return { classification, cpLoss, reason, best, bestUci, bestLine: pvToSan(fenBefore, posEvals[0].bestPv, 12), refutation };
}

// chess.js Square type is re-exported for callers that need it.
export type { Square };
