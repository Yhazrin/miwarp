import SwiftUI

struct MiStatusBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundColor(MWColors.accentOnAccent)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color, in: Capsule())
    }
}
