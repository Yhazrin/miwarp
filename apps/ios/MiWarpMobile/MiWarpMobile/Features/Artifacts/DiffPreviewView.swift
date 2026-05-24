import SwiftUI

struct DiffPreviewView: View {
    let diff: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(diff.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                    HStack(spacing: 0) {
                        Text(diffLinePrefix(line))
                            .font(MWTypography.monoSmall())
                            .foregroundColor(diffLineColor(line).opacity(0.6))
                            .frame(width: 20, alignment: .leading)

                        Text(line)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(diffLineColor(line))
                    }
                    .padding(.vertical, 1)
                    .background(diffLineBackground(line))
                }
            }
            .padding(MWSpacing.sm)
        }
        .background(
            RoundedRectangle(cornerRadius: MWRadius.sm)
                .fill(MWColors.bgDeep)
        )
    }

    private func diffLinePrefix(_ line: String) -> String {
        if line.hasPrefix("+") { return "+" }
        if line.hasPrefix("-") { return "-" }
        if line.hasPrefix("@") { return "@" }
        return " "
    }

    private func diffLineColor(_ line: String) -> Color {
        if line.hasPrefix("+") { return MWColors.statusSuccess }
        if line.hasPrefix("-") { return MWColors.statusError }
        if line.hasPrefix("@") { return MWColors.accentCyan }
        return MWColors.textSecondary
    }

    private func diffLineBackground(_ line: String) -> Color {
        if line.hasPrefix("+") { return MWColors.statusSuccess.opacity(0.08) }
        if line.hasPrefix("-") { return MWColors.statusError.opacity(0.08) }
        return .clear
    }
}
