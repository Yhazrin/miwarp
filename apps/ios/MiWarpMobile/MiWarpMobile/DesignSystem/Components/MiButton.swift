import SwiftUI

struct MiButton: View {
    let title: String
    let icon: String?
    let style: ButtonStyle
    let action: () -> Void

    enum ButtonStyle {
        case primary
        case secondary
        case destructive
    }

    @EnvironmentObject private var theme: MWTheme

    init(_ title: String, icon: String? = nil, style: ButtonStyle = .primary, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.style = style
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(title)
                    .font(.subheadline.weight(.medium))
            }
            .foregroundColor(foregroundColor)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: MWRadius.lg))
        }
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
    VStack(spacing: 12) {
        MiButton("Primary", icon: "plus") {}
        MiButton("Secondary", style: .secondary) {}
        MiButton("Destructive", icon: "trash", style: .destructive) {}
    }
    .environmentObject(MWTheme())
    .padding()
}
