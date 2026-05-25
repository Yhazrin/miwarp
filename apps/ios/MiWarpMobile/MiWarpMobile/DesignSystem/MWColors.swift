import SwiftUI
import UIKit

// MARK: - Color Helpers

extension Color {
    /// Initialize Color from HSL values (all 0-1 range, hue in degrees/360).
    init(hue: Double, saturation: Double, lightness: Double, opacity: Double = 1.0) {
        let l = lightness
        let s = saturation
        let lPlusS = l + s
        let twoL = 2 * l
        let brightness = min(lPlusS, 1.0)
        let saturationHSB = brightness > 0 ? (lPlusS - min(twoL, 1.0)) / min(lPlusS, 1.0) : 0
        self.init(hue: hue, saturation: saturationHSB, brightness: brightness, opacity: opacity)
    }

    init(hex: UInt32, opacity: Double = 1.0) {
        let red = Double((hex >> 16) & 0xff) / 255.0
        let green = Double((hex >> 8) & 0xff) / 255.0
        let blue = Double(hex & 0xff) / 255.0
        self.init(red: red, green: green, blue: blue, opacity: opacity)
    }

    /// Perceived luminance in [0, 1] using ITU-R BT.709 coefficients.
    var perceivedLuminance: Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return 0.2126 * Double(r) + 0.7152 * Double(g) + 0.0722 * Double(b)
    }

    /// WCAG contrast ratio of this color against another.
    func contrastRatio(against other: Color) -> Double {
        let l1 = self.perceivedLuminance
        let l2 = other.perceivedLuminance
        let lighter = max(l1, l2)
        let darker = min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)
    }
}

// MARK: - Appearance

enum MWAppearanceMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark
    case custom

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        case .custom: return "Custom"
        }
    }

    var systemImage: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max.fill"
        case .dark: return "moon.fill"
        case .custom: return "paintpalette.fill"
        }
    }
}

enum MWTextureStrength: String, CaseIterable, Identifiable {
    case off
    case subtle
    case strong

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .off: return "Off"
        case .subtle: return "Subtle"
        case .strong: return "Strong"
        }
    }

    func opacity(for scheme: ColorScheme) -> Double {
        switch (self, scheme) {
        case (.off, _): return 0
        case (.subtle, .dark): return 0.08
        case (.strong, .dark): return 0.16
        case (.subtle, .light): return 0.05
        case (.strong, .light): return 0.10
        @unknown default: return 0.08
        }
    }
}

enum MWAccentTheme: String, CaseIterable, Identifiable {
    case defaultMiWarp
    case carbonPink
    case deepSeaMilk
    case auroraPomelo
    case pomegranateMist
    case auroraLime

    var id: String { rawValue }

    var requiresCustomAppearance: Bool {
        self != .defaultMiWarp
    }

    var displayName: String {
        switch self {
        case .defaultMiWarp: return "Default MiWarp"
        case .carbonPink: return "Carbon Pink"
        case .deepSeaMilk: return "Deep Sea Milk"
        case .auroraPomelo: return "Aurora Pomelo"
        case .pomegranateMist: return "Pomegranate Mist"
        case .auroraLime: return "Aurora Lime"
        }
    }

    var primarySwatch: Color {
        switch self {
        case .defaultMiWarp: return Color(hex: 0xFF6700)  // Xiaomi orange
        case .carbonPink: return Color(hex: 0x1A1A1D)    // 炭黑
        case .deepSeaMilk: return Color(hex: 0x122E8A)   // 深海蓝
        case .auroraPomelo: return Color(hex: 0x9F82FD)  // 极光紫
        case .pomegranateMist: return Color(hex: 0xE72D48) // 石榴红
        case .auroraLime: return Color(hex: 0x01847F)    // teal
        }
    }

    var secondarySwatch: Color {
        switch self {
        case .defaultMiWarp: return Color(hex: 0xFF6700)  // Xiaomi orange
        case .carbonPink: return Color(hex: 0xE6397C)     // 甜酷粉
        case .deepSeaMilk: return Color(hex: 0xF5EFEA)    // 柔奶白
        case .auroraPomelo: return Color(hex: 0xFBEA03)  // 蜜柚黄
        case .pomegranateMist: return Color(hex: 0xF1DDDF) // 雾粉桃
        case .auroraLime: return Color(hex: 0xF9D2E4)    // light pink
        }
    }
}

