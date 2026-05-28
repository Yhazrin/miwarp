package com.miwarp.mobile.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback

/**
 * Provides haptic feedback utilities for consistent tactile responses across the app.
 * Mirrors the iOS MiHaptics API.
 */
object MiHaptics {

    @Composable
    fun rememberHaptics(): HapticCaller {
        val haptic = LocalHapticFeedback.current
        return remember(haptic) { HapticCaller(haptic) }
    }

    class HapticCaller(private val haptic: HapticFeedback) {
        fun lightImpact() = haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        fun mediumImpact() = haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        fun success() = haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        fun error() = haptic.performHapticFeedback(HapticFeedbackType.LongPress)
    }
}
