import SwiftUI

// MARK: - HSL Color Helper

extension Color {
    /// Initialize Color from HSL values (all 0-1 range, hue in degrees/360)
    init(hue: Double, saturation: Double, lightness: Double, opacity: Double = 1.0) {
        // Convert HSL to HSB
        let l = lightness
        let s = saturation
        let lPlusS = l + s
        let twoL = 2 * l
        let brightness = min(lPlusS, 1.0)
        let saturationHSB = brightness > 0 ? (lPlusS - min(twoL, 1.0)) / min(lPlusS, 1.0) : 0
        self.init(hue: hue, saturation: saturationHSB, brightness: brightness, opacity: opacity)
    }
}

// MARK: - MiWarp Colors

enum MWColors {
    // MARK: - Backgrounds (Dark)

    static var bgDeepest: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.18, lightness: 0.06)
    }

    static var bgDeep: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.16, lightness: 0.09)
    }

    static var bgBase: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.14, lightness: 0.12)
    }

    static var bgElevated: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.12, lightness: 0.15)
    }

    static var bgSurface: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.18)
    }

    static var bgHover: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.21)
    }

    // MARK: - Glass

    static var glassBg: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.18, lightness: 0.11, opacity: 0.72)
    }

    static var glassBorder: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.30, lightness: 0.50, opacity: 0.12)
    }

    // MARK: - Accents

    static var accentPrimary: Color {
        Color(hue: 210.0 / 360.0, saturation: 1.0, lightness: 0.60)
    }

    static var accentCyan: Color {
        Color(hue: 185.0 / 360.0, saturation: 0.85, lightness: 0.55)
    }

    static var accentBlue: Color {
        Color(hue: 199.0 / 360.0, saturation: 0.89, lightness: 0.48)
    }

    // MARK: - Text

    static var textPrimary: Color {
        Color(hue: 0, saturation: 0, lightness: 0.94)
    }

    static var textSecondary: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.62)
    }

    static var textTertiary: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.42)
    }

    // MARK: - Status

    static var statusSuccess: Color {
        Color(hue: 152.0 / 360.0, saturation: 0.55, lightness: 0.55)
    }

    static var statusWarning: Color {
        Color(hue: 38.0 / 360.0, saturation: 0.80, lightness: 0.55)
    }

    static var statusError: Color {
        Color(hue: 0, saturation: 0.72, lightness: 0.60)
    }

    static var statusRunning: Color {
        Color(hue: 217.0 / 360.0, saturation: 0.91, lightness: 0.60)
    }

    static var statusDone: Color {
        Color(hue: 160.0 / 360.0, saturation: 0.84, lightness: 0.39)
    }

    static var statusFailed: Color {
        Color(hue: 0, saturation: 0.72, lightness: 0.51)
    }

    static var statusPending: Color {
        Color(hue: 38.0 / 360.0, saturation: 0.92, lightness: 0.50)
    }

    static var statusIdle: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.09, lightness: 0.64)
    }

    // MARK: - Light Mode Overrides

    static var lightBgDeepest: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.98)
    }

    static var lightBgDeep: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.96)
    }

    static var lightBgBase: Color {
        Color(hue: 0, saturation: 0, lightness: 1.0)
    }

    static var lightBgElevated: Color {
        Color(hue: 0, saturation: 0, lightness: 0.96)
    }

    static var lightBgSurface: Color {
        Color(hue: 0, saturation: 0, lightness: 0.94)
    }

    static var lightBgHover: Color {
        Color(hue: 0, saturation: 0, lightness: 0.92)
    }

    static var lightGlassBg: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.15, lightness: 0.92, opacity: 0.85)
    }

    static var lightGlassBorder: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.15, lightness: 0.70, opacity: 0.25)
    }

    static var lightTextPrimary: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.18, lightness: 0.12)
    }

    static var lightTextSecondary: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.42)
    }

    static var lightTextTertiary: Color {
        Color(hue: 220.0 / 360.0, saturation: 0.08, lightness: 0.55)
    }

    // MARK: - Glow

    static var glowCyan: Color {
        accentCyan.opacity(0.20)
    }

    static var glowRunning: Color {
        statusRunning.opacity(0.25)
    }

    static var glowApproval: Color {
        statusWarning.opacity(0.20)
    }

    // MARK: - ColorScheme-aware accessors

    static func bgDeepest(for scheme: ColorScheme) -> Color {
        scheme == .dark ? bgDeepest : lightBgDeepest
    }

    static func bgDeep(for scheme: ColorScheme) -> Color {
        scheme == .dark ? bgDeep : lightBgDeep
    }

    static func bgBase(for scheme: ColorScheme) -> Color {
        scheme == .dark ? bgBase : lightBgBase
    }

    static func bgElevated(for scheme: ColorScheme) -> Color {
        scheme == .dark ? bgElevated : lightBgElevated
    }

    static func bgSurface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? bgSurface : lightBgSurface
    }

    static func bgHover(for scheme: ColorScheme) -> Color {
        scheme == .dark ? bgHover : lightBgHover
    }

    static func glassBg(for scheme: ColorScheme) -> Color {
        scheme == .dark ? glassBg : lightGlassBg
    }

    static func glassBorder(for scheme: ColorScheme) -> Color {
        scheme == .dark ? glassBorder : lightGlassBorder
    }

    static func textPrimary(for scheme: ColorScheme) -> Color {
        scheme == .dark ? textPrimary : lightTextPrimary
    }

    static func textSecondary(for scheme: ColorScheme) -> Color {
        scheme == .dark ? textSecondary : lightTextSecondary
    }

    static func textTertiary(for scheme: ColorScheme) -> Color {
        scheme == .dark ? textTertiary : lightTextTertiary
    }

    // MARK: - Status Color Mapping

    static func color(for status: RunStatus) -> Color {
        switch status {
        case .running: return statusRunning
        case .idle: return statusIdle
        case .waitingInput: return statusPending
        case .waitingApproval: return statusWarning
        case .completed: return statusDone
        case .failed: return statusFailed
        case .stopped: return statusError
        }
    }
}
