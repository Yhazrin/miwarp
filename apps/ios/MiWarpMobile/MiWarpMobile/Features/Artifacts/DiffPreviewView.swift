import SwiftUI

struct DiffPreviewView: View {
    let diff: String

    @State private var parsedLines: [DiffLine] = []

    private var additionCount: Int { parsedLines.filter { $0.prefix == "+" }.count }
    private var deletionCount: Int { parsedLines.filter { $0.prefix == "-" }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Summary
            HStack(spacing: 12) {
                if additionCount > 0 {
                    Label("\(additionCount)", systemImage: "plus.circle.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(MWColors.statusSuccess)
                }
                if deletionCount > 0 {
                    Label("\(deletionCount)", systemImage: "minus.circle.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(MWColors.statusError)
                }
                Spacer()
                Text("\(parsedLines.count) lines")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            // Diff content
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
        }
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
