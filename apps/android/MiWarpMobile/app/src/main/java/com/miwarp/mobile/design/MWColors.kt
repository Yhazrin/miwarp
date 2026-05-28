package com.miwarp.mobile.design

import androidx.compose.ui.graphics.Color

/**
 * MiWarp color tokens ported from the Codex Dark design system.
 * All colors defined as HSL-ported Color vals.
 */
data class MWColorTokens(
    // Backgrounds
    val bgDeepest: Color,
    val bgDeep: Color,
    val bgBase: Color,
    val bgElevated: Color,
    val bgSurface: Color,
    val bgHover: Color,

    // Glass
    val glassBg: Color,
    val glassBorder: Color,

    // Accents
    val accentPrimary: Color,
    val accentCyan: Color,
    val accentBlue: Color,
    val accentOnAccent: Color,

    // Text
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,

    // Status
    val statusSuccess: Color,
    val statusWarning: Color,
    val statusError: Color,
    val statusRunning: Color,
    val statusDone: Color,
    val statusFailed: Color,
    val statusPending: Color,
    val statusIdle: Color,

    // Utility
    val divider: Color,
    val overlay: Color,
)

fun mwColors(isDark: Boolean): MWColorTokens = if (isDark) darkColors else lightColors

private val darkColors = MWColorTokens(
    // Backgrounds
    bgDeepest = Color.hsl(hue = 220f, saturation = 0.18f, lightness = 0.06f),
    bgDeep = Color.hsl(hue = 220f, saturation = 0.16f, lightness = 0.09f),
    bgBase = Color.hsl(hue = 220f, saturation = 0.14f, lightness = 0.12f),
    bgElevated = Color.hsl(hue = 220f, saturation = 0.12f, lightness = 0.15f),
    bgSurface = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.18f),
    bgHover = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.21f),

    // Glass
    glassBg = Color.hsl(hue = 220f, saturation = 0.18f, lightness = 0.11f).copy(alpha = 0.72f),
    glassBorder = Color.hsl(hue = 220f, saturation = 0.30f, lightness = 0.50f).copy(alpha = 0.12f),

    // Accents
    accentPrimary = Color.hsl(hue = 210f, saturation = 1.00f, lightness = 0.60f),
    accentCyan = Color.hsl(hue = 185f, saturation = 0.85f, lightness = 0.55f),
    accentBlue = Color.hsl(hue = 199f, saturation = 0.89f, lightness = 0.48f),
    accentOnAccent = Color.White,

    // Text
    textPrimary = Color.hsl(hue = 0f, saturation = 0.00f, lightness = 0.94f),
    textSecondary = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.62f),
    textTertiary = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.42f),

    // Status
    statusSuccess = Color.hsl(hue = 152f, saturation = 0.55f, lightness = 0.55f),
    statusWarning = Color.hsl(hue = 38f, saturation = 0.80f, lightness = 0.55f),
    statusError = Color.hsl(hue = 0f, saturation = 0.72f, lightness = 0.60f),
    statusRunning = Color.hsl(hue = 217f, saturation = 0.91f, lightness = 0.60f),
    statusDone = Color.hsl(hue = 160f, saturation = 0.84f, lightness = 0.39f),
    statusFailed = Color.hsl(hue = 0f, saturation = 0.72f, lightness = 0.51f),
    statusPending = Color.hsl(hue = 38f, saturation = 0.92f, lightness = 0.50f),
    statusIdle = Color.hsl(hue = 220f, saturation = 0.09f, lightness = 0.64f),

    // Utility
    divider = Color.hsl(hue = 220f, saturation = 0.12f, lightness = 0.20f),
    overlay = Color.Black.copy(alpha = 0.5f),
)

private val lightColors = MWColorTokens(
    // Backgrounds
    bgDeepest = Color.hsl(hue = 0f, saturation = 0.00f, lightness = 0.98f),
    bgDeep = Color.hsl(hue = 0f, saturation = 0.00f, lightness = 0.96f),
    bgBase = Color.hsl(hue = 0f, saturation = 0.00f, lightness = 1.00f),
    bgElevated = Color.hsl(hue = 0f, saturation = 0.00f, lightness = 0.98f),
    bgSurface = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.96f),
    bgHover = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.93f),

    // Glass
    glassBg = Color.White.copy(alpha = 0.80f),
    glassBorder = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.85f).copy(alpha = 0.50f),

    // Accents
    accentPrimary = Color.hsl(hue = 210f, saturation = 1.00f, lightness = 0.50f),
    accentCyan = Color.hsl(hue = 185f, saturation = 0.85f, lightness = 0.42f),
    accentBlue = Color.hsl(hue = 199f, saturation = 0.89f, lightness = 0.40f),
    accentOnAccent = Color.White,

    // Text
    textPrimary = Color.hsl(hue = 220f, saturation = 0.18f, lightness = 0.12f),
    textSecondary = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.42f),
    textTertiary = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.58f),

    // Status
    statusSuccess = Color.hsl(hue = 152f, saturation = 0.55f, lightness = 0.42f),
    statusWarning = Color.hsl(hue = 38f, saturation = 0.80f, lightness = 0.42f),
    statusError = Color.hsl(hue = 0f, saturation = 0.72f, lightness = 0.50f),
    statusRunning = Color.hsl(hue = 217f, saturation = 0.91f, lightness = 0.50f),
    statusDone = Color.hsl(hue = 160f, saturation = 0.84f, lightness = 0.32f),
    statusFailed = Color.hsl(hue = 0f, saturation = 0.72f, lightness = 0.45f),
    statusPending = Color.hsl(hue = 38f, saturation = 0.92f, lightness = 0.40f),
    statusIdle = Color.hsl(hue = 220f, saturation = 0.09f, lightness = 0.50f),

    // Utility
    divider = Color.hsl(hue = 220f, saturation = 0.10f, lightness = 0.88f),
    overlay = Color.Black.copy(alpha = 0.3f),
)

/** Map RunStatus to its display color */
fun MWColorTokens.colorForStatus(status: com.miwarp.mobile.model.RunStatus): Color = when (status) {
    com.miwarp.mobile.model.RunStatus.Pending -> statusPending
    com.miwarp.mobile.model.RunStatus.Running -> statusRunning
    com.miwarp.mobile.model.RunStatus.Idle -> statusIdle
    com.miwarp.mobile.model.RunStatus.WaitingApproval -> statusWarning
    com.miwarp.mobile.model.RunStatus.Completed -> statusDone
    com.miwarp.mobile.model.RunStatus.Failed -> statusFailed
    com.miwarp.mobile.model.RunStatus.Stopped -> statusIdle
}
