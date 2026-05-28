import SwiftUI

struct MiStatusBadge: View {
    let text: String
    let color: Color
    var accessibilityLabel: String?

    var body: some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundColor(MWColors.accentOnAccent)
            .padding(.horizontal, MWSpacing.sm)
            .padding(.vertical, MWSpacing.xs)
            .background(color, in: Capsule())
            .accessibilityLabel(accessibilityLabel ?? text)
    }
}
