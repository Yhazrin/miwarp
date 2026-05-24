import SwiftUI

struct SessionFiltersView: View {
    @Binding var filters: SessionFilters
    let runs: [MiWarpRun]
    @Environment(\.dismiss) private var dismiss

    private var availableAgents: [String] {
        Array(Set(runs.map(\.agent))).sorted()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Agent") {
                    Picker("Agent", selection: $filters.agent) {
                        Text("Any").tag(nil as String?)
                        ForEach(availableAgents, id: \.self) { agent in
                            Text(agent).tag(agent as String?)
                        }
                    }
                }

                Section("Status") {
                    Picker("Status", selection: $filters.status) {
                        Text("Any").tag(nil as RunStatus?)
                        ForEach(RunStatus.allCases, id: \.self) { status in
                            HStack {
                                Circle()
                                    .fill(MWColors.color(for: status))
                                    .frame(width: 8, height: 8)
                                Text(status.displayLabel)
                            }
                            .tag(status as RunStatus?)
                        }
                    }
                }

                Section("Source") {
                    Picker("Source", selection: $filters.source) {
                        Text("Any").tag(nil as RunSource?)
                        Text("Native").tag(RunSource.native as RunSource?)
                        Text("CLI Import").tag(RunSource.cliImport as RunSource?)
                    }
                }

                Section {
                    Button("Reset Filters", role: .destructive) {
                        filters.reset()
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
