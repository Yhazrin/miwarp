import SwiftUI

struct MiButton: View {
    let title: String
    let icon: String?
    let style: ButtonStyle
    let action: () -> Void
    let accessibilityLabel: String?

    enum ButtonStyle {
        case primary
        case secondary
        case destructive
    }

    @EnvironmentObject private var theme: MWTheme

    init(_ title: String, icon: String? = nil, style: ButtonStyle = .primary, accessibilityLabel: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.style = style
        self.accessibilityLabel = accessibilityLabel
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: MWSpacing.compact) {
                if let icon {
                    Image(systemName: icon)
                        .font(MWTypography.calloutSemibold())
                }
                Text(title)
                    .font(MWTypography.subheadlineMedium())
            }
            .foregroundColor(foregroundColor)
            .padding(.horizontal, MWSpacing.lg)
            .padding(.vertical, MWSpacing.relaxed)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: MWRadius.lg))
        }
        .accessibilityLabel(accessibilityLabel ?? title)
    }

    private var foregroundColor: Color {
        switch style {
        case .primary: return MWColors.accentOnAccent
        case .secondary: return theme.textPrimary
        case .destructive: return MWColors.accentOnAccent
        }
    }

    private var backgroundColor: Color {
        switch style {
        case .primary: return MWColors.accentPrimary
        case .secondary: return theme.cardBg
        case .destructive: return MWColors.statusError
        }
    }
}

#Preview {
    VStack(spacing: MWSpacing.md) {
        MiButton("Primary", icon: "plus") {}
        MiButton("Secondary", style: .secondary) {}
        MiButton("Destructive", icon: "trash", style: .destructive) {}
    }
    .environmentObject(MWTheme())
    .padding()
}
