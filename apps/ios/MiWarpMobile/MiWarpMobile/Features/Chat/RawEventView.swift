import SwiftUI

struct RawEventView: View {
    let events: [BusEvent]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(events) { event in
                VStack(alignment: .leading, spacing: MWSpacing.xs) {
                    HStack {
                        Text("seq: \(event.seq)")
                            .font(MWTypography.monoCaption())
                            .foregroundColor(MWColors.accentCyan)
                        Spacer()
                        Text(event.runId.prefix(8) + "...")
                            .font(MWTypography.monoSmall())
                            .foregroundColor(MWColors.textTertiary)
                    }

                    Text(String(describing: event.payload))
                        .font(MWTypography.monoSmall())
                        .foregroundColor(MWColors.textSecondary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                }
                .padding(.vertical, MWSpacing.xs)
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
