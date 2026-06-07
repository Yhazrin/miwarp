import SwiftUI

// MARK: - Adaptive Layout

/// v1.0.6 / 2.2 (C6) + 2.3 (D3): three-tier size class.
/// `compact`   < 768pt   (iPhone, iPad mini portrait)
/// `medium`    768-1024 (iPad mini landscape, 11" portrait)
/// `expanded`  >= 1024  (iPad Pro, Stage Manager, 13" landscape)
struct MWAdaptiveLayout {
    enum SizeClass { case compact, medium, expanded }

    let sizeClass: SizeClass
    let shouldUseSplitView: Bool
    let contentMaxWidth: CGFloat?
    let listColumnWidth: CGFloat
    let detailMaxWidth: CGFloat?
    let chatContentMaxWidth: CGFloat?
    let chatUserBubbleMaxWidth: CGFloat?
    let chatAssistantBubbleMaxWidth: CGFloat?

    /// Legacy boolean helper — keeps existing call sites compiling.
    var isCompact: Bool { sizeClass == .compact }

    static func `default`(isCompact: Bool) -> MWAdaptiveLayout {
        default(sizeClass: isCompact ? .compact : .expanded)
    }

    static func `default`(sizeClass: SizeClass) -> MWAdaptiveLayout {
        switch sizeClass {
        case .compact:
            return MWAdaptiveLayout(
                sizeClass: .compact,
                shouldUseSplitView: false,
                contentMaxWidth: nil,
                listColumnWidth: 320,
                detailMaxWidth: nil,
                chatContentMaxWidth: nil,
                chatUserBubbleMaxWidth: nil,
                chatAssistantBubbleMaxWidth: nil
            )
        case .medium:
            return MWAdaptiveLayout(
                sizeClass: .medium,
                shouldUseSplitView: true,
                contentMaxWidth: 720,
                listColumnWidth: 340,
                detailMaxWidth: 820,
                chatContentMaxWidth: 720,
                chatUserBubbleMaxWidth: 520,
                chatAssistantBubbleMaxWidth: 600
            )
        case .expanded:
            return MWAdaptiveLayout(
                sizeClass: .expanded,
                shouldUseSplitView: true,
                contentMaxWidth: 880,
                listColumnWidth: 380,
                detailMaxWidth: 1100, // v1.0.6: 11"/13" iPad Pro
                chatContentMaxWidth: 880,
                chatUserBubbleMaxWidth: 600,
                chatAssistantBubbleMaxWidth: 720
            )
        }
    }
}

// MARK: - Adaptive Reader

struct MWAdaptiveReader<Content: View>: View {
    @ViewBuilder let content: (MWAdaptiveLayout) -> Content

    var body: some View {
        // v1.0.6 / 2.2: prefer SwiftUI's size class over GeometryReader so
        // Stage Manager / Split View don't ping-pong between compact and
        // expanded. GeometryReader is only used for pixel-precise values
        // (e.g. a custom waveform width).
        GeometryReader { geometry in
            let cls: MWAdaptiveLayout.SizeClass =
                geometry.size.width < 768 ? .compact
                : geometry.size.width < 1024 ? .medium
                : .expanded
            let layout = MWAdaptiveLayout.default(sizeClass: cls)
            content(layout)
        }
    }
}
