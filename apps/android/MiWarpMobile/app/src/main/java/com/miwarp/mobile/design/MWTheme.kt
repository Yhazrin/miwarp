package com.miwarp.mobile.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// ── Spacing ─────────────────────────────────────────────────────────────────

data class MWSpacing(
    val xxs: Dp = 4.dp,
    val xs: Dp = 8.dp,
    val sm: Dp = 12.dp,
    val md: Dp = 16.dp,
    val lg: Dp = 20.dp,
    val xl: Dp = 24.dp,
    val xxl: Dp = 32.dp,
    val xxxl: Dp = 40.dp,
    val xxxxl: Dp = 48.dp,
)

// ── Radius ──────────────────────────────────────────────────────────────────

data class MWRadius(
    val sm: Dp = 6.dp,
    val md: Dp = 8.dp,
    val lg: Dp = 10.dp,
    val xl: Dp = 14.dp,
)

// ── Motion ──────────────────────────────────────────────────────────────────

data class MWMotion(
    val fast: Int = 120,
    val normal: Int = 180,
    val slow: Int = 280,
)

// ── Composition Locals ──────────────────────────────────────────────────────

val LocalMWColors = staticCompositionLocalOf { darkColors }
val LocalMWSpacing = staticCompositionLocalOf { MWSpacing() }
val LocalMWRadius = staticCompositionLocalOf { MWRadius() }
val LocalMWMotion = staticCompositionLocalOf { MWMotion() }

private val darkColors = mwColors(isDark = true)

// ── Theme composable ────────────────────────────────────────────────────────

@Composable
fun MWTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = mwColors(isDark = darkTheme)

    val materialColorScheme = if (darkTheme) {
        darkColorScheme(
            primary = colors.accentPrimary,
            secondary = colors.accentCyan,
            tertiary = colors.accentBlue,
            background = colors.bgBase,
            surface = colors.bgSurface,
            surfaceVariant = colors.bgElevated,
            onPrimary = colors.textPrimary,
            onSecondary = colors.textPrimary,
            onTertiary = colors.textPrimary,
            onBackground = colors.textPrimary,
            onSurface = colors.textPrimary,
            onSurfaceVariant = colors.textSecondary,
            error = colors.statusError,
            onError = colors.textPrimary,
            outline = colors.divider,
            outlineVariant = colors.glassBorder,
        )
    } else {
        lightColorScheme(
            primary = colors.accentPrimary,
            secondary = colors.accentCyan,
            tertiary = colors.accentBlue,
            background = colors.bgBase,
            surface = colors.bgSurface,
            surfaceVariant = colors.bgElevated,
            onPrimary = colors.textPrimary,
            onSecondary = colors.textPrimary,
            onTertiary = colors.textPrimary,
            onBackground = colors.textPrimary,
            onSurface = colors.textPrimary,
            onSurfaceVariant = colors.textSecondary,
            error = colors.statusError,
            onError = colors.textPrimary,
            outline = colors.divider,
            outlineVariant = colors.glassBorder,
        )
    }

    CompositionLocalProvider(
        LocalMWColors provides colors,
        LocalMWSpacing provides MWSpacing(),
        LocalMWRadius provides MWRadius(),
        LocalMWMotion provides MWMotion(),
    ) {
        MaterialTheme(
            colorScheme = materialColorScheme,
            typography = mwTypography(),
            content = content,
        )
    }
}

// ── Theme accessor ──────────────────────────────────────────────────────────

object MWTheme {
    val colors: MWColorTokens
        @Composable @ReadOnlyComposable get() = LocalMWColors.current

    val spacing: MWSpacing
        @Composable @ReadOnlyComposable get() = LocalMWSpacing.current

    val radius: MWRadius
        @Composable @ReadOnlyComposable get() = LocalMWRadius.current

    val motion: MWMotion
        @Composable @ReadOnlyComposable get() = LocalMWMotion.current
}
