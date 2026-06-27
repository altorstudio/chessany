// Fetch a Lichess user's recent games via the public API (CORS-enabled, no key
// needed). Works in the browser and the Capacitor WebView.

import type { OnlineGame } from "./onlineGames";

export async function fetchLichessGames(
  username: string,
  max = 20,
): Promise<OnlineGame[]> {
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?max=${max}&pgnInJson=true&opening=true&sort=dateDesc`;
  const res = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`No Lichess user "${username}".`);
    throw new Error(`Lichess error (${res.status}).`);
  }
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((g): OnlineGame => ({
      id: g.id,
      white: g.players?.white?.user?.name ?? "Anonymous",
      whiteRating: g.players?.white?.rating,
      black: g.players?.black?.user?.name ?? "Anonymous",
      blackRating: g.players?.black?.rating,
      opening: g.opening?.name,
      speed: g.speed,
      winner: g.winner,
      createdAt: g.createdAt,
      pgn: g.pgn ?? "",
    }));
}
