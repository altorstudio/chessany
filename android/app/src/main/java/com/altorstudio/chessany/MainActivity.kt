package com.altorstudio.chessany

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register the native UCI-engine host before the bridge starts.
        registerPlugin(UciEnginePlugin::class.java)
        // Crisp device-tuned haptic effects (predefined VibrationEffects).
        registerPlugin(HapticTickPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
