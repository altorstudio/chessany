# Native UCI engine plugin — build runbook

> **Status:** the app currently ships **Stockfish only**. The Reckless engine
> (and its `build-reckless-android.sh` script + `libreckless.so` binary) was
> removed. The Reckless sections below are kept purely as a worked example of
> how to add a *second* native engine should you ever want one.

Goal: run real, **multi-threaded native engines** (Stockfish, and any future
engine) on device instead of the single-threaded WASM build — much
faster/stronger search.

The web app keeps using the WASM engines; native is an additional, faster
transport that the app picks **automatically when present**.

---

## How it fits together (already wired on the JS side)

```
play / analysis / report
        │  (only ever talk to the Engine interface)
        ▼
   Engine  ◄────────────── registry.ts  build():
   ├─ UciWorkerEngine            if nativeKey && nativeEngineAvailable() → NativeUciEngine
   │     (WASM worker, web)      else if worker → UciWorkerEngine
   └─ NativeUciEngine
         │  UciEngine plugin  (registerPlugin "UciEngine")
         ▼
   native host  ──► runs a UCI engine, streams stdout as `line` events
```

Done already and verified on web:
- `src/engines/native/uciEnginePlugin.ts` — the `UciEngine` plugin contract.
- `src/engines/NativeUciEngine.ts` — `Engine` impl over the plugin (same
  handshake / search-serializer / MultiPV logic as the worker engine).
- `src/engines/registry.ts` — `nativeKey` per engine; `build()` prefers native
  when `Capacitor.isPluginAvailable("UciEngine")`; `availableEngineMetas()` hides
  native-only engines (Reckless) on platforms without the plugin.

**The plugin contract the native side must implement** (one instance at a time
is fine — the app creates/quits engines as needed):

| Method/Event | Behavior |
|---|---|
| `start({ engine })` | boot the engine identified by key (`"stockfish"`, `"reckless"`); resolve once running |
| `send({ command })` | write one UCI line to the engine's stdin (preserve order) |
| `stop()` | kill the engine, free resources |
| `line` event | fire once per stdout line the engine prints |

---

## Status

- ✅ JS foundation wired & verified (plugin contract, `NativeUciEngine`,
  platform-aware registry with a boot probe + safe WASM fallback).
- ✅ **Android plugin is in the repo and compiles** — Kotlin
  (`UciEnginePlugin.kt`), registered in the Kotlin `MainActivity`. It runs the
  engine as a subprocess and reports `availableEngines()` by checking which
  `lib<key>.so` are bundled.
- ✅ **Stockfish for Android builds with one command** —
  `scripts/build-stockfish-android.sh` cross-compiles it (NNUE embedded) into
  `jniLibs/arm64-v8a/libstockfish.so`. The debug APK bundles it (~73 MB) and the
  app auto-switches to native Stockfish on device. `useLegacyPackaging=true` is
  set so the binary is extracted to disk and can be exec'd.
- ✅ **Reckless for Android builds with one command** —
  `scripts/build-reckless-android.sh` cross-compiles the Rust engine (NNUE
  embedded, `--no-default-features` to drop the Syzygy cc/bindgen step) into
  `jniLibs/arm64-v8a/libreckless.so`. Appears in the picker on device.
- ⬜ iOS plugin + engine library.

> **Size note:** each engine embeds its NNUE net (~76 MB Stockfish, ~62 MB
> Reckless), so the arm64-only debug APK with both is ~135 MB. Fine for sideload.
> For distribution: AAB with ABI splits, ship one engine, or load nets from
> assets instead of embedding.

## Build prerequisite: JDK 21

Capacitor 8 needs JDK 21+, and the Kotlin compiler does **not** support JDK 25,
so the Android build is pinned to JDK 21 via `android/gradle.properties`
(`org.gradle.java.home`). Install it once and adjust the path if needed:

```bash
brew install openjdk@21
/usr/libexec/java_home -v 21   # confirm the path matches gradle.properties
```

