import SwiftUI

// MARK: - Adaptive Layout

struct MWAdaptiveLayout {
    let shouldUseSplitView: Bool
    let contentMaxWidth: CGFloat?
    let listColumnWidth: CGFloat
    let detailMaxWidth: CGFloat?
    let chatContentMaxWidth: CGFloat?
    let chatUserBubbleMaxWidth: CGFloat?
    let chatAssistantBubbleMaxWidth: CGFloat?

    static func `default`(isCompact: Bool) -> MWAdaptiveLayout {
        if isCompact {
            return MWAdaptiveLayout(
                shouldUseSplitView: false,
                contentMaxWidth: nil,
                listColumnWidth: 320,
                detailMaxWidth: nil,
                chatContentMaxWidth: nil,
                chatUserBubbleMaxWidth: nil,
                chatAssistantBubbleMaxWidth: nil
            )
        } else {
            return MWAdaptiveLayout(
                shouldUseSplitView: true,
                contentMaxWidth: 720,
                listColumnWidth: 360,
                detailMaxWidth: 900,
                chatContentMaxWidth: 800,
                chatUserBubbleMaxWidth: 560,
                chatAssistantBubbleMaxWidth: 640
            )
        }
    }
}

// MARK: - Adaptive Reader

struct MWAdaptiveReader<Content: View>: View {
    @ViewBuilder let content: (MWAdaptiveLayout) -> Content

    var body: some View {
        GeometryReader { geometry in
            let isCompact = geometry.size.width < 768
            let layout = MWAdaptiveLayout.default(isCompact: isCompact)
            content(layout)
        }
    }
}
