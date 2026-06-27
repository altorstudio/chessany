import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

/**
 * Generic native UCI-engine host. The native side (iOS Swift / Android Kotlin)
 * runs ANY bundled UCI engine on a background thread and streams its stdout back
 * as `line` events — so adding a new engine later is just bundling its binary +
 * registering a key, with zero new bridge code.
 *
 * Contract the native implementation must honor:
 *  - `start({ engine })` boots the engine identified by `engine` and resolves
 *    once the process is running (before the UCI handshake).
 *  - `send({ command })` writes one UCI command line to the engine's stdin.
 *  - every line the engine prints to stdout fires a `line` event.
 *  - `stop()` kills the engine and frees its resources.
 */
export interface UciEnginePlugin {
  /** Engine keys whose native binaries are actually bundled and runnable. */
  availableEngines(): Promise<{ engines: string[] }>;
  start(options: { engine: string }): Promise<void>;
  send(options: { command: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: "line",
    listener: (data: { line: string }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

// On the web this resolves to a stub that rejects calls (there is no native
// host) — callers must only use it when `nativeEngineAvailable()` is true.
export const UciEngine = registerPlugin<UciEnginePlugin>("UciEngine");