struct MWThemeTokens {
    let bgDeepest: Color
    let bgBase: Color
    let bgElevated: Color
    let bgSurface: Color
    let glassBg: Color
    let glassBorder: Color
    let textPrimary: Color
    let textSecondary: Color
    let textTertiary: Color
    let accentPrimary: Color
    let accentSecondary: Color
    let accentOnAccent: Color
    let statusRunning: Color
    let statusSuccess: Color
    let statusWarning: Color
    let statusError: Color
    let statusApproval: Color
    let statusStopped: Color
    let statusSuccessLowSat: Color
    let tabActive: Color
    let tabInactive: Color
    let inputBg: Color
    let cardBg: Color
    let divider: Color
    let glow: Color

    var bgDeep: Color { bgBase }
    var bgHover: Color { bgSurface.opacity(0.88) }
    var statusDone: Color { statusSuccess }
    var statusFailed: Color { statusError }
    var statusPending: Color { statusWarning }
    var statusIdle: Color { textTertiary }
}

private struct MWThemePair {
    let light: MWThemeTokens
    let dark: MWThemeTokens
}

// MARK: - MiWarp Colors

@MainActor
enum MWColors {
    static func tokens(for theme: MWAccentTheme, scheme: ColorScheme) -> MWThemeTokens {
        let pair: MWThemePair
        switch theme {
        case .defaultMiWarp: pair = defaultMiWarp
        case .carbonPink: pair = carbonPink
        case .deepSeaMilk: pair = deepSeaMilk
        case .auroraPomelo: pair = auroraPomelo
        case .pomegranateMist: pair = pomegranateMist
        case .auroraLime: pair = auroraLime
        }
        return scheme == .dark ? pair.dark : pair.light
    }

    // MARK: Compatibility aliases backed by semantic tokens

    static var current: MWThemeTokens { MWTheme.shared.tokens }
    static var bgDeepest: Color { current.bgDeepest }
    static var bgDeep: Color { current.bgDeep }
    static var bgBase: Color { current.bgBase }
    static var bgElevated: Color { current.bgElevated }
    static var bgSurface: Color { current.bgSurface }
    static var bgHover: Color { current.bgHover }
    static var glassBg: Color { current.glassBg }
    static var glassBorder: Color { current.glassBorder }
    static var inputBg: Color { current.inputBg }
    static var cardBg: Color { current.cardBg }
    static var divider: Color { current.divider }
    static var tabActive: Color { current.tabActive }
    static var tabInactive: Color { current.tabInactive }
    static var accentPrimary: Color { current.accentPrimary }
    static var accentCyan: Color { current.accentSecondary }
    static var accentBlue: Color { current.accentPrimary }
    static var accentOnAccent: Color { current.accentOnAccent }
    static var textPrimary: Color { current.textPrimary }
    static var textSecondary: Color { current.textSecondary }
    static var textTertiary: Color { current.textTertiary }
    static var statusSuccess: Color { current.statusSuccess }
    static var statusWarning: Color { current.statusWarning }
    static var statusError: Color { current.statusError }
    static var statusRunning: Color { current.statusRunning }
    static var statusDone: Color { current.statusDone }
    static var statusFailed: Color { current.statusFailed }
    static var statusPending: Color { current.statusPending }
    static var statusIdle: Color { current.statusIdle }
    static var statusApproval: Color { current.statusApproval }
    static var statusStopped: Color { current.statusStopped }
    static var statusSuccessLowSat: Color { current.statusSuccessLowSat }
    static var glowCyan: Color { current.glow }
    static var glowRunning: Color { current.statusRunning.opacity(0.24) }
    static var glowApproval: Color { current.statusApproval.opacity(0.22) }

