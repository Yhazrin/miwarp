import SwiftUI

struct DiffPreviewView: View {
    let diff: String

    @State private var parsedLines: [DiffLine] = []

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(parsedLines) { line in
                    HStack(spacing: 0) {
                        Text(line.prefix)
                            .font(.caption2.monospaced())
                            .foregroundStyle(line.color.opacity(0.6))
                            .frame(width: 20, alignment: .leading)

                        Text(line.text)
                            .font(.caption2.monospaced())
                            .foregroundStyle(line.color)
                    }
                    .padding(.vertical, 1)
                    .background(line.background)
                }
            }
            .padding(8)
        }
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .onAppear { parseDiff() }
        .onChange(of: diff) { _, _ in parseDiff() }
    }

    private func parseDiff() {
        parsedLines = diff.components(separatedBy: "\n").enumerated().map { index, line in
            DiffLine(
                id: index,
                text: line,
                prefix: diffLinePrefix(line),
                color: diffLineColor(line),
                background: diffLineBackground(line)
            )
        }
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
        if line.hasPrefix("@") { return MWColors.accentPrimary }
        return .secondary
    }

    private func diffLineBackground(_ line: String) -> Color {
        if line.hasPrefix("+") { return MWColors.statusSuccess.opacity(0.08) }
        if line.hasPrefix("-") { return MWColors.statusError.opacity(0.08) }
        return .clear
    }
}

private struct DiffLine: Identifiable {
    let id: Int
    let text: String
    let prefix: String
    let color: Color
    let background: Color
}
