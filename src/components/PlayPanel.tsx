import { DIFFICULTIES, useStore } from "../store";
import { useNav } from "../nav";
import { tapHaptic, useFeedback } from "../feedback";
import type { GameStatus } from "../game/chess";

type Outcome = { kind: "win" | "loss" | "draw"; title: string; detail: string };

/** Player-relative outcome (in plain words) once the game is over, else null. */
function outcomeOf(
  playerColor: "white" | "black",
  status: GameStatus,
  resignedResult: string | null,
): Outcome | null {
  if (resignedResult) {
    return { kind: "loss", title: "You resigned", detail: "Better luck next game." };
  }
  if (!status.result) return null;
  if (status.isCheckmate) {
    // The side to move is the one that's been checkmated (the loser).
    const loser = status.turn === "w" ? "white" : "black";
    return loser === playerColor
      ? { kind: "loss", title: "Checkmate — you lost", detail: "The engine got there first." }
      : { kind: "win", title: "Checkmate — you won! 🎉", detail: "Nicely done." };
  }
  // Any kind of draw.
  return { kind: "draw", title: "Draw", detail: status.result.replace(/^Draw — /, "") };
}

const OUTCOME_ICON: Record<Outcome["kind"], string> = { win: "🏆", loss: "🏳️", draw: "½" };

export function PlayPanel() {
  const difficulty = useStore((s) => s.difficulty);
  const setDifficulty = useStore((s) => s.setDifficulty);
  const playerColor = useStore((s) => s.playerColor);
  const newGame = useStore((s) => s.newGame);
  const backToSetup = useStore((s) => s.backToSetup);
  const undo = useStore((s) => s.undo);
  const flip = useStore((s) => s.flip);
  const resign = useStore((s) => s.resign);
  const engineThinking = useStore((s) => s.engineThinking);
  const status = useStore((s) => s.status);
  const history = useStore((s) => s.history);
  const resignedResult = useStore((s) => s.resignedResult);
  const playStarted = useStore((s) => s.playStarted);
  const pgn = useStore((s) => s.pgn);
  const openAnalysis = useNav((s) => s.openAnalysis);
  const coach = useFeedback((s) => s.coach);
  const setCoach = useFeedback((s) => s.setCoach);

  const outcome = outcomeOf(playerColor, status, resignedResult);
  const inProgress = !outcome && (playStarted || history.length > 0);
  const other = playerColor === "white" ? "black" : "white";

  // Game over: a clear result card with what to do next.
  if (outcome) {
    return (
      <div className={`panel play-panel game-over ${outcome.kind}`}>
        <div className="game-over-icon">{OUTCOME_ICON[outcome.kind]}</div>
        <div className="game-over-title">{outcome.title}</div>
        <div className="game-over-detail">{outcome.detail}</div>
        <div className="row">
          <button className="btn primary" onClick={() => newGame(playerColor)}>Rematch</button>
          <button className="btn" onClick={() => newGame(other)}>Switch sides</button>
        </div>
        {pgn && (
          <button className="btn block" onClick={() => openAnalysis(pgn)}>Analyze this game</button>
        )}
      </div>
    );
  }

  return (
    <div className={`panel play-panel${inProgress ? " in-progress" : ""}`}>
      <div className="panel-title">Play vs Engine</div>

      <div className="play-status">
        {engineThinking ? (
          <span className="thinking">Engine is thinking…</span>
        ) : status.isCheck ? (
          <span className="check">Check! Your move.</span>
        ) : inProgress ? (
          <span>Your move ({playerColor}).</span>
        ) : (
          <span>Pick a side to start.</span>
        )}
      </div>

      {inProgress ? (
        // Mid-game controls.
        <>
          <div className="row">
            <button className="btn danger" onClick={resign} disabled={engineThinking}>Resign</button>
            <button className="btn" onClick={undo} disabled={engineThinking}>Undo</button>
            <button className="btn" onClick={flip}>Flip</button>
          </div>
          <button className="pref-row coach-row" onClick={() => { setCoach(!coach); tapHaptic(); }}>
            <span className="pref-label">Coach<span className="pref-sub">Flag your mistakes as you play</span></span>
            <span className={`pref-track${coach ? " on" : ""}`}><span className="pref-knob" /></span>
          </button>
          <button className="link-btn" onClick={backToSetup}>New game</button>
        </>
      ) : (
        // Pre-game setup: difficulty + side.
        <>
          <label className="field">
            <span>Difficulty</span>
            <select
              value={difficulty.label}
              onChange={(e) => setDifficulty(DIFFICULTIES.find((d) => d.label === e.target.value) ?? difficulty)}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d.label} value={d.label}>{d.label} · {d.elo} Elo</option>
              ))}
            </select>
          </label>
          <button className="pref-row coach-row" onClick={() => { setCoach(!coach); tapHaptic(); }}>
            <span className="pref-label">Coach<span className="pref-sub">Flag your mistakes as you play</span></span>
            <span className={`pref-track${coach ? " on" : ""}`}><span className="pref-knob" /></span>
          </button>
          <div className="row">
            <button className="btn primary" onClick={() => newGame("white")}>Play as White</button>
            <button className="btn" onClick={() => newGame("black")}>Play as Black</button>
          </div>
        </>
      )}
    </div>
  );
}
