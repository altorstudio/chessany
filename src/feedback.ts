import { create } from "zustand";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

// Move/board feedback: synthesized sound (Web Audio — no asset files) + haptics
// (Capacitor on device, navigator.vibrate on the web). Both user-toggleable.

export type MoveKind = "move" | "capture" | "castle" | "check" | "promote" | "gameEnd";

// ---------------------------------------------------------------------------
// Preferences (persisted)
// ---------------------------------------------------------------------------
const LS_KEY = "chessany.feedback";
export type BoardTheme = "walnut" | "forest" | "slate" | "coffee";
export type PieceSet = "cburnett" | "wiki";
export type Theme = "dark" | "light";
interface Prefs { sound: boolean; haptics: boolean; coach: boolean; boardTheme: BoardTheme; pieceSet: PieceSet; theme: Theme }
function loadPrefs(): Prefs {
  const def: Prefs = { sound: true, haptics: true, coach: false, boardTheme: "walnut", pieceSet: "cburnett", theme: "dark" };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") };
  } catch {
    return def;
  }
}
const initial = loadPrefs();

interface FeedbackState {
  sound: boolean;
  haptics: boolean;
  /** Live move coaching during play (flags inaccuracies/mistakes/blunders). */
  coach: boolean;
  boardTheme: BoardTheme;
  pieceSet: PieceSet;
  theme: Theme;
  setSound: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setCoach: (v: boolean) => void;
  setBoardTheme: (v: BoardTheme) => void;
  setPieceSet: (v: PieceSet) => void;
  setTheme: (v: Theme) => void;
}

export const useFeedback = create<FeedbackState>((set, get) => {
  const persist = () => {
    const { sound, haptics, coach, boardTheme, pieceSet, theme } = get();
    localStorage.setItem(LS_KEY, JSON.stringify({ sound, haptics, coach, boardTheme, pieceSet, theme }));
  };
  return {
    sound: initial.sound,
    haptics: initial.haptics,
    coach: initial.coach,
    boardTheme: initial.boardTheme,
    pieceSet: initial.pieceSet,
    theme: initial.theme,
    setSound: (sound) => { set({ sound }); persist(); },
    setHaptics: (haptics) => { set({ haptics }); persist(); },
    setCoach: (coach) => { set({ coach }); persist(); },
    setBoardTheme: (boardTheme) => { set({ boardTheme }); persist(); },
    setPieceSet: (pieceSet) => { set({ pieceSet }); persist(); },
    setTheme: (theme) => { set({ theme }); persist(); },
  };
});

// ---------------------------------------------------------------------------
// Sound (Web Audio synthesis)
// ---------------------------------------------------------------------------
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// A soft sine note with a gentle attack/decay — used for chimes (promote, check,
// game end). Sine waves are far mellower than square/sawtooth beeps.
function tone(freq: number, dur: number, vol: number, delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012); // soft fade-in (no click)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A short, low-passed noise click — the natural "tock" of a wooden piece being
// placed. Much more pleasant than a tonal beep for moves and captures.
function click(vol: number, cutoff: number, dur: number, delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(a.destination);
  src.start(t);
}

export function playSound(kind: MoveKind) {
  if (!useFeedback.getState().sound) return;
  switch (kind) {
    case "move":
      // Soft wooden tap.
      click(0.16, 1100, 0.05);
      break;
    case "capture":
      // Deeper, slightly louder tap with a low thump underneath.
      click(0.24, 650, 0.07);
      tone(150, 0.09, 0.08);
      break;
    case "castle":
      click(0.15, 1000, 0.045);
      click(0.15, 1000, 0.045, 0.085);
      break;
    case "promote":
      // Gentle rising two-note chime (C5 → G5).
      tone(523.25, 0.13, 0.1);
      tone(783.99, 0.18, 0.1, 0.1);
      break;
    case "check":
      // Soft two-note alert (not a harsh square beep).
      tone(659.25, 0.12, 0.1);
      tone(880, 0.14, 0.09, 0.12);
      break;
    case "gameEnd":
      // Pleasant little major arpeggio (C5 → E5 → G5).
      tone(523.25, 0.16, 0.1);
      tone(659.25, 0.16, 0.1, 0.12);
      tone(783.99, 0.26, 0.1, 0.24);
      break;
  }
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------
function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
}

export function haptic(kind: MoveKind) {
  if (!useFeedback.getState().haptics) return;
  // Keep it subtle: a light tap for ordinary moves, one slightly firmer tap only
  // when the game ends. No buzzes or patterns.
  try {
    if (Capacitor.isNativePlatform()) {
      void Haptics.impact({ style: kind === "gameEnd" ? ImpactStyle.Medium : ImpactStyle.Light });
    } else {
      vibrate(kind === "gameEnd" ? 12 : 6);
    }
  } catch {
    /* ignore — haptics are best-effort */
  }
}

// A gentle quality cue for notable moves. Ordinary good moves get no extra buzz
// (just the light move tap) — only inaccuracies/mistakes/blunders are flagged,
// with a single soft impact rather than the jarring system "notification" buzz.
export type FeedbackLevel = "good" | "warn" | "bad";
export function classificationHaptic(level: FeedbackLevel) {
  if (!useFeedback.getState().haptics) return;
  try {
    if (Capacitor.isNativePlatform()) {
      void Haptics.impact({ style: level === "bad" ? ImpactStyle.Medium : ImpactStyle.Light });
    } else {
      vibrate(level === "bad" ? 14 : level === "warn" ? 10 : 6);
    }
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Classify a played move and fire both sound + haptics.
// ---------------------------------------------------------------------------
export function moveFeedback(opts: { san?: string; flags?: string; captured?: boolean; gameOver?: boolean; haptics?: boolean }) {
  const { san = "", flags = "", captured, gameOver, haptics = true } = opts;
  // Infer from flags when available (live moves) or from SAN (game navigation).
  const isCapture = captured || flags.includes("c") || flags.includes("e") || san.includes("x");
  const isCastle = flags.includes("k") || flags.includes("q") || san.startsWith("O-O");
  const isPromote = flags.includes("p") || san.includes("=");

  let kind: MoveKind = "move";
  if (gameOver || san.includes("#")) kind = "gameEnd";
  else if (isCapture) kind = "capture";
  else if (isCastle) kind = "castle";
  else if (isPromote) kind = "promote";
  else if (san.includes("+")) kind = "check";
  playSound(kind);
  if (haptics) haptic(kind);
}
