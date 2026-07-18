import { playSound, useFeedback, type BoardTheme, type PieceSet, type SoundSet, type Theme } from "../feedback";

// "Wood" is the built-in synth; the rest are recorded sets (lichess Enigmahack,
// AGPLv3+) fetched to public/sounds. Tapping a chip auditions it immediately.
const SOUND_STYLES: { id: SoundSet; label: string }[] = [
  { id: "piano", label: "Piano" },
  { id: "wood", label: "Wood" },
  { id: "nes", label: "Retro" },
  { id: "futuristic", label: "Futuristic" },
  { id: "sfx", label: "Cinematic" },
];

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

// Local SVGs under public/pieces/<id>/ (fetched by scripts/fetch-pieces.mjs) —
// each option shows the actual pieces instead of just a name.
const PIECES: { id: PieceSet; label: string }[] = [
  { id: "cburnett", label: "Classic" },
  { id: "merida", label: "Merida" },
  { id: "alpha", label: "Alpha" },
  { id: "maestro", label: "Maestro" },
  { id: "staunty", label: "Staunty" },
  { id: "fresca", label: "Fresca" },
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
  const soundSet = useFeedback((s) => s.soundSet);
  const setSoundSet = useFeedback((s) => s.setSoundSet);
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
          <Toggle
            on={sound}
            onClick={() => {
              setSound(!sound);
              // Play a sample right away so enabling it is instantly audible.
              if (!sound) setTimeout(() => playSound("move"), 60);
            }}
            label="Sound"
            sub="Move and capture sounds"
          />
          {sound && (
            <div className="sound-styles piece-chips">
              {SOUND_STYLES.map((s) => (
                <button
                  key={s.id}
                  className={`piece-chip${soundSet === s.id ? " active" : ""}`}
                  onClick={() => {
                    setSoundSet(s.id);
                    // Audition it right away — hearing beats guessing. The
                    // first tap may fall back to the synth while the sample
                    // decodes; play again shortly after so the real one lands.
                    playSound("move", s.id);
                    setTimeout(() => playSound("capture", s.id), 350);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
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
          <div className="piece-cards">
            {PIECES.map((p) => (
              <button
                key={p.id}
                className={`piece-card${pieceSet === p.id ? " active" : ""}`}
                onClick={() => setPieceSet(p.id)}
              >
                <span className="piece-card-preview">
                  <img src={`/pieces/${p.id}/wN.svg`} alt="" loading="lazy" />
                  <img src={`/pieces/${p.id}/wK.svg`} alt="" loading="lazy" />
                  <img src={`/pieces/${p.id}/bQ.svg`} alt="" loading="lazy" />
                </span>
                <span className="piece-card-label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
