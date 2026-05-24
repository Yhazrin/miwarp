import SwiftUI

// MARK: - Spacing

enum MWSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
    static let xxxl: CGFloat = 32
    static let huge: CGFloat = 40
    static let massive: CGFloat = 48
}

// MARK: - Radius

enum MWRadius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 10
    static let xl: CGFloat = 14
    static let full: CGFloat = 999
}

// MARK: - Motion

enum MWMotion {
    static let fast: Double = 0.12
    static let normal: Double = 0.18
    static let slow: Double = 0.28

    static let standardEasing = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.2, y: 0),
                                                  endControlPoint: UnitPoint(x: 0, y: 1))
    static let emphasizedEasing = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.16, y: 1),
                                                    endControlPoint: UnitPoint(x: 0.3, y: 1))
}

// MARK: - Theme

@MainActor
final class MWTheme: ObservableObject {
    static let shared = MWTheme()

    private enum StorageKey {
        static let appearance = "miwarp.appearanceMode"
        static let accentTheme = "miwarp.accentTheme"
        static let textureStrength = "miwarp.textureStrength"
    }

    @Published var appearanceMode: MWAppearanceMode {
        didSet { UserDefaults.standard.set(appearanceMode.rawValue, forKey: StorageKey.appearance) }
    }

    @Published var accentTheme: MWAccentTheme {
        didSet { UserDefaults.standard.set(accentTheme.rawValue, forKey: StorageKey.accentTheme) }
    }

    @Published var textureStrength: MWTextureStrength {
        didSet { UserDefaults.standard.set(textureStrength.rawValue, forKey: StorageKey.textureStrength) }
    }

    @Published private(set) var systemColorScheme: ColorScheme = .dark

    private init() {
        let defaults = UserDefaults.standard
        appearanceMode = MWAppearanceMode(rawValue: defaults.string(forKey: StorageKey.appearance) ?? "") ?? .system
        accentTheme = MWAccentTheme(rawValue: defaults.string(forKey: StorageKey.accentTheme) ?? "") ?? .defaultMiWarp
        textureStrength = MWTextureStrength(rawValue: defaults.string(forKey: StorageKey.textureStrength) ?? "") ?? .subtle
    }

    var colorScheme: ColorScheme {
        get { effectiveColorScheme }
        set { appearanceMode = newValue == .dark ? .dark : .light }
    }

    var preferredColorScheme: ColorScheme? {
        switch appearanceMode {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var effectiveColorScheme: ColorScheme {
        switch appearanceMode {
        case .system: return systemColorScheme
        case .light: return .light
        case .dark: return .dark
        }
    }

    var tokens: MWThemeTokens {
        MWColors.tokens(for: accentTheme, scheme: effectiveColorScheme)
    }

    func updateSystemColorScheme(_ scheme: ColorScheme) {
        guard systemColorScheme != scheme else { return }
        systemColorScheme = scheme
    }

    // Background tokens
    var bgDeepest: Color { tokens.bgDeepest }
    var bgDeep: Color { tokens.bgDeep }
    var bgBase: Color { tokens.bgBase }
    var bgElevated: Color { tokens.bgElevated }
    var bgSurface: Color { tokens.bgSurface }
    var bgHover: Color { tokens.bgHover }

    // Glass
    var glassBg: Color { tokens.glassBg }
    var glassBorder: Color { tokens.glassBorder }

    // Accents
    var accentPrimary: Color { tokens.accentPrimary }
    var accentSecondary: Color { tokens.accentSecondary }
    var accentCyan: Color { tokens.accentSecondary }
    var accentBlue: Color { tokens.accentPrimary }
    var accentOnAccent: Color { tokens.accentOnAccent }

    // Text
    var textPrimary: Color { tokens.textPrimary }
    var textSecondary: Color { tokens.textSecondary }
    var textTertiary: Color { tokens.textTertiary }

    // Status
    var statusSuccess: Color { tokens.statusSuccess }
    var statusWarning: Color { tokens.statusWarning }
    var statusError: Color { tokens.statusError }
    var statusRunning: Color { tokens.statusRunning }
    var statusDone: Color { tokens.statusDone }
    var statusFailed: Color { tokens.statusFailed }
    var statusPending: Color { tokens.statusPending }
    var statusIdle: Color { tokens.statusIdle }
    var statusApproval: Color { tokens.statusApproval }

    // Component tokens
    var tabActive: Color { tokens.tabActive }
    var tabInactive: Color { tokens.tabInactive }
    var inputBg: Color { tokens.inputBg }
    var cardBg: Color { tokens.cardBg }
    var divider: Color { tokens.divider }

    // Glow
    var glow: Color { tokens.glow }
    var glowCyan: Color { tokens.glow }
    var glowRunning: Color { tokens.statusRunning.opacity(0.24) }
    var glowApproval: Color { tokens.statusApproval.opacity(0.22) }

    var textureOpacity: Double {
        textureStrength.opacity(for: effectiveColorScheme)
    }

    func statusColor(for status: RunStatus) -> Color {
        MWColors.color(for: status)
    }
}
