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

    @Published var colorScheme: ColorScheme = .dark

    // Background tokens
    var bgDeepest: Color { colorScheme == .dark ? MWColors.bgDeepest : MWColors.lightBgDeepest }
    var bgDeep: Color { colorScheme == .dark ? MWColors.bgDeep : MWColors.lightBgDeepest }
    var bgBase: Color { colorScheme == .dark ? MWColors.bgBase : MWColors.lightBgBase }
    var bgElevated: Color { colorScheme == .dark ? MWColors.bgElevated : Color(white: 0.96) }
    var bgSurface: Color { colorScheme == .dark ? MWColors.bgSurface : Color(white: 0.94) }
    var bgHover: Color { colorScheme == .dark ? MWColors.bgHover : Color(white: 0.92) }

    // Glass
    var glassBg: Color { MWColors.glassBg }
    var glassBorder: Color { MWColors.glassBorder }

    // Accents
    var accentPrimary: Color { MWColors.accentPrimary }
    var accentCyan: Color { MWColors.accentCyan }
    var accentBlue: Color { MWColors.accentBlue }

    // Text
    var textPrimary: Color { colorScheme == .dark ? MWColors.textPrimary : MWColors.lightTextPrimary }
    var textSecondary: Color { colorScheme == .dark ? MWColors.textSecondary : MWColors.lightTextSecondary }
    var textTertiary: Color { MWColors.textTertiary }

    // Status
    var statusSuccess: Color { MWColors.statusSuccess }
    var statusWarning: Color { MWColors.statusWarning }
    var statusError: Color { MWColors.statusError }
    var statusRunning: Color { MWColors.statusRunning }
    var statusDone: Color { MWColors.statusDone }
    var statusFailed: Color { MWColors.statusFailed }
    var statusPending: Color { MWColors.statusPending }
    var statusIdle: Color { MWColors.statusIdle }

    func statusColor(for status: RunStatus) -> Color {
        MWColors.color(for: status)
    }
}
