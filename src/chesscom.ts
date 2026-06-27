// Fetch a Chess.com user's recent games via the public Published-Data API
// (CORS-enabled, no key needed). Works in the browser and the Capacitor WebView.
//
// Chess.com groups games into monthly archives. We list the archives, then walk
// from the newest month backwards, pulling games until we have `max`.

import type { OnlineGame } from "./onlineGames";

interface ChessComPlayer {
  username: string;
  rating?: number;
  result: string; // "win" | "checkmated" | "resigned" | "timeout" | "agreed" | ...
}

interface ChessComApiGame {
  url: string;
  pgn?: string;
  time_class?: string; // "bullet" | "blitz" | "rapid" | "daily"
  end_time?: number; // epoch seconds
  eco?: string; // URL to the opening, when available
  white: ChessComPlayer;
  black: ChessComPlayer;
}

/** Read a single PGN header value (e.g. ECOUrl) without a full parse. */
function pgnHeader(pgn: string | undefined, tag: string): string | undefined {
  if (!pgn) return undefined;
  const m = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`));
  return m?.[1] || undefined;
}

/**
 * Turn an opening URL (".../openings/Italian-Game") into "Italian Game".
 * Chess.com slugs often append the concrete move sequence
 * ("...-Two-Knights-Attack-3...dxe4-4.Nxe4"); drop that for a clean name.
 */
function openingName(g: ChessComApiGame): string | undefined {
  const url = pgnHeader(g.pgn, "ECOUrl") || g.eco;
  const slug = url?.split("/").pop();
  if (!slug) return undefined;
  const name = decodeURIComponent(slug)
    .replace(/[-_]/g, " ")
    .replace(/\s\d.*$/, "") // strip from the first move number onward
    .trim();
  return name || undefined;
}

function mapGame(g: ChessComApiGame): OnlineGame {
  const winner =
    g.white.result === "win" ? "white" : g.black.result === "win" ? "black" : undefined;
  return {
    id: g.url,
    white: g.white.username,
    whiteRating: g.white.rating,
    black: g.black.username,
    blackRating: g.black.rating,
    opening: openingName(g),
    speed: g.time_class,
    winner,
    createdAt: (g.end_time ?? 0) * 1000,
    pgn: g.pgn ?? "",
  };
}

export async function fetchChessComGames(
  username: string,
  max = 20,
): Promise<OnlineGame[]> {
  const user = username.trim().toLowerCase();
  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
  );
  if (!archivesRes.ok) {
    if (archivesRes.status === 404) throw new Error(`No Chess.com user "${username}".`);
    throw new Error(`Chess.com error (${archivesRes.status}).`);
  }
  const { archives } = (await archivesRes.json()) as { archives?: string[] };
  if (!archives?.length) return [];

  // Newest month is last; walk backwards until we've gathered `max` games.
  const out: OnlineGame[] = [];
  for (let i = archives.length - 1; i >= 0 && out.length < max; i--) {
    const monthRes = await fetch(archives[i]);
    if (!monthRes.ok) continue;
    const { games } = (await monthRes.json()) as { games?: ChessComApiGame[] };
    if (!games?.length) continue;
    for (let j = games.length - 1; j >= 0 && out.length < max; j--) {
      out.push(mapGame(games[j]));
    }
  }
  return out;
}
