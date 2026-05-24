import SwiftUI

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
}

// MARK: - Appearance

enum MWAppearanceMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var systemImage: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max.fill"
        case .dark: return "moon.fill"
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
        case .defaultMiWarp: return Color(hex: 0x0ea5e9)
        case .carbonPink: return Color(hex: 0x1A1A1D)
        case .deepSeaMilk: return Color(hex: 0x122E8A)
        case .auroraPomelo: return Color(hex: 0x9F82FD)
        case .pomegranateMist: return Color(hex: 0xE72D48)
        case .auroraLime: return Color(hex: 0x9F82FD)
        }
    }

    var secondarySwatch: Color {
        switch self {
        case .defaultMiWarp: return Color(hex: 0x22d3ee)
        case .carbonPink: return Color(hex: 0xE6397C)
        case .deepSeaMilk: return Color(hex: 0xF5EFEA)
        case .auroraPomelo: return Color(hex: 0xFBEA03)
        case .pomegranateMist: return Color(hex: 0xF1DDDF)
        case .auroraLime: return Color(hex: 0xBCFE1A)
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
        case .stopped: return statusError
        }
    }

    // MARK: Theme Definitions

    private static let defaultMiWarp = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xF6F8FC),
            bgBase: Color(hex: 0xFFFFFF),
            bgElevated: Color(hex: 0xEEF3F8),
            bgSurface: Color(hex: 0xE8EEF5),
            glassBg: Color(hex: 0xF4F8FC, opacity: 0.86),
            glassBorder: Color(hex: 0x7893AD, opacity: 0.26),
            textPrimary: Color(hex: 0x142033),
            textSecondary: Color(hex: 0x4F6175),
            textTertiary: Color(hex: 0x78879A),
            accentPrimary: Color(hex: 0x0369A1),
            accentSecondary: Color(hex: 0x0891B2),
            accentOnAccent: Color(hex: 0xF7FBFF),
            statusRunning: Color(hex: 0x2563EB),
            statusSuccess: Color(hex: 0x059669),
            statusWarning: Color(hex: 0xB7791F),
            statusError: Color(hex: 0xDC2626),
            statusApproval: Color(hex: 0xB7791F),
            tabActive: Color(hex: 0x0891B2),
            tabInactive: Color(hex: 0x78879A),
            inputBg: Color(hex: 0xF4F8FC, opacity: 0.88),
            cardBg: Color(hex: 0xF8FBFE, opacity: 0.86),
            divider: Color(hex: 0x7A8EA4, opacity: 0.20),
            glow: Color(hex: 0x22D3EE, opacity: 0.20)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hue: 220.0 / 360.0, saturation: 0.18, lightness: 0.06),
            bgBase: Color(hue: 220.0 / 360.0, saturation: 0.14, lightness: 0.12),
            bgElevated: Color(hue: 220.0 / 360.0, saturation: 0.12, lightness: 0.15),
            bgSurface: Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.18),
            glassBg: Color(hue: 220.0 / 360.0, saturation: 0.18, lightness: 0.11, opacity: 0.72),
            glassBorder: Color(hue: 220.0 / 360.0, saturation: 0.30, lightness: 0.50, opacity: 0.12),
            textPrimary: Color(hue: 0, saturation: 0, lightness: 0.94),
            textSecondary: Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.62),
            textTertiary: Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.42),
            accentPrimary: Color(hue: 210.0 / 360.0, saturation: 1.0, lightness: 0.60),
            accentSecondary: Color(hue: 185.0 / 360.0, saturation: 0.85, lightness: 0.55),
            accentOnAccent: Color(hex: 0xF7FBFF),
            statusRunning: Color(hue: 217.0 / 360.0, saturation: 0.91, lightness: 0.60),
            statusSuccess: Color(hue: 152.0 / 360.0, saturation: 0.55, lightness: 0.55),
            statusWarning: Color(hue: 38.0 / 360.0, saturation: 0.80, lightness: 0.55),
            statusError: Color(hue: 0, saturation: 0.72, lightness: 0.60),
            statusApproval: Color(hue: 38.0 / 360.0, saturation: 0.80, lightness: 0.55),
            tabActive: Color(hex: 0x22D3EE),
            tabInactive: Color(hue: 220.0 / 360.0, saturation: 0.10, lightness: 0.42),
            inputBg: Color(hue: 220.0 / 360.0, saturation: 0.18, lightness: 0.11, opacity: 0.82),
            cardBg: Color(hue: 220.0 / 360.0, saturation: 0.18, lightness: 0.11, opacity: 0.78),
            divider: Color(hex: 0xBFE9FF, opacity: 0.14),
            glow: Color(hex: 0x22D3EE, opacity: 0.20)
        )
    )

    private static let carbonPink = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xFAF4F7),
            bgBase: Color(hex: 0xFFF8FA),
            bgElevated: Color(hex: 0xF7EAF0),
            bgSurface: Color(hex: 0xF0DDE6),
            glassBg: Color(hex: 0xFFF8FA, opacity: 0.84),
            glassBorder: Color(hex: 0xE6397C, opacity: 0.22),
            textPrimary: Color(hex: 0x1A1A1D),
            textSecondary: Color(hex: 0x5E4350),
            textTertiary: Color(hex: 0x8A6E7A),
            accentPrimary: Color(hex: 0xB9205A),
            accentSecondary: Color(hex: 0xE6397C),
            accentOnAccent: Color(hex: 0xFFF7FB),
            statusRunning: Color(hex: 0xB9205A),
            statusSuccess: Color(hex: 0x168567),
            statusWarning: Color(hex: 0xA06512),
            statusError: Color(hex: 0xD32648),
            statusApproval: Color(hex: 0xE6397C),
            tabActive: Color(hex: 0xB9205A),
            tabInactive: Color(hex: 0x8A6E7A),
            inputBg: Color(hex: 0xFFF8FA, opacity: 0.88),
            cardBg: Color(hex: 0xFFF8FA, opacity: 0.84),
            divider: Color(hex: 0xD8AFC0, opacity: 0.36),
            glow: Color(hex: 0xE6397C, opacity: 0.20)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x0F0F11),
            bgBase: Color(hex: 0x1A1A1D),
            bgElevated: Color(hex: 0x242126),
            bgSurface: Color(hex: 0x302830),
            glassBg: Color(hex: 0x1A1A1D, opacity: 0.74),
            glassBorder: Color(hex: 0xE6397C, opacity: 0.18),
            textPrimary: Color(hex: 0xF6EEF2),
            textSecondary: Color(hex: 0xC9AAB8),
            textTertiary: Color(hex: 0x8F7480),
            accentPrimary: Color(hex: 0xE6397C),
            accentSecondary: Color(hex: 0xFF7AAD),
            accentOnAccent: Color(hex: 0x1A1A1D),
            statusRunning: Color(hex: 0xE6397C),
            statusSuccess: Color(hex: 0x41D6A2),
            statusWarning: Color(hex: 0xFFB85C),
            statusError: Color(hex: 0xFF5A72),
            statusApproval: Color(hex: 0xFF7AAD),
            tabActive: Color(hex: 0xE6397C),
            tabInactive: Color(hex: 0x8F7480),
            inputBg: Color(hex: 0x17171A, opacity: 0.84),
            cardBg: Color(hex: 0x1D1B20, opacity: 0.80),
            divider: Color(hex: 0xE6397C, opacity: 0.16),
            glow: Color(hex: 0xE6397C, opacity: 0.24)
        )
    )

    private static let deepSeaMilk = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xF5EFEA),
            bgBase: Color(hex: 0xFBF7F3),
            bgElevated: Color(hex: 0xEEE5DF),
            bgSurface: Color(hex: 0xE8DDD4),
            glassBg: Color(hex: 0xFBF7F3, opacity: 0.84),
            glassBorder: Color(hex: 0x122E8A, opacity: 0.18),
            textPrimary: Color(hex: 0x122E8A),
            textSecondary: Color(hex: 0x43537D),
            textTertiary: Color(hex: 0x7A7F90),
            accentPrimary: Color(hex: 0x122E8A),
            accentSecondary: Color(hex: 0x6A7EDB),
            accentOnAccent: Color(hex: 0xF5EFEA),
            statusRunning: Color(hex: 0x2746AE),
            statusSuccess: Color(hex: 0x118568),
            statusWarning: Color(hex: 0x9B681A),
            statusError: Color(hex: 0xC9344D),
            statusApproval: Color(hex: 0x6A7EDB),
            tabActive: Color(hex: 0x122E8A),
            tabInactive: Color(hex: 0x7A7F90),
            inputBg: Color(hex: 0xFFFBF7, opacity: 0.88),
            cardBg: Color(hex: 0xFFFBF7, opacity: 0.84),
            divider: Color(hex: 0x122E8A, opacity: 0.16),
            glow: Color(hex: 0x122E8A, opacity: 0.16)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x071238),
            bgBase: Color(hex: 0x122E8A),
            bgElevated: Color(hex: 0x183894),
            bgSurface: Color(hex: 0x213F9C),
            glassBg: Color(hex: 0x071238, opacity: 0.62),
            glassBorder: Color(hex: 0xF5EFEA, opacity: 0.18),
            textPrimary: Color(hex: 0xF8F2ED),
            textSecondary: Color(hex: 0xC9D2FF),
            textTertiary: Color(hex: 0x8EA0E0),
            accentPrimary: Color(hex: 0xF5EFEA),
            accentSecondary: Color(hex: 0x9FB2FF),
            accentOnAccent: Color(hex: 0x122E8A),
            statusRunning: Color(hex: 0x9FB2FF),
            statusSuccess: Color(hex: 0x61D7B1),
            statusWarning: Color(hex: 0xF8D18A),
            statusError: Color(hex: 0xFF7488),
            statusApproval: Color(hex: 0xF5EFEA),
            tabActive: Color(hex: 0xF5EFEA),
            tabInactive: Color(hex: 0x8EA0E0),
            inputBg: Color(hex: 0x0B1E5B, opacity: 0.78),
            cardBg: Color(hex: 0x0B1E5B, opacity: 0.70),
            divider: Color(hex: 0xF5EFEA, opacity: 0.14),
            glow: Color(hex: 0xF5EFEA, opacity: 0.14)
        )
    )

    private static let auroraPomelo = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xFAF8EA),
            bgBase: Color(hex: 0xFFFDEB),
            bgElevated: Color(hex: 0xF0EBFF),
            bgSurface: Color(hex: 0xE5DCF9),
            glassBg: Color(hex: 0xFFFDEB, opacity: 0.84),
            glassBorder: Color(hex: 0x9F82FD, opacity: 0.22),
            textPrimary: Color(hex: 0x2C1D58),
            textSecondary: Color(hex: 0x5E5380),
            textTertiary: Color(hex: 0x8A82A2),
            accentPrimary: Color(hex: 0x6E50D8),
            accentSecondary: Color(hex: 0xB6A000),
            accentOnAccent: Color(hex: 0xFFFDEB),
            statusRunning: Color(hex: 0x6E50D8),
            statusSuccess: Color(hex: 0x0F8564),
            statusWarning: Color(hex: 0x8C7600),
            statusError: Color(hex: 0xD1324D),
            statusApproval: Color(hex: 0x9F82FD),
            tabActive: Color(hex: 0x6E50D8),
            tabInactive: Color(hex: 0x8A82A2),
            inputBg: Color(hex: 0xFFFDEB, opacity: 0.88),
            cardBg: Color(hex: 0xFFFBF0, opacity: 0.84),
            divider: Color(hex: 0x9F82FD, opacity: 0.18),
            glow: Color(hex: 0x9F82FD, opacity: 0.18)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x120D25),
            bgBase: Color(hex: 0x211743),
            bgElevated: Color(hex: 0x2A1C56),
            bgSurface: Color(hex: 0x352267),
            glassBg: Color(hex: 0x211743, opacity: 0.74),
            glassBorder: Color(hex: 0xFBEA03, opacity: 0.16),
            textPrimary: Color(hex: 0xF3EFFD),
            textSecondary: Color(hex: 0xCFC4F9),
            textTertiary: Color(hex: 0x9B8FCA),
            accentPrimary: Color(hex: 0xFBEA03),
            accentSecondary: Color(hex: 0x9F82FD),
            accentOnAccent: Color(hex: 0x211743),
            statusRunning: Color(hex: 0x9F82FD),
            statusSuccess: Color(hex: 0xB9F25A),
            statusWarning: Color(hex: 0xFBEA03),
            statusError: Color(hex: 0xFF667B),
            statusApproval: Color(hex: 0xFBEA03),
            tabActive: Color(hex: 0xFBEA03),
            tabInactive: Color(hex: 0x9B8FCA),
            inputBg: Color(hex: 0x1B1236, opacity: 0.82),
            cardBg: Color(hex: 0x211743, opacity: 0.78),
            divider: Color(hex: 0xFBEA03, opacity: 0.14),
            glow: Color(hex: 0xFBEA03, opacity: 0.18)
        )
    )

    private static let pomegranateMist = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xF8EEF0),
            bgBase: Color(hex: 0xFFF7F8),
            bgElevated: Color(hex: 0xF1DDDF),
            bgSurface: Color(hex: 0xE8CDD0),
            glassBg: Color(hex: 0xFFF7F8, opacity: 0.84),
            glassBorder: Color(hex: 0xE72D48, opacity: 0.20),
            textPrimary: Color(hex: 0x42111B),
            textSecondary: Color(hex: 0x70414A),
            textTertiary: Color(hex: 0x9B7780),
            accentPrimary: Color(hex: 0xC51F38),
            accentSecondary: Color(hex: 0xE72D48),
            accentOnAccent: Color(hex: 0xFFF7F8),
            statusRunning: Color(hex: 0xC51F38),
            statusSuccess: Color(hex: 0x128365),
            statusWarning: Color(hex: 0xA66718),
            statusError: Color(hex: 0xE72D48),
            statusApproval: Color(hex: 0xE72D48),
            tabActive: Color(hex: 0xC51F38),
            tabInactive: Color(hex: 0x9B7780),
            inputBg: Color(hex: 0xFFF7F8, opacity: 0.88),
            cardBg: Color(hex: 0xFFF7F8, opacity: 0.84),
            divider: Color(hex: 0xE72D48, opacity: 0.16),
            glow: Color(hex: 0xE72D48, opacity: 0.18)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x24070D),
            bgBase: Color(hex: 0x3A0D16),
            bgElevated: Color(hex: 0x4A121E),
            bgSurface: Color(hex: 0x5A1827),
            glassBg: Color(hex: 0x3A0D16, opacity: 0.74),
            glassBorder: Color(hex: 0xF1DDDF, opacity: 0.18),
            textPrimary: Color(hex: 0xFAEEF0),
            textSecondary: Color(hex: 0xE9BFC5),
            textTertiary: Color(hex: 0xB47D86),
            accentPrimary: Color(hex: 0xF1DDDF),
            accentSecondary: Color(hex: 0xE72D48),
            accentOnAccent: Color(hex: 0x3A0D16),
            statusRunning: Color(hex: 0xF1DDDF),
            statusSuccess: Color(hex: 0x5AD5A8),
            statusWarning: Color(hex: 0xFFC46D),
            statusError: Color(hex: 0xFF6478),
            statusApproval: Color(hex: 0xF1DDDF),
            tabActive: Color(hex: 0xF1DDDF),
            tabInactive: Color(hex: 0xB47D86),
            inputBg: Color(hex: 0x2A080F, opacity: 0.82),
            cardBg: Color(hex: 0x3A0D16, opacity: 0.78),
            divider: Color(hex: 0xF1DDDF, opacity: 0.14),
            glow: Color(hex: 0xE72D48, opacity: 0.22)
        )
    )

    private static let auroraLime = MWThemePair(
        light: MWThemeTokens(
            bgDeepest: Color(hex: 0xF5FAEA),
            bgBase: Color(hex: 0xFBFFF2),
            bgElevated: Color(hex: 0xEFE8FF),
            bgSurface: Color(hex: 0xE2D8F7),
            glassBg: Color(hex: 0xFBFFF2, opacity: 0.84),
            glassBorder: Color(hex: 0x9F82FD, opacity: 0.22),
            textPrimary: Color(hex: 0x27194F),
            textSecondary: Color(hex: 0x5A5174),
            textTertiary: Color(hex: 0x878098),
            accentPrimary: Color(hex: 0x6D4FDA),
            accentSecondary: Color(hex: 0x76A600),
            accentOnAccent: Color(hex: 0xFBFFF2),
            statusRunning: Color(hex: 0x6D4FDA),
            statusSuccess: Color(hex: 0x4F8F00),
            statusWarning: Color(hex: 0x8A6A00),
            statusError: Color(hex: 0xD3354F),
            statusApproval: Color(hex: 0x9F82FD),
            tabActive: Color(hex: 0x6D4FDA),
            tabInactive: Color(hex: 0x878098),
            inputBg: Color(hex: 0xFBFFF2, opacity: 0.88),
            cardBg: Color(hex: 0xFDFFF6, opacity: 0.84),
            divider: Color(hex: 0x9F82FD, opacity: 0.18),
            glow: Color(hex: 0x9F82FD, opacity: 0.18)
        ),
        dark: MWThemeTokens(
            bgDeepest: Color(hex: 0x120D25),
            bgBase: Color(hex: 0x1D143B),
            bgElevated: Color(hex: 0x281B53),
            bgSurface: Color(hex: 0x332268),
            glassBg: Color(hex: 0x1D143B, opacity: 0.74),
            glassBorder: Color(hex: 0xBCFE1A, opacity: 0.16),
            textPrimary: Color(hex: 0xF3EFFD),
            textSecondary: Color(hex: 0xCDC6F0),
            textTertiary: Color(hex: 0x948BBE),
            accentPrimary: Color(hex: 0xBCFE1A),
            accentSecondary: Color(hex: 0x9F82FD),
            accentOnAccent: Color(hex: 0x17220B),
            statusRunning: Color(hex: 0x9F82FD),
            statusSuccess: Color(hex: 0xBCFE1A),
            statusWarning: Color(hex: 0xF6D86B),
            statusError: Color(hex: 0xFF6378),
            statusApproval: Color(hex: 0xBCFE1A),
            tabActive: Color(hex: 0xBCFE1A),
            tabInactive: Color(hex: 0x948BBE),
            inputBg: Color(hex: 0x181031, opacity: 0.82),
            cardBg: Color(hex: 0x1D143B, opacity: 0.78),
            divider: Color(hex: 0xBCFE1A, opacity: 0.14),
            glow: Color(hex: 0xBCFE1A, opacity: 0.18)
        )
    )
}
