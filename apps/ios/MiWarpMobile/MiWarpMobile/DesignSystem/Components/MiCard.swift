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
                RoundedRectangle(cornerRadius: MWRadius.card)
                    .fill(theme.cardBg)
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.card)
                            .strokeBorder(theme.divider, lineWidth: 0.5)
                    )
            )
    }
}

#Preview {
    MiCard {
        VStack(alignment: .leading, spacing: 8) {
            Text("Card Title")
                .font(.headline)
            Text("Card content goes here")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }
    .environmentObject(MWTheme())
    .padding()
}
