package com.altorstudio.chessany

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Crisp, device-tuned haptics. @capacitor/haptics implements Android "impact"
 * as a hand-rolled 43–60ms amplitude waveform, which smears into a mushy buzz
 * on most actuators. The OS's predefined effects (EFFECT_TICK / EFFECT_CLICK /
 * EFFECT_HEAVY_CLICK / EFFECT_DOUBLE_CLICK, API 29+) are calibrated per device
 * by the vendor and feel like the system keyboard — that's the "precise" feel.
 *
 * effect: "tick" (UI selection) | "click" (piece lands) | "heavyClick"
 * (game end / blunder) | "doubleClick" (error-ish, distinctive).
 */
@CapacitorPlugin(name = "HapticTick")
class HapticTickPlugin : Plugin() {
    private val vibrator: Vibrator by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    @PluginMethod
    fun tick(call: PluginCall) {
        val effect = call.getString("effect") ?: "tick"
        try {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> {
                    vibrator.vibrate(
                        VibrationEffect.createPredefined(
                            when (effect) {
                                "click" -> VibrationEffect.EFFECT_CLICK
                                "heavyClick" -> VibrationEffect.EFFECT_HEAVY_CLICK
                                "doubleClick" -> VibrationEffect.EFFECT_DOUBLE_CLICK
                                else -> VibrationEffect.EFFECT_TICK
                            }
                        )
                    )
                }
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> {
                    // No predefined effects yet: a 10–20ms one-shot is the
                    // key-click sweet spot (longer starts to feel buzzy).
                    when (effect) {
                        "click" -> vibrator.vibrate(VibrationEffect.createOneShot(18, 180))
                        "heavyClick" -> vibrator.vibrate(VibrationEffect.createOneShot(25, 255))
                        "doubleClick" -> vibrator.vibrate(
                            VibrationEffect.createWaveform(longArrayOf(0, 15, 80, 15), intArrayOf(0, 200, 0, 200), -1)
                        )
                        else -> vibrator.vibrate(VibrationEffect.createOneShot(10, 130))
                    }
                }
                else -> {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(if (effect == "tick") 8L else 15L)
                }
            }
        } catch (_: Exception) {
            // Haptics are best-effort — never fail the call.
        }
        call.resolve()
    }
}
