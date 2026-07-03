import { useEffect, useState } from "react";
import { fetchLichessGames } from "../lichess";
import { fetchChessComGames } from "../chesscom";
import type { OnlineGame } from "../onlineGames";
import { getLichessUser, setLichessUser, getChessComUser, setChessComUser } from "../prefs";

export type Provider = "lichess" | "chesscom";

const CONFIG: Record<
  Provider,
  {
    placeholder: string;
    fetchGames: (user: string) => Promise<OnlineGame[]>;
    getUser: () => string;
    setUser: (user: string) => void;
  }
> = {
  lichess: {
    placeholder: "Lichess username",
    fetchGames: fetchLichessGames,
    getUser: getLichessUser,
    setUser: setLichessUser,
  },
  chesscom: {
    placeholder: "Chess.com username",
    fetchGames: fetchChessComGames,
    getUser: getChessComUser,
    setUser: setChessComUser,
  },
};

/**
 * Username box + recent-games list for an online provider. The provider's
 * config supplies the fetcher and the remembered-username storage, so Lichess
 * and Chess.com share exactly the same UI.
 */
export function OnlineGames({ provider, onPick }: { provider: Provider; onPick: (pgn: string) => void }) {
  const cfg = CONFIG[provider];
  const [username, setUsername] = useState(() => cfg.getUser());
  const [games, setGames] = useState<OnlineGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    const user = username.trim();
    if (!user) return;
    cfg.setUser(user); // remember it for next time
    setLoading(true);
    setError(null);
    try {
      setGames(await cfg.fetchGames(user));
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch games.");
      setGames([]);
    } finally {
      setLoading(false);
    }
  };

  // With a remembered username, fetch the latest games as soon as the tab
  // opens — the common mobile flow is "open the tab, tap the newest game",
  // which shouldn't need a Fetch tap (or show a stale empty list).
  useEffect(() => {
    if (cfg.getUser()) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="row">
        <input
          className="text-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={cfg.placeholder}
        />
        <button className="btn primary" onClick={search} disabled={loading || !username.trim()}>
          {loading ? "…" : "Fetch"}
        </button>
      </div>
      {error && <div className="game-state warn">{error}</div>}
      {loading && games.length === 0 && <div className="game-state">Loading recent games…</div>}
      <div className="lichess-list">
        {games.map((g) => {
          const userIsWhite = g.white.toLowerCase() === username.trim().toLowerCase();
          const opp = userIsWhite ? g.black : g.white;
          const oppRating = userIsWhite ? g.blackRating : g.whiteRating;
          const won = g.winner === (userIsWhite ? "white" : "black");
          const dot = !g.winner ? "draw" : won ? "win" : "loss";
          return (
            <button key={g.id} className="lichess-row" onClick={() => onPick(g.pgn)} disabled={!g.pgn}>
              <span className={`result-dot ${dot}`} />
              <span className="lichess-meta">
                <span className="lichess-opp">{opp}{oppRating ? ` (${oppRating})` : ""}</span>
                <span className="lichess-sub">{g.opening ?? "—"} · {g.speed ?? ""}</span>
              </span>
            </button>
          );
        })}
        {!loading && !error && searched && games.length === 0 && (
          <div className="game-state">No games found for that user.</div>
        )}
      </div>
    </>
  );
}
