import SwiftUI

struct MiCard<Content: View>: View {
    let content: Content

    @EnvironmentObject private var theme: MWTheme

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(theme.cardBg)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(theme.divider, lineWidth: 0.5)
                    )
            )
    }
}
