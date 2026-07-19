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
// "board" (default) is real recorded wood impacts (Kenney, CC0 — committed in
// public/sounds/board); "wood" is the built-in synthesized knock; the rest are
// lichess's Enigmahack AGPLv3+ sample sets, fetched to public/sounds/<set>/.
export type SoundSet = "board" | "wood" | "piano" | "nes" | "futuristic" | "sfx";
export const SOUND_SETS: SoundSet[] = ["board", "wood", "piano", "nes", "futuristic", "sfx"];
export type Theme = "dark" | "light";
interface Prefs { sound: boolean; haptics: boolean; coach: boolean; boardTheme: BoardTheme; pieceSet: PieceSet; soundSet: SoundSet; theme: Theme }
function loadPrefs(): Prefs {
  // Day is the default — the soft light material is the app's primary look.
  const def: Prefs = { sound: true, haptics: true, coach: false, boardTheme: "walnut", pieceSet: "cburnett", soundSet: "board", theme: "light" };
  try {
    const p: Prefs = { ...def, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") };
    // Migration: sets that no longer exist (e.g. the old CDN "wiki") → default.
    if (!PIECE_SETS.includes(p.pieceSet)) p.pieceSet = def.pieceSet;
    if (!SOUND_SETS.includes(p.soundSet)) p.soundSet = def.soundSet;
    // "piano" was briefly the silent default and was widely disliked — move it
    // to the new recorded-board default (it stays available in Settings).
    if (p.soundSet === "piano") p.soundSet = "board";
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
  soundSet: SoundSet;
  theme: Theme;
  setSound: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setCoach: (v: boolean) => void;
  setBoardTheme: (v: BoardTheme) => void;
  setPieceSet: (v: PieceSet) => void;
  setSoundSet: (v: SoundSet) => void;
  setTheme: (v: Theme) => void;
}

export const useFeedback = create<FeedbackState>((set, get) => {
  const persist = () => {
    const { sound, haptics, coach, boardTheme, pieceSet, soundSet, theme } = get();
    localStorage.setItem(LS_KEY, JSON.stringify({ sound, haptics, coach, boardTheme, pieceSet, soundSet, theme }));
  };
  return {
    sound: initial.sound,
    haptics: initial.haptics,
    coach: initial.coach,
    boardTheme: initial.boardTheme,
    pieceSet: initial.pieceSet,
    soundSet: initial.soundSet,
    theme: initial.theme,
    setSound: (sound) => { set({ sound }); persist(); },
    setHaptics: (haptics) => { set({ haptics }); persist(); },
    setCoach: (coach) => { set({ coach }); persist(); },
    setBoardTheme: (boardTheme) => { set({ boardTheme }); persist(); },
    setPieceSet: (pieceSet) => { set({ pieceSet }); persist(); },
    setSoundSet: (soundSet) => { set({ soundSet }); persist(); },
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

// ---------------------------------------------------------------------------
// Recorded samples (public/sounds/<set>/{Move,Capture}.mp3 — lichess's
// Enigmahack AGPLv3+ sets, fetched by scripts/fetch-sounds.mjs). Decoded once
// per set and cached; the synthesized "wood" knock stays as the built-in set
// AND the fallback while a sample is still loading or failed to fetch.
// ---------------------------------------------------------------------------
type SampleName = "Move" | "Capture";
const sampleCache = new Map<string, AudioBuffer | "loading" | "failed">();

function loadSample(set: SoundSet, name: SampleName): AudioBuffer | null {
  const key = `${set}/${name}`;
  const cached = sampleCache.get(key);
  if (cached instanceof AudioBuffer) return cached;
  if (cached) return null; // loading or failed — caller falls back to synth
  sampleCache.set(key, "loading");
  const a = audio();
  if (!a) {
    sampleCache.set(key, "failed");
    return null;
  }
  void fetch(`${import.meta.env.BASE_URL}sounds/${key}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => a.decodeAudioData(buf))
    .then((decoded) => sampleCache.set(key, decoded))
    .catch(() => sampleCache.set(key, "failed"));
  return null;
}

/** Play a recorded sample; false when unavailable (caller uses the synth). */
function playSample(set: SoundSet, name: SampleName, vol: number, delay = 0): boolean {
  const buf = loadSample(set, name);
  const a = audio();
  if (!buf || !a) return false;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(g).connect(out(a));
  src.start(t);
  return true;
}

/** Warm the current set's samples so the first move isn't a synth fallback. */
export function preloadSounds() {
  const { sound, soundSet } = useFeedback.getState();
  if (!sound || soundSet === "wood") return;
  loadSample(soundSet, "Move");
  loadSample(soundSet, "Capture");
}

export function playSound(kind: MoveKind, setOverride?: SoundSet) {
  if (!useFeedback.getState().sound && !setOverride) return;
  const set = setOverride ?? useFeedback.getState().soundSet;
  // The landing sound: a recorded sample when the set provides one, the
  // synthesized knock otherwise (set to "wood", still loading, or fetch failed).
  const land = (which: SampleName, vol: number, delay = 0) => {
    if (set !== "wood" && playSample(set, which, vol, delay)) return;
    if (which === "Capture") {
      thock(0.6, 165, delay);
      thock(0.3, 260, delay + 0.045);
    } else {
      thock(0.5, 240, delay);
    }
  };
  switch (kind) {
    case "move":
      land("Move", 0.9);
      break;
    case "capture":
      land("Capture", 0.9);
      break;
    case "castle":
      // Two pieces land: king, then rook.
      land("Move", 0.8);
      land("Move", 0.6, 0.09);
      break;
    case "promote":
      // The piece lands, then a gentle rising two-note chime (C5 → G5).
      land("Move", 0.8);
      tone(523.25, 0.14, 0.07, 0.05);
      tone(783.99, 0.2, 0.07, 0.16);
      break;
    case "check":
      // The piece lands, then a soft two-note alert.
      land("Move", 0.85);
      tone(659.25, 0.12, 0.06, 0.06);
      tone(880, 0.15, 0.055, 0.17);
      break;
    case "gameEnd":
      // Final landing, then a small major arpeggio (C5 → E5 → G5).
      land("Capture", 0.8);
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
