import SwiftUI

struct RawEventView: View {
    let events: [BusEvent]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(events) { event in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("seq: \(event.seq)")
                            .font(.caption.monospaced())
                            .foregroundStyle(.blue)
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
            }
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
