import SwiftUI

struct MiCard<Content: View>: View {
    let content: Content

    @EnvironmentObject private var theme: MWTheme

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(MWSpacing.lg)
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
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            Text("Card Title")
                .font(MWTypography.title2())
            Text("Card content goes here")
                .font(MWTypography.subheadline())
                .foregroundColor(.secondary)
        }
    }
    .environmentObject(MWTheme())
    .padding()
}
