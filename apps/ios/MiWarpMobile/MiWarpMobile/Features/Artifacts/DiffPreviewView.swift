import SwiftUI

struct DiffPreviewView: View {
    let diff: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(diff.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                    HStack(spacing: 0) {
                        Text(diffLinePrefix(line))
                            .font(.caption2.monospaced())
                            .foregroundStyle(diffLineColor(line).opacity(0.6))
                            .frame(width: 20, alignment: .leading)

                        Text(line)
                            .font(.caption2.monospaced())
                            .foregroundStyle(diffLineColor(line))
                    }
                    .padding(.vertical, 1)
                    .background(diffLineBackground(line))
                }
            }
            .padding(8)
        }
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private func diffLinePrefix(_ line: String) -> String {
        if line.hasPrefix("+") { return "+" }
        if line.hasPrefix("-") { return "-" }
        if line.hasPrefix("@") { return "@" }
        return " "
    }

    private func diffLineColor(_ line: String) -> Color {
        if line.hasPrefix("+") { return .green }
        if line.hasPrefix("-") { return .red }
        if line.hasPrefix("@") { return .blue }
        return .secondary
    }

    private func diffLineBackground(_ line: String) -> Color {
        if line.hasPrefix("+") { return .green.opacity(0.08) }
        if line.hasPrefix("-") { return .red.opacity(0.08) }
        return .clear
    }
}