After that, `./gradlew assembleDebug` and `npx cap run android` "just work" — no
`-Dorg.gradle.java.home` flag needed.

## Platform reality

| | Android | iOS |
|---|---|---|
| Run engine as **subprocess** (stdin/stdout) | ✅ allowed (`ProcessBuilder` on a packaged executable) | ❌ forbidden (no fork/exec) |
| Run engine as **linked library** | optional | ✅ required |
| Engine modification needed | **none** (use the stock UCI binary) | must expose a callable UCI entry (FFI) |

So Android is the quick win (no engine changes); iOS needs the engine built as a
static library with a small FFI shim.

---

## Step 1 — Add the plugin to the app projects

```bash
npx cap add ios        # if not added yet
npx cap add android    # already present
```

Create one custom Capacitor plugin per platform (below). Capacitor auto-registers
plugin classes in the app project — no JS package needed.

---

## Step 2 — Android plugin (subprocess approach) ✅ already in the repo

This is done: `android/app/src/main/java/com/altorstudio/chessany/UciEnginePlugin.kt`
(Kotlin, registered in `MainActivity.kt`). It also implements `availableEngines()`
so the app only uses native for engines whose binaries are present. You only need
to drop in the binaries (below). For reference, the plugin:

```kotlin
package com.altorstudio.chessany

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import kotlin.concurrent.thread

@CapacitorPlugin(name = "UciEngine")
class UciEnginePlugin : Plugin() {
    private var process: Process? = null
    private var writer: java.io.Writer? = null

    @PluginMethod
    fun start(call: PluginCall) {
        stopProcess()
        val engine = call.getString("engine") ?: return call.reject("engine required")
        // Engines are packaged as executables in jniLibs so Android lets us exec
        // them from nativeLibraryDir. Convention: lib<engine>.so
        val libDir = context.applicationInfo.nativeLibraryDir
        val bin = File(libDir, "lib$engine.so")
        if (!bin.exists()) return call.reject("engine binary missing: ${bin.path}")

        try {
            val p = ProcessBuilder(bin.path)
                .redirectErrorStream(true)
                .start()
            process = p
            writer = p.outputStream.bufferedWriter()
            // Pump stdout → `line` events on a background thread.
            thread(isDaemon = true) {
                BufferedReader(InputStreamReader(p.inputStream)).useLines { lines ->
                    lines.forEach { line -> notifyListeners("line", JSObject().put("line", line)) }
                }
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("failed to start engine", e)
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val cmd = call.getString("command") ?: return call.reject("command required")
        try {
            writer?.apply { write(cmd); write("\n"); flush() }
            call.resolve()
        } catch (e: Exception) { call.reject("send failed", e) }
    }

    @PluginMethod
    fun stop(call: PluginCall) { stopProcess(); call.resolve() }

    private fun stopProcess() {
        try { writer?.apply { write("quit\n"); flush() } } catch (_: Exception) {}
        process?.destroy(); process = null; writer = null
    }

    override fun handleOnDestroy() { stopProcess() }
}
```

Build the engine executables (one per ABI) and drop them in
`android/app/src/main/jniLibs/<abi>/lib<engine>.so`.

- **Stockfish** (no source changes):
  ```bash
  git clone --depth 1 https://github.com/official-stockfish/Stockfish
  cd Stockfish/src
  # Repeat for arm64-v8a (aarch64), armeabi-v7a, x86_64 using the NDK clang.
  make -j build ARCH=armv8 COMP=ndk CXX=aarch64-linux-android24-clang++
  cp stockfish .../jniLibs/arm64-v8a/libstockfish.so
  ```
  Bundle the NNUE `.nnue` net as an Android asset and `setoption name EvalFile`
  to its path, or build with the net embedded.