    static func bgDeepest(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).bgDeepest }
    static func bgDeep(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).bgDeep }
    static func bgBase(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).bgBase }
    static func bgElevated(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).bgElevated }
    static func bgSurface(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).bgSurface }
    static func bgHover(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).bgHover }
    static func glassBg(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).glassBg }
    static func glassBorder(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).glassBorder }
    static func textPrimary(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).textPrimary }
    static func textSecondary(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).textSecondary }
    static func textTertiary(for scheme: ColorScheme) -> Color { tokens(for: MWTheme.shared.accentTheme, scheme: scheme).textTertiary }

    static func color(for status: RunStatus) -> Color {
        switch status {
        case .pending: return statusPending
        case .running: return statusRunning
        case .idle: return statusIdle
        case .waitingApproval: return statusWarning
        case .completed: return statusDone
        case .failed: return statusFailed
        case .stopped: return statusStopped
        }
    }

    // MARK: Theme Definitions

    // Default: pure black + white, Xiaomi orange accent
    private static let defaultMiWarp = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xFFFFFF),
            bgBase: Color(hex: 0xFAFAFA),
            bgElevated: Color(hex: 0xF5F5F5),
            bgSurface: Color(hex: 0xEEEEEE),
            glassBg: Color(hex: 0xFFFFFF, opacity: 0.90),
            glassBorder: Color(hex: 0x000000, opacity: 0.12),
            textPrimary: Color(hex: 0x000000),
            textSecondary: Color(hex: 0x3D3D3D),
            textTertiary: Color(hex: 0x8C8C8C),
            accentPrimary: Color(hex: 0xFF6700),
            accentSecondary: Color(hex: 0x00E5FF),
            accentOnAccent: Color(hex: 0xFFFFFF),
            statusRunning: Color(hex: 0xFF6700),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xFF6700),
            tabInactive: Color(hex: 0x8C8C8C),
            inputBg: Color(hex: 0xFFFFFF, opacity: 0.88),
            cardBg: Color(hex: 0xFFFFFF, opacity: 0.95),
            divider: Color(hex: 0x000000, opacity: 0.08),
            glow: Color(hex: 0xFF6700, opacity: 0.25)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x000000),
            bgBase: Color(hex: 0x0D0D0D),
            bgElevated: Color(hex: 0x1A1A1A),
            bgSurface: Color(hex: 0x262626),
            glassBg: Color(hex: 0x000000, opacity: 0.80),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.12),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xB3B3B3),
            textTertiary: Color(hex: 0x737373),
            accentPrimary: Color(hex: 0xFF6700),
            accentSecondary: Color(hex: 0x00E5FF),
            accentOnAccent: Color(hex: 0x000000),
            statusRunning: Color(hex: 0xFF6700),
            statusSuccess: Color(hex: 0x00E676),
            statusWarning: Color(hex: 0xFFAB40),
            statusError: Color(hex: 0xFF6E40),
            statusApproval: Color(hex: 0xFFAB40),
            statusStopped: Color(hex: 0x757575),
            statusSuccessLowSat: Color(hex: 0x00E676),
            tabActive: Color(hex: 0xFF6700),
            tabInactive: Color(hex: 0x737373),
            inputBg: Color(hex: 0x1A1A1A, opacity: 0.88),
            cardBg: Color(hex: 0x1A1A1A, opacity: 0.95),
            divider: Color(hex: 0xFFFFFF, opacity: 0.10),
            glow: Color(hex: 0xFF6700, opacity: 0.30)
        )
    )

    // carbonPink — bg: 炭黑 #1A1A1D, cards: 甜酷粉 #E6397C, font: white
    private static let carbonPink = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0x1A1A1D),
            bgBase: Color(hex: 0x232326),
            bgElevated: Color(hex: 0x2C2C2F),
            bgSurface: Color(hex: 0xE6397C),
            glassBg: Color(hex: 0xE6397C, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFC0D8),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.75),
            accentPrimary: Color(hex: 0xE6397C),
            accentSecondary: Color(hex: 0x1A1A1D),
            accentOnAccent: Color(hex: 0xFFFFFF),
            statusRunning: Color(hex: 0xE6397C),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xE6397C),
            tabInactive: Color(hex: 0xB0B0B8),
            inputBg: Color(hex: 0xE6397C, opacity: 0.85),
            cardBg: Color(hex: 0xE6397C, opacity: 0.92),
            divider: Color(hex: 0xFFFFFF, opacity: 0.12),
            glow: Color(hex: 0xE6397C, opacity: 0.35)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x1A1A1D),
            bgBase: Color(hex: 0x232326),
            bgElevated: Color(hex: 0x2C2C2F),
            bgSurface: Color(hex: 0xE6397C),
            glassBg: Color(hex: 0xE6397C, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFC0D8),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.75),
            accentPrimary: Color(hex: 0xE6397C),
            accentSecondary: Color(hex: 0x1A1A1D),
            accentOnAccent: Color(hex: 0xFFFFFF),
            statusRunning: Color(hex: 0xE6397C),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xE6397C),
            tabInactive: Color(hex: 0xB0B0B8),
            inputBg: Color(hex: 0xE6397C, opacity: 0.85),
            cardBg: Color(hex: 0xE6397C, opacity: 0.92),
            divider: Color(hex: 0xFFFFFF, opacity: 0.12),
            glow: Color(hex: 0xE6397C, opacity: 0.35)
        )
    )

    // deepSeaMilk — bg: 深海蓝 #122E8A, cards: 白色, font: 白色
    private static let deepSeaMilk = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0x122E8A),
            bgBase: Color(hex: 0x15389E),
            bgElevated: Color(hex: 0x1842B2),
            bgSurface: Color(hex: 0xFFFFFF),
            glassBg: Color(hex: 0xFFFFFF, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.20),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xFFFFFF),
            accentSecondary: Color(hex: 0x122E8A),
            accentOnAccent: Color(hex: 0x122E8A),
            statusRunning: Color(hex: 0xFFFFFF),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xFFFFFF),
            tabInactive: Color(hex: 0x90A0C0),
            inputBg: Color(hex: 0xFFFFFF, opacity: 0.85),
            cardBg: Color(hex: 0xFFFFFF, opacity: 0.92),
            divider: Color(hex: 0xFFFFFF, opacity: 0.20),
            glow: Color(hex: 0xFFFFFF, opacity: 0.35)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x122E8A),
            bgBase: Color(hex: 0x15389E),
            bgElevated: Color(hex: 0x1842B2),
            bgSurface: Color(hex: 0xFFFFFF),
            glassBg: Color(hex: 0xFFFFFF, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.20),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xFFFFFF),
            accentSecondary: Color(hex: 0x122E8A),
            accentOnAccent: Color(hex: 0x122E8A),
            statusRunning: Color(hex: 0xFFFFFF),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xFFFFFF),
            tabInactive: Color(hex: 0x90A0C0),
            inputBg: Color(hex: 0xFFFFFF, opacity: 0.85),
            cardBg: Color(hex: 0xFFFFFF, opacity: 0.92),
            divider: Color(hex: 0xFFFFFF, opacity: 0.20),
            glow: Color(hex: 0xFFFFFF, opacity: 0.35)
        )
    )

    // auroraPomelo — bg: 极光紫 #9F82FD, cards: 蜜柚黄 #FBEA03
    private static let auroraPomelo = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0x9F82FD),
            bgBase: Color(hex: 0xA890FD),
            bgElevated: Color(hex: 0xB29EFD),
            bgSurface: Color(hex: 0xFBEA03),
            glassBg: Color(hex: 0xFBEA03, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xFBEA03),
            accentSecondary: Color(hex: 0x9F82FD),
            accentOnAccent: Color(hex: 0x000000),
            statusRunning: Color(hex: 0xFFFFFF),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xFBEA03),
            tabInactive: Color(hex: 0xC0B0E0),
            inputBg: Color(hex: 0xFBEA03, opacity: 0.85),
            cardBg: Color(hex: 0xFBEA03, opacity: 0.92),
            divider: Color(hex: 0xFFFFFF, opacity: 0.15),
            glow: Color(hex: 0xFBEA03, opacity: 0.35)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x9F82FD),
            bgBase: Color(hex: 0xA890FD),
            bgElevated: Color(hex: 0xB29EFD),
            bgSurface: Color(hex: 0xFBEA03),
            glassBg: Color(hex: 0xFBEA03, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xFBEA03),
            accentSecondary: Color(hex: 0x9F82FD),
            accentOnAccent: Color(hex: 0x000000),
            statusRunning: Color(hex: 0xFFFFFF),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xFBEA03),
            tabInactive: Color(hex: 0xC0B0E0),
            inputBg: Color(hex: 0xFBEA03, opacity: 0.85),
            cardBg: Color(hex: 0xFBEA03, opacity: 0.92),
            divider: Color(hex: 0xFFFFFF, opacity: 0.15),
            glow: Color(hex: 0xFBEA03, opacity: 0.35)
        )
    )

    // pomegranateMist — bg: 石榴红 #E72D48, cards: 雾粉桃 #F1DDDF
    private static let pomegranateMist = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xE72D48),
            bgBase: Color(hex: 0xEB3B55),
            bgElevated: Color(hex: 0xEF4962),
            bgSurface: Color(hex: 0xF1DDDF),
            glassBg: Color(hex: 0xF1DDDF, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xF1DDDF),
            accentSecondary: Color(hex: 0xE72D48),
            accentOnAccent: Color(hex: 0xE72D48),
            statusRunning: Color(hex: 0xE72D48),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xE72D48),
            tabInactive: Color(hex: 0xC0A0A8),
            inputBg: Color(hex: 0xF1DDDF, opacity: 0.85),
            cardBg: Color(hex: 0xF1DDDF, opacity: 0.92),
            divider: Color(hex: 0xE72D48, opacity: 0.15),
            glow: Color(hex: 0xE72D48, opacity: 0.35)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0xE72D48),
            bgBase: Color(hex: 0xEB3B55),
            bgElevated: Color(hex: 0xEF4962),
            bgSurface: Color(hex: 0xF1DDDF),
            glassBg: Color(hex: 0xF1DDDF, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xF1DDDF),
            accentSecondary: Color(hex: 0xE72D48),
            accentOnAccent: Color(hex: 0xE72D48),
            statusRunning: Color(hex: 0xE72D48),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xE72D48),
            tabInactive: Color(hex: 0xC0A0A8),
            inputBg: Color(hex: 0xF1DDDF, opacity: 0.85),
            cardBg: Color(hex: 0xF1DDDF, opacity: 0.92),
            divider: Color(hex: 0xE72D48, opacity: 0.15),
            glow: Color(hex: 0xE72D48, opacity: 0.35)
        )
    )

    // auroraLime — bg: #01847F teal, cards: #F9D2E4 light pink, font: white
    private static let auroraLime = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0x01847F),
            bgBase: Color(hex: 0x01968C),
            bgElevated: Color(hex: 0x01A899),
            bgSurface: Color(hex: 0xF9D2E4),
            glassBg: Color(hex: 0xF9D2E4, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xF9D2E4),
            accentSecondary: Color(hex: 0x01847F),
            accentOnAccent: Color(hex: 0x01847F),
            statusRunning: Color(hex: 0x01847F),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xF9D2E4),
            tabInactive: Color(hex: 0x90C0BC),
            inputBg: Color(hex: 0xF9D2E4, opacity: 0.85),
            cardBg: Color(hex: 0xF9D2E4, opacity: 0.92),
            divider: Color(hex: 0x01847F, opacity: 0.15),
            glow: Color(hex: 0xF9D2E4, opacity: 0.35)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x01847F),
            bgBase: Color(hex: 0x01968C),
            bgElevated: Color(hex: 0x01A899),
            bgSurface: Color(hex: 0xF9D2E4),
            glassBg: Color(hex: 0xF9D2E4, opacity: 0.88),
            glassBorder: Color(hex: 0xFFFFFF, opacity: 0.15),
            textPrimary: Color(hex: 0xFFFFFF),
            textSecondary: Color(hex: 0xFFFFFF).opacity(0.75),
            textTertiary: Color(hex: 0xFFFFFF).opacity(0.50),
            accentPrimary: Color(hex: 0xF9D2E4),
            accentSecondary: Color(hex: 0x01847F),
            accentOnAccent: Color(hex: 0x01847F),
            statusRunning: Color(hex: 0x01847F),
            statusSuccess: Color(hex: 0x00C853),
            statusWarning: Color(hex: 0xFF9100),
            statusError: Color(hex: 0xFF3D00),
            statusApproval: Color(hex: 0xFF9100),
            statusStopped: Color(hex: 0x9E9E9E),
            statusSuccessLowSat: Color(hex: 0x00C853),
            tabActive: Color(hex: 0xF9D2E4),
            tabInactive: Color(hex: 0x90C0BC),
            inputBg: Color(hex: 0xF9D2E4, opacity: 0.85),
            cardBg: Color(hex: 0xF9D2E4, opacity: 0.92),
            divider: Color(hex: 0x01847F, opacity: 0.15),
            glow: Color(hex: 0xF9D2E4, opacity: 0.35)
        )
    )
}
