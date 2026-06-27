package com.altorstudio.chessany

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.Writer
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Generic native UCI-engine host. Runs ONE bundled UCI engine at a time as a
 * subprocess (Android permits executing binaries packaged in jniLibs), pumping
 * its stdout to JS as `line` events.
 *
 * Switching engines is the tricky part — it must be atomic and clean, or the
 * app crashes:
 *  - start()/send()/stop() are guarded by a single lock so they never interleave.
 *  - starting an engine fully stops the previous one AND waits for it to die,
 *    so two heavy processes never coexist (memory) and the old one is gone first.
 *  - each engine's reader thread is tagged to its own process and only emits
 *    while it is still the current one — a switched-away engine's trailing
 *    output is dropped instead of cross-wiring into the new engine.
 *
 * Add an engine later: drop its binary at jniLibs/<abi>/lib<key>.so and add the
 * key to [knownEngines]; no other changes.
 */
@CapacitorPlugin(name = "UciEngine")
class UciEnginePlugin : Plugin() {
    private val lock = Any()
    private var process: Process? = null
    private var writer: Writer? = null

    private val knownEngines = listOf("stockfish")

    private fun binaryFor(engine: String): File =
        File(context.applicationInfo.nativeLibraryDir, "lib$engine.so")

    /** Report which engines actually have a bundled, runnable binary. */
    @PluginMethod
    fun availableEngines(call: PluginCall) {
        val present = JSArray()
        knownEngines.filter { binaryFor(it).exists() }.forEach { present.put(it) }
        call.resolve(JSObject().put("engines", present))
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val engine = call.getString("engine") ?: return call.reject("engine required")
        val bin = binaryFor(engine)
        if (!bin.exists()) return call.reject("engine binary missing: ${bin.path}")
        synchronized(lock) {
            stopLocked() // fully stop & free any current engine before starting
            try {
                val p = ProcessBuilder(bin.path).redirectErrorStream(true).start()
                process = p
                writer = p.outputStream.bufferedWriter()
                startReader(p)
                reportCpuDiag(p)
                call.resolve()
            } catch (e: Exception) {
                call.reject("failed to start engine", e)
            }
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val cmd = call.getString("command") ?: return call.reject("command required")
        synchronized(lock) {
            try {
                writer?.apply { write(cmd); write("\n"); flush() }
                call.resolve()
            } catch (e: Exception) {
                call.reject("send failed", e)
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        synchronized(lock) { stopLocked() }
        call.resolve()
    }

    /**
     * Reader thread bound to `mine`; emits only while it's the current process.
     *
     * Critically, it drains stdout in a tight loop so the engine NEVER blocks on
     * writing (a multi-threaded engine emits thousands of info lines/sec — if we
     * crossed the JS bridge for every one, the pipe would fill and the engine
     * would stall, capping nps regardless of thread count). Instead we coalesce:
     * keep only the latest `info` line per PV and flush to JS ~20×/sec, while
     * control lines (uciok/readyok/bestmove) pass through immediately.
     */
    private val mpvRe = Regex("multipv (\\d+)")

    private fun startReader(mine: Process) {
        thread(isDaemon = true) {
            val latest = LinkedHashMap<String, String>() // pv key -> newest info line
            var lastFlush = 0L

            fun isCurrent(): Boolean { synchronized(lock) { return process === mine } }
            fun emit(line: String) {
                try { notifyListeners("line", JSObject().put("line", line)) } catch (_: Exception) {}
            }
            fun flush() { for (l in latest.values) emit(l); latest.clear() }

            try {
                val reader = BufferedReader(InputStreamReader(mine.inputStream))
                while (true) {
                    val line = reader.readLine() ?: break
                    if (!isCurrent()) break
                    when {
                        line.startsWith("bestmove") -> { flush(); emit(line) }
                        line.startsWith("info string") -> emit(line) // diagnostics
                        line.startsWith("info ") && line.contains(" pv ") -> {
                            // Buffer the newest PV line; flush at most ~20×/sec.
                            val pv = mpvRe.find(line)?.groupValues?.get(1) ?: "1"
                            latest[pv] = line
                            val now = System.currentTimeMillis()
                            if (now - lastFlush >= 50) { flush(); lastFlush = now }
                        }
                        // Other `info` lines (currmove, hashfull, …) flood at high
                        // node rates and the UI ignores them — drop, but keep
                        // draining stdout so the engine never blocks.
                        line.startsWith("info ") -> { /* drop */ }
                        else -> emit(line) // uciok / readyok / id / etc.
                    }
                }
                flush()
            } catch (_: Exception) {
                /* stream closed on shutdown */
            }
        }
    }

    private fun pidOf(p: Process): Int? = try {
        val f = p.javaClass.getDeclaredField("pid")
        f.isAccessible = true
        f.getInt(p)
    } catch (_: Throwable) {
        null
    }

    /** Report the engine subprocess's allowed CPUs AND its real OS thread count
     *  (so we can tell whether `setoption Threads` actually spawned workers). */
    private fun reportCpuDiag(p: Process) {
        thread(isDaemon = true) {
            try {
                val pid = pidOf(p) ?: return@thread
                Thread.sleep(4000) // let the engine allocate its thread pool first
                synchronized(lock) { if (process !== p) return@thread }
                val status = File("/proc/$pid/status").readText()
                val cpus = Regex("Cpus_allowed_list:\\s*(.+)").find(status)?.groupValues?.get(1)?.trim()
                val osThreads = Regex("Threads:\\s*(\\d+)").find(status)?.groupValues?.get(1)
                notifyListeners(
                    "line",
                    JSObject().put(
                        "line",
                        "info string cpus_allowed=$cpus osThreads=$osThreads appCores=${Runtime.getRuntime().availableProcessors()}",
                    ),
                )
            } catch (_: Throwable) {
            }
        }
    }

    /** Stop the current engine and wait for it to actually terminate. */
    private fun stopLocked() {
        val p = process ?: return
        process = null
        try { writer?.apply { write("quit\n"); flush() } } catch (_: Exception) {}
        writer = null
        p.destroy()
        try {
            if (!p.waitFor(1, TimeUnit.SECONDS)) p.destroyForcibly()
        } catch (_: Exception) {
            p.destroyForcibly()
        }
    }

    override fun handleOnDestroy() {
        synchronized(lock) { stopLocked() }
    }
}
