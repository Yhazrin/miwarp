import SwiftUI

struct SessionFiltersView: View {
    @Binding var filters: SessionFilters
    let runs: [MiWarpRun]
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var theme: MWTheme
    @State private var showResetConfirm = false

    private var availableAgents: [String] {
        Array(Set(runs.map(\.agent))).sorted()
    }

    private func statusCount(_ status: RunStatus) -> Int {
        runs.filter { $0.status == status }.count
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
                .listRowBackground(theme.cardBg)

                Section("Status") {
                    Picker("Status", selection: $filters.status) {
                        Text("Any").tag(nil as RunStatus?)
                        ForEach(RunStatus.allCases, id: \.self) { status in
                            HStack {
                                Circle()
                                    .fill(MWColors.color(for: status))
                                    .frame(width: 8, height: 8)
                                Text(status.displayLabel)
                                Spacer()
                                let count = statusCount(status)
                                if count > 0 {
                                    Text("\(count)")
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .tag(status as RunStatus?)
                        }
                    }
                }
                .listRowBackground(theme.cardBg)

                Section("Source") {
                    Picker("Source", selection: $filters.source) {
                        Text("Any").tag(nil as RunSource?)
                        Text("Native").tag(RunSource.native as RunSource?)
                        Text("CLI Import").tag(RunSource.cliImport as RunSource?)
                    }
                }
                .listRowBackground(theme.cardBg)

                Section {
                    Button("Reset Filters", role: .destructive) {
                        showResetConfirm = true
                    }
                }
                .listRowBackground(theme.cardBg)
            }
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog("Reset all filters?", isPresented: $showResetConfirm, titleVisibility: .visible) {
                Button("Reset", role: .destructive) { filters.reset() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}
