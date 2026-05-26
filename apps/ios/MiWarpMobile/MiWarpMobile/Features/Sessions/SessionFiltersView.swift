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
                Section(String(localized: "filters.agent")) {
                    Picker(String(localized: "filters.agent"), selection: $filters.agent) {
                        Text(String(localized: "filters.any")).tag(nil as String?)
                        ForEach(availableAgents, id: \.self) { agent in
                            Text(agent).tag(agent as String?)
                        }
                    }
                }
                .listRowBackground(theme.cardBg)

                Section(String(localized: "filters.status")) {
                    Picker(String(localized: "filters.status"), selection: $filters.status) {
                        Text(String(localized: "filters.any")).tag(nil as RunStatus?)
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

                Section(String(localized: "filters.source")) {
                    Picker(String(localized: "filters.source"), selection: $filters.source) {
                        Text(String(localized: "filters.any")).tag(nil as RunSource?)
                        Text(String(localized: "filters.native")).tag(RunSource.native as RunSource?)
                        Text(String(localized: "filters.cliImport")).tag(RunSource.cliImport as RunSource?)
                    }
                }
                .listRowBackground(theme.cardBg)

                Section {
                    Button(String(localized: "filters.resetFilters"), role: .destructive) {
                        showResetConfirm = true
                    }
                }
                .listRowBackground(theme.cardBg)
            }
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
            .navigationTitle(String(localized: "filters.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "action.done")) { dismiss() }
                }
            }
            .confirmationDialog(String(localized: "filters.resetConfirm"), isPresented: $showResetConfirm, titleVisibility: .visible) {
                Button(String(localized: "filters.reset"), role: .destructive) { filters.reset() }
                Button(String(localized: "action.cancel"), role: .cancel) {}
            }
        }
    }
}
