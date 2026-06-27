import { Capacitor } from "@capacitor/core";
import type { Engine, EngineMeta } from "./Engine";
import { UciWorkerEngine } from "./UciWorkerEngine";
import { NativeUciEngine } from "./NativeUciEngine";
import { UciEngine } from "./native/uciEnginePlugin";

// Resolve an engine worker URL against the app base so it works in dev,
// on a web host, and inside the Capacitor native shells (file://).
const asset = (path: string) => `${import.meta.env.BASE_URL}engines/${path}`;

interface EngineDef {
  meta: EngineMeta;
  /** WASM/JS Web Worker — used on web, and on device when there's no native build. */
  worker?: string;
  /**
   * Multi-threaded WASM worker (pthreads + SharedArrayBuffer). Used instead of
   * `worker` when the page is cross-origin isolated (web) — many times faster.
   * Falls back to `worker` where SharedArrayBuffer isn't available (e.g. the
   * Capacitor file:// WebView).
   */
  workerMt?: string;
  /**
   * Native host engine key. When the `UciEngine` plugin is present on the
   * device, the engine runs as a real multi-threaded native binary (faster,
   * stronger) instead of the WASM worker. Engines with only a `nativeKey` are
   * mobile-only and won't appear on the web.
   */
  nativeKey?: string;
  defaultOptions?: Record<string, string | number>;
}

// The list that powers the engine picker. Add an engine here and it appears
// everywhere — both for play and analysis — with zero other changes.
const DEFS: EngineDef[] = [
  {
    meta: {
      id: "stockfish",
      name: "Stockfish 18",
      description: "World-class engine. Strongest play and analysis.",
      supportsStrength: true,
      interruptible: true,
    },
    worker: asset("stockfish/stockfish.js"),
    workerMt: asset("stockfish/stockfish-18-lite.js"), // multi-threaded on web
    nativeKey: "stockfish", // native multi-threaded build when available
    defaultOptions: { Threads: 1, Hash: 64 },
  },
];

// Native engine keys whose binaries are actually bundled (filled by the boot
// probe). Empty until `probeNativeEngines()` runs and the plugin reports them —
// so a plugin that's installed but missing an engine binary safely falls back
// to the WASM worker instead of breaking.
const nativeKeys = new Set<string>();

/**
 * Ask the native host which engines it can actually run. Call once at boot.
 *
 * We deliberately DON'T gate on `Capacitor.isPluginAvailable()` — that returns
 * false for app-registered plugins (it only knows npm/bridge-declared ones),
 * which would skip the probe and silently fall back to WASM. Instead just call
 * the plugin on a native platform and catch if it isn't there.
 */
export async function probeNativeEngines(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { engines } = await UciEngine.availableEngines();
    (engines ?? []).forEach((e) => nativeKeys.add(e));
  } catch {
    /* plugin/binaries absent — stay on WASM */
  }
}

/** Will this engine run as a native binary (vs the WASM worker)? */
function usesNative(def: EngineDef): boolean {
  return !!def.nativeKey && nativeKeys.has(def.nativeKey);
}

export function isNativeEngine(id: string): boolean {
  const def = DEFS.find((d) => d.meta.id === id);
  return !!def && usesNative(def);
}

/** Can this engine actually run on the current platform right now? */
function isRunnable(def: EngineDef): boolean {
  return !!def.worker || usesNative(def);
}

// All metas (for id→name lookups). Use `availableEngineMetas()` for the picker.
export const ENGINE_METAS: EngineMeta[] = DEFS.map((d) => d.meta);

/** Engines selectable on the current platform (powers the picker). */
export function availableEngineMetas(): EngineMeta[] {
  return DEFS.filter(isRunnable).map((d) => d.meta);
}

function build(def: EngineDef, options?: Record<string, string | number>): Engine {
  // Prefer the native engine when its binary is present; else the WASM worker.
  if (usesNative(def)) {
    // A native engine is one multi-threaded process — give it most of the cores
    // and a big hash (the WASM-oriented Threads:1/Hash:64 defaults don't apply).
    const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
    const opts = { Threads: Math.max(1, cores - 1), Hash: 128, ...options };
    return new NativeUciEngine(def.meta, def.nativeKey!, opts);
  }
  // Multi-threaded WASM when the page is cross-origin isolated (SharedArrayBuffer
  // available) — vastly faster than single-threaded. Else the single-thread build.
  const isolated = typeof globalThis !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  if (def.workerMt && isolated) {
    // Leave one core free for the browser/UI threads — using ALL cores
    // oversubscribes the CPU and actually lowers nps (context-switch overhead).
    const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
    const opts = { ...def.defaultOptions, Threads: Math.max(1, cores - 1), ...options };
    return new UciWorkerEngine(def.meta, def.workerMt, opts);
  }
  if (def.worker) return new UciWorkerEngine(def.meta, def.worker, { ...def.defaultOptions, ...options });
  throw new Error(`Engine "${def.meta.id}" has no runnable backend on this platform.`);
}

const cache = new Map<string, Engine>();

/** Get (and lazily construct) the engine instance for an id. */
export function getEngine(id: string): Engine {
  const def = DEFS.find((d) => d.meta.id === id);
  if (!def) throw new Error(`Unknown engine: ${id}`);

  const existing = cache.get(id);
  if (existing) {
    // If a cached instance no longer matches the desired backend (e.g. it was
    // built as WASM before the native probe completed), throw it away and
    // rebuild — otherwise it'd stay WASM forever despite native being available.
    const wantNative = usesNative(def);
    const isNativeInstance = existing instanceof NativeUciEngine;
    if (wantNative === isNativeInstance) return existing;
    try { existing.quit(); } catch { /* ignore */ }
    cache.delete(id);
  }

  const engine = build(def);
  cache.set(id, engine);
  return engine;
}

/**
 * Build a fresh, *uncached* engine instance (its own worker/native session).
 * Used to spin up a pool that analyzes different positions in parallel — quit
 * each when done. `options` overrides the engine's defaults (e.g. a smaller
 * Hash so a pool of N workers stays within mobile memory).
 */
export function createEngine(id: string, options?: Record<string, string | number>): Engine {
  const def = DEFS.find((d) => d.meta.id === id);
  if (!def) throw new Error(`Unknown engine: ${id}`);
  return build(def, options);
}

export const DEFAULT_ENGINE_ID = DEFS[0].meta.id;

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__getEngine = getEngine;
