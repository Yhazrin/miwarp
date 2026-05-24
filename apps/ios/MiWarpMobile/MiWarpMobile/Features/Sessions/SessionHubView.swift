import SwiftUI

struct SessionHubView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @State private var runs: [MiWarpRun] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var searchText = ""
    @State private var showFilters = false
    @State private var filters = SessionFilters()

    private var filteredRuns: [MiWarpRun] {
        runs.filter { run in
            if !searchText.isEmpty {
                let query = searchText.lowercased()
                let matchesSearch = (run.displayTitle.lowercased().contains(query)) ||
                    (run.cwd.lowercased().contains(query)) ||
                    (run.model.lowercased().contains(query))
                if !matchesSearch { return false }
            }
            if let agent = filters.agent, run.agent != agent { return false }
            if let status = filters.status, run.status != status { return false }
            if let source = filters.source, run.source != source { return false }
            return true
        }
    }

    private var groupedRuns: [(String, [MiWarpRun])] {
        let grouped = Dictionary(grouping: filteredRuns) { $0.shortCwd }
        return grouped.sorted { $0.key < $1.key }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && runs.isEmpty {
                    MWLoadingState(message: "Loading sessions...")
                } else if let error, runs.isEmpty {
                    MWErrorState(message: error) {
                        Task { await loadRuns() }
                    }
                } else if filteredRuns.isEmpty {
                    MWEmptyState(
                        icon: "bubble.left.and.bubble.right",
                        title: "No Sessions",
                        message: searchText.isEmpty ? "Start a session from the desktop app" : "No sessions match your search"
                    )
                } else {
                    List {
                        ForEach(groupedRuns, id: \.0) { cwd, runs in
                            Section {
                                ForEach(runs) { run in
                                    NavigationLink(value: run) {
                                        SessionCardView(run: run)
                                    }
                                    .listRowInsets(EdgeInsets(
                                        top: MWSpacing.sm,
                                        leading: MWSpacing.lg,
                                        bottom: MWSpacing.sm,
                                        trailing: MWSpacing.lg
                                    ))
                                    .listRowBackground(MWColors.bgBase)
                                    .listRowSeparator(.hidden)
                                }
                            } header: {
                                Text(cwd)
                                    .font(MWTypography.monoCaption())
                                    .foregroundColor(MWColors.textTertiary)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .navigationDestination(for: MiWarpRun.self) { run in
                        ChatView(runId: run.id, runTitle: run.displayTitle)
                    }
                }
            }
            .background(MWColors.bgDeepest)
            .navigationTitle("Sessions")
            .searchable(text: $searchText, prompt: "Search sessions...")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showFilters = true
                    } label: {
                        Image(systemName: filters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await loadRuns() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $showFilters) {
                SessionFiltersView(filters: $filters, runs: runs)
            }
            .task {
                await loadRuns()
            }
            .refreshable {
                await loadRuns()
            }
        }
    }

    private func loadRuns() async {
        guard let rpc = store.rpc else {
            error = "Not connected"
            return
        }

        isLoading = true
        error = nil

        do {
            runs = try await rpc.listRuns()
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }
}

// MARK: - Session Filters

struct SessionFilters {
    var agent: String?
    var status: RunStatus?
    var source: RunSource?

    var isActive: Bool {
        agent != nil || status != nil || source != nil
    }

    mutating func reset() {
        agent = nil
        status = nil
        source = nil
    }
}
