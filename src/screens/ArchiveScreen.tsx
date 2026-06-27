import { useState } from "react";
import { deleteGame, listGames, type SavedGame } from "../archive";
import { useNav } from "../nav";

export function ArchiveScreen() {
  const [games, setGames] = useState<SavedGame[]>(() => listGames());
  const openAnalysis = useNav((s) => s.openAnalysis);

  const remove = (id: string) => {
    deleteGame(id);
    setGames(listGames());
  };

  return (
    <div className="single-col">
      <div className="panel">
        <div className="panel-title">Games Archive</div>
        {games.length === 0 ? (
          <div className="game-state">
            No saved games yet. Save a game in <strong>Play Chess</strong>, or run a report in{" "}
            <strong>Analyze Game</strong>, and it shows up here.
          </div>
        ) : (
          <ul className="archive-list">
            {games.map((g) => (
              <li key={g.id} className="archive-row">
                <div className="archive-meta">
                  <span className="archive-players">
                    {g.white} vs {g.black}
                    {g.accuracy && <span className="archive-badge">Analyzed</span>}
                  </span>
                  <span className="archive-sub">
                    {g.result}
                    {g.accuracy && ` · ${g.accuracy.white.toFixed(0)}% / ${g.accuracy.black.toFixed(0)}%`}
                    {" · "}{new Date(g.savedAt).toLocaleString()}
                  </span>
                </div>
                <div className="archive-actions">
                  <button className="btn primary" onClick={() => openAnalysis(g.pgn)} disabled={!g.pgn}>Analyze</button>
                  <button className="btn" onClick={() => remove(g.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
