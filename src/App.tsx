import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useStore } from "./store";
import { preloadSounds, useFeedback } from "./feedback";
import { probeNativeEngines } from "./engines/registry";
import { useNav } from "./nav";
import { Sidebar } from "./components/Sidebar";
import { Settings } from "./components/Settings";
import { Toaster } from "./components/Toaster";
import { PlayScreen } from "./screens/PlayScreen";
import { AnalysisBoardScreen } from "./screens/AnalysisBoardScreen";
import { AnalyzeGameScreen } from "./screens/AnalyzeGameScreen";
import { BoardEditorScreen } from "./screens/BoardEditorScreen";
import { ArchiveScreen } from "./screens/ArchiveScreen";
import { OpeningsScreen } from "./screens/OpeningsScreen";

// Eyebrow + title shown in the header, per view.
const HEADERS: Record<string, [string, string]> = {
  play: ["Live Game", "Play Chess"],
  analyzeGame: ["Review", "Analyze Game"],
  boardEditor: ["Setup", "Board Editor"],
  archive: ["Library", "Games Archive"],
  openings: ["Theory", "Openings"],
};

export default function App() {
  const view = useNav((s) => s.view);
  const mode = useStore((s) => s.mode);
  const selectEngine = useStore((s) => s.selectEngine);
  const engineId = useStore((s) => s.engineId);
  const boardTheme = useFeedback((s) => s.boardTheme);
  const pieceSet = useFeedback((s) => s.pieceSet);
  const theme = useFeedback((s) => s.theme);
  const [probed, setProbed] = useState(false);
  // Rail open by default on desktop, collapsed on narrow screens.
  const [railOpen, setRailOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 900 : true));
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      await probeNativeEngines();
      setProbed(true);
      void selectEngine(engineId);
    })();
    // Warm the selected sound set so the first move plays the real sample.
    preloadSounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive board colors, piece set, and light/dark theme from the chosen prefs.
  useEffect(() => {
    document.documentElement.dataset.boardTheme = boardTheme;
    document.documentElement.dataset.pieceSet = pieceSet;
    document.documentElement.dataset.theme = theme;
  }, [boardTheme, pieceSet, theme]);

  // Native status bar: stay transparent (content draws behind it — we reserve
  // room with safe-area-inset padding in CSS) and flip icon contrast with theme.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: theme === "light" ? Style.Light : Style.Dark });
      } catch {
        /* plugin unavailable (e.g. web) — safe to ignore */
      }
    })();
  }, [theme]);

  // The Play screen doubles as the free-analysis board when the store is in
  // analysis mode (reached via "Analyze" on the Board Editor / Openings).
  const analyzing = view === "play" && mode === "analysis";
  const [eyebrow, title] = analyzing ? ["Engine", "Analysis Board"] : HEADERS[view] ?? ["", "Chessany"];

  return (
    <div className={`shell${railOpen ? " rail-open" : " rail-closed"}`}>
      <Sidebar open={railOpen} onClose={() => setRailOpen(false)} onOpenSettings={() => setSettingsOpen(true)} />

      <main className="main">
        <header className="main-header">
          <div className="main-header-inner">
            <button className="rail-toggle" onClick={() => setRailOpen(true)} aria-label="Open menu">&#9776;</button>
            <div className="main-header-text">
              <div className="main-eyebrow">{eyebrow}</div>
              <h1 className="main-title">{title}</h1>
            </div>
          </div>
        </header>

        <div className="main-content">
          {!probed ? (
            <div className="game-state">Loading engine…</div>
          ) : (
            <>
              {view === "play" && (analyzing ? <AnalysisBoardScreen /> : <PlayScreen />)}
              {view === "analyzeGame" && <AnalyzeGameScreen />}
              {view === "boardEditor" && <BoardEditorScreen />}
              {view === "archive" && <ArchiveScreen />}
              {view === "openings" && <OpeningsScreen />}
            </>
          )}
        </div>
      </main>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
