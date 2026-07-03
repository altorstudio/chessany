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
export type PieceSet = "cburnett" | "merida" | "alpha" | "maestro" | "staunty" | "fresca";
export const PIECE_SETS: PieceSet[] = ["cburnett", "merida", "alpha", "maestro", "staunty", "fresca"];
export type Theme = "dark" | "light";
interface Prefs { sound: boolean; haptics: boolean; coach: boolean; boardTheme: BoardTheme; pieceSet: PieceSet; theme: Theme }
function loadPrefs(): Prefs {
  const def: Prefs = { sound: true, haptics: true, coach: false, boardTheme: "walnut", pieceSet: "cburnett", theme: "dark" };
  try {
    const p: Prefs = { ...def, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") };
    // Migration: sets that no longer exist (e.g. the old CDN "wiki") → default.
    if (!PIECE_SETS.includes(p.pieceSet)) p.pieceSet = def.pieceSet;
    return p;
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

// Shared output chain: a gentle compressor glues the layered hits together and
// stops fast sequences (premoves, autoplay) from clipping harshly.
let master: DynamicsCompressorNode | null = null;
function out(a: AudioContext): AudioNode {
  if (!master) {
    master = a.createDynamicsCompressor();
    master.threshold.value = -20;
    master.knee.value = 18;
    master.ratio.value = 5;
    master.attack.value = 0.002;
    master.release.value = 0.12;
    master.connect(a.destination);
  }
  return master;
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
  osc.connect(g).connect(out(a));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A wooden "thock" — the sound of a piece landing on a board. Synthesized the
// classic woodblock way: a fast pitch-dropping sine gives the hollow body, and
// a few milliseconds of band-passed noise give the contact tick. Far warmer
// than a raw noise burst, which reads as static.
function thock(vol: number, pitch: number, delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  // Body: hollow knock.
  const osc = a.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(pitch, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(60, pitch * 0.55), t + 0.07);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  osc.connect(g).connect(out(a));
  osc.start(t);
  osc.stop(t + 0.13);
  // Attack: the brief contact tick.
  const len = Math.max(1, Math.floor(a.sampleRate * 0.012));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(4000, pitch * 9);
  bp.Q.value = 1.1;
  const ng = a.createGain();
  ng.gain.setValueAtTime(vol * 0.55, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
  src.connect(bp).connect(ng).connect(out(a));
  src.start(t);
}

export function playSound(kind: MoveKind) {
  if (!useFeedback.getState().sound) return;
  switch (kind) {
    case "move":
      // A single soft knock.
      thock(0.5, 240);
      break;
    case "capture":
      // Deeper knock + a lighter one right behind it — take, then replace.
      thock(0.6, 165);
      thock(0.3, 260, 0.045);
      break;
    case "castle":
      // Two pieces land: king, then rook.
      thock(0.45, 240);
      thock(0.4, 205, 0.09);
      break;
    case "promote":
      // The piece lands, then a gentle rising two-note chime (C5 → G5).
      thock(0.4, 240);
      tone(523.25, 0.14, 0.07, 0.05);
      tone(783.99, 0.2, 0.07, 0.16);
      break;
    case "check":
      // The piece lands, then a soft two-note alert.
      thock(0.45, 240);
      tone(659.25, 0.12, 0.06, 0.06);
      tone(880, 0.15, 0.055, 0.17);
      break;
    case "gameEnd":
      // Final knock, then a small major arpeggio (C5 → E5 → G5).
      thock(0.45, 200);
      tone(523.25, 0.16, 0.08, 0.1);
      tone(659.25, 0.16, 0.08, 0.22);
      tone(783.99, 0.3, 0.08, 0.34);
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
