import SwiftUI

struct RawEventView: View {
    let events: [BusEvent]
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        NavigationStack {
            List(events) { event in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("seq: \(event.seq)")
                            .font(.caption.monospaced())
                            .foregroundStyle(MWColors.accentPrimary)
                        Spacer()
                        Text(event.runId.prefix(8) + "...")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.tertiary)
                    }

                    Text(String(describing: event.payload))
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 2)
                .listRowBackground(theme.cardBg)
            }
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
            .navigationTitle("Raw Events (\(events.count))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