- **Reckless** (Rust, no source changes — it's a UCI binary):
  ```bash
  rustup target add aarch64-linux-android
  cargo install cargo-ndk
  cargo ndk -t arm64-v8a -t x86_64 -o ./out build --release
  cp out/arm64-v8a/reckless .../jniLibs/arm64-v8a/libreckless.so
  ```
  (Android only loads files named `lib*.so` from jniLibs; renaming the binary is
  enough — it's still a normal executable.)

> Threads: pass `setoption name Threads value N` (we currently default to 1; bump
> it for native — see "Step 4").

---

## Step 3 — iOS plugin (linked-library approach)

iOS can't spawn processes, so link the engine as a static library exposing a
tiny C FFI, and run its UCI loop on a GCD background queue.

**FFI the engine library must export** (same shape for Stockfish C++ and Reckless Rust):

```c
// engine_uci.h
typedef void (*uci_line_cb)(const char *line);
void engine_start(const char *engine, uci_line_cb cb); // spawn UCI loop on its own thread
void engine_send(const char *command);                 // feed one UCI line
void engine_stop(void);
```

- **Stockfish**: compile `src/*.cpp` into a static lib (`xcodebuild`/`clang++ -target arm64-apple-ios`), and replace `main()`'s stdin loop with `engine_send` pushing into Stockfish's `UCI::loop` input, routing `sync_cout` to `cb`. (Several open iOS Stockfish ports do exactly this — reference one.)
- **Reckless** (Rust): add a `staticlib` crate target that wraps Reckless's UCI loop behind the three `extern "C"` functions above, then:
  ```bash
  rustup target add aarch64-apple-ios
  cargo build --release --target aarch64-apple-ios   # → libreckless.a
  ```

`ios/App/App/UciEnginePlugin.swift`

```swift
import Capacitor

@objc(UciEnginePlugin)
public class UciEnginePlugin: CAPPlugin {
    static var emit: ((String) -> Void)?

    @objc func start(_ call: CAPPluginCall) {
        guard let engine = call.getString("engine") else { return call.reject("engine required") }
        UciEnginePlugin.emit = { [weak self] line in
            self?.notifyListeners("line", data: ["line": line])
        }
        DispatchQueue.global(qos: .userInitiated).async {
            engine_start(engine, { cptr in
                if let c = cptr { UciEnginePlugin.emit?(String(cString: c)) }
            })
        }
        call.resolve()
    }
    @objc func send(_ call: CAPPluginCall) {
        guard let cmd = call.getString("command") else { return call.reject("command required") }
        engine_send(cmd); call.resolve()
    }
    @objc func stop(_ call: CAPPluginCall) { engine_stop(); call.resolve() }
}
```

Plus the small `UciEnginePlugin.m` Capacitor registration macro (standard) and
add `libreckless.a` / `libstockfish.a` + `engine_uci.h` to the Xcode target,
bundling the NNUE net as a resource.

---

## Step 4 — Turn it on

No JS changes needed — once the plugin is installed, `nativeEngineAvailable()`
is true on device, so `getEngine("stockfish")` returns the native engine and
`"reckless"` appears in the picker automatically.

Two small follow-ups in `src/engines/registry.ts` once native is live:
- Bump native `defaultOptions.Threads` (e.g. `navigator.hardwareConcurrency - 1`).
- For the **report worker pool**, set concurrency to **1** for native engines
  (a native engine already uses every core per search, so a pool would
  oversubscribe). The WASM/web path keeps the multi-worker pool.

---

## Step 5 — Test

```bash
npm run build && npx cap sync
npx cap run android        # subprocess engine
npx cap run ios            # library engine
```

Pick Stockfish (or Reckless on device) → analysis lines should flow and reports
finish much faster. If `line` events never arrive, check the engine binary path
(Android logcat) / FFI symbol linkage (iOS).

---

## Effort & licensing reminders
- Android (subprocess): low — no engine changes. iOS (library + FFI): the bulk
  of the work, especially the Reckless `staticlib` wrapper.
- **GPLv3 (Stockfish) / AGPL-3.0 (Reckless)**: bundling them makes the app
  subject to those licenses — ship the source. (Confirmed OK.)
```
