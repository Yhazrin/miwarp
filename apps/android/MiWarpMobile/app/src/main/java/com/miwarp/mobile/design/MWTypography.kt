package com.miwarp.mobile.design

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** MiWarp typography scale using system sans for UI and monospaced for code. */
object MWTypography {
    val heading = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.2).sp,
    )

    val subheading = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        letterSpacing = (-0.1).sp,
    )

    val body = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    )

    val bodySmall = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    )

    val caption = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    )

    val label = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    )

    val mono = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    )

    val monoSmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Normal,
        fontSize = 11.sp,
        lineHeight = 14.sp,
    )

    val buttonLabel = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.2.sp,
    )
}

/** Material 3 Typography using MiWarp base styles */
fun mwTypography(): Typography = Typography(
    displayLarge = MWTypography.heading.copy(fontSize = 28.sp, lineHeight = 36.sp),
    displayMedium = MWTypography.heading.copy(fontSize = 24.sp, lineHeight = 32.sp),
    headlineLarge = MWTypography.heading,
    headlineMedium = MWTypography.subheading,
    titleLarge = MWTypography.subheading,
    titleMedium = MWTypography.body.copy(fontWeight = FontWeight.SemiBold),
    titleSmall = MWTypography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
    bodyLarge = MWTypography.body,
    bodyMedium = MWTypography.bodySmall,
    bodySmall = MWTypography.caption,
    labelLarge = MWTypography.buttonLabel,
    labelMedium = MWTypography.label,
    labelSmall = MWTypography.caption,
)
