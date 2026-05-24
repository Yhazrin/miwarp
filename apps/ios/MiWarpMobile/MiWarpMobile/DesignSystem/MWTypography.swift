import SwiftUI

// MARK: - Typography

enum MWTypography {
    // Large Titles
    static func largeTitle() -> Font {
        .system(size: 28, weight: .bold, design: .default)
    }

    // Titles
    static func title() -> Font {
        .system(size: 22, weight: .semibold, design: .default)
    }

    static func title2() -> Font {
        .system(size: 18, weight: .semibold, design: .default)
    }

    static func title3() -> Font {
        .system(size: 16, weight: .semibold, design: .default)
    }

    // Body
    static func body() -> Font {
        .system(size: 15, weight: .regular, design: .default)
    }

    static func bodyMedium() -> Font {
        .system(size: 15, weight: .medium, design: .default)
    }

    // Callout
    static func callout() -> Font {
        .system(size: 14, weight: .regular, design: .default)
    }

    // Subheadline
    static func subheadline() -> Font {
        .system(size: 13, weight: .regular, design: .default)
    }

    static func subheadlineMedium() -> Font {
        .system(size: 13, weight: .medium, design: .default)
    }

    // Footnote
    static func footnote() -> Font {
        .system(size: 12, weight: .regular, design: .default)
    }

    // Caption
    static func caption() -> Font {
        .system(size: 11, weight: .regular, design: .default)
    }

    static func caption2() -> Font {
        .system(size: 10, weight: .regular, design: .default)
    }

    // Monospaced (code/metadata)
    static func monoBody() -> Font {
        .system(size: 14, weight: .regular, design: .monospaced)
    }

    static func monoCaption() -> Font {
        .system(size: 12, weight: .regular, design: .monospaced)
    }

    static func monoSmall() -> Font {
        .system(size: 11, weight: .regular, design: .monospaced)
    }
}
