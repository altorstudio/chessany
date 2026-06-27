import { useFeedback, type BoardTheme, type PieceSet, type Theme } from "../feedback";

const APPEARANCE: { id: Theme; label: string }[] = [
  { id: "dark", label: "Night" },
  { id: "light", label: "Day" },
];

const THEMES: { id: BoardTheme; light: string; dark: string }[] = [
  { id: "walnut", light: "#e8dcc1", dark: "#9a8b6a" },
  { id: "forest", light: "#ebecd0", dark: "#6f8f4e" },
  { id: "slate", light: "#cdd3da", dark: "#647387" },
  { id: "coffee", light: "#ead9bd", dark: "#a9744a" },
];

const PIECES: { id: PieceSet; label: string }[] = [
  { id: "cburnett", label: "Classic" },
  { id: "wiki", label: "Wikipedia" },
];

function Toggle({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <button className="pref-row" onClick={onClick}>
      <span className="pref-label">
        {label}
        {sub && <span className="pref-sub">{sub}</span>}
      </span>
      <span className={`pref-track${on ? " on" : ""}`}><span className="pref-knob" /></span>
    </button>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const sound = useFeedback((s) => s.sound);
  const haptics = useFeedback((s) => s.haptics);
  const setSound = useFeedback((s) => s.setSound);
  const setHaptics = useFeedback((s) => s.setHaptics);
  const boardTheme = useFeedback((s) => s.boardTheme);
  const setBoardTheme = useFeedback((s) => s.setBoardTheme);
  const pieceSet = useFeedback((s) => s.pieceSet);
  const setPieceSet = useFeedback((s) => s.setPieceSet);
  const theme = useFeedback((s) => s.theme);
  const setTheme = useFeedback((s) => s.setTheme);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-group" style={{ marginTop: 0 }}>
          <div className="rail-section-title">Appearance</div>
          <div className="piece-chips">
            {APPEARANCE.map((a) => (
              <button
                key={a.id}
                className={`piece-chip${theme === a.id ? " active" : ""}`}
                onClick={() => setTheme(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section" style={{ marginTop: 16 }}>
          <Toggle on={sound} onClick={() => setSound(!sound)} label="Sound" sub="Move and capture sounds" />
          {/* Vibration only matters on touch devices; hide it on desktop. */}
          {typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window) && (
            <Toggle on={haptics} onClick={() => setHaptics(!haptics)} label="Vibration" sub="Haptic feedback on moves" />
          )}
        </div>

        <div className="settings-group">
          <div className="rail-section-title">Board</div>
          <div className="theme-swatches">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-swatch${boardTheme === t.id ? " active" : ""}`}
                onClick={() => setBoardTheme(t.id)}
                aria-label={t.id}
              >
                <span style={{ background: t.light }} /><span style={{ background: t.dark }} />
                <span style={{ background: t.dark }} /><span style={{ background: t.light }} />
              </button>
            ))}
          </div>
        </div>

        <div className="settings-group">
          <div className="rail-section-title">Pieces</div>
          <div className="piece-chips">
            {PIECES.map((p) => (
              <button
                key={p.id}
                className={`piece-chip${pieceSet === p.id ? " active" : ""}`}
                onClick={() => setPieceSet(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
