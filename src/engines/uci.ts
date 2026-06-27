import type { EngineInfo } from "./Engine";

/** Parse a single UCI `info ...` line into a structured EngineInfo. */
export function parseInfoLine(line: string): EngineInfo | null {
  if (!line.startsWith("info ")) return null;
  // We only care about lines that carry a principal variation or a score.
  const tokens = line.split(/\s+/);

  const info: EngineInfo = { multipv: 1, pv: [] };
  let i = 1;
  let sawScore = false;

  while (i < tokens.length) {
    const key = tokens[i];
    switch (key) {
      case "depth":
        info.depth = Number(tokens[++i]);
        break;
      case "multipv":
        info.multipv = Number(tokens[++i]);
        break;
      case "nodes":
        info.nodes = Number(tokens[++i]);
        break;
      case "nps":
        info.nps = Number(tokens[++i]);
        break;
      case "time":
        info.time = Number(tokens[++i]);
        break;
      case "score": {
        const kind = tokens[++i];
        const val = Number(tokens[++i]);
        if (kind === "cp") info.scoreCp = val;
        else if (kind === "mate") info.scoreMate = val;
        sawScore = true;
        break;
      }
      case "pv": {
        // Everything after "pv" is the move list.
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
      }
      default:
        // Skip the value of any key we don't model (seldepth, hashfull, etc.).
        i++;
        break;
    }
    i++;
  }

  // Ignore "info string ..." and currmove-only chatter with no useful payload.
  if (!sawScore && info.pv.length === 0) return null;
  return info;
}

/** Parse a `bestmove e2e4 ponder e7e5` line. */
export function parseBestMove(line: string): { best: string | null; ponder: string | null } | null {
  if (!line.startsWith("bestmove")) return null;
  const tokens = line.split(/\s+/);
  const best = tokens[1] && tokens[1] !== "(none)" ? tokens[1] : null;
  const ponderIdx = tokens.indexOf("ponder");
  const ponder = ponderIdx >= 0 ? tokens[ponderIdx + 1] ?? null : null;
  return { best, ponder };
}
