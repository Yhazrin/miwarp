import SwiftUI

struct SessionHubView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
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

    var body: some View {
        NavigationStack {
            Group {
                if !store.isConnected && runs.isEmpty {
                    notConnectedView
                } else if isLoading && runs.isEmpty {
                    MWLoadingState(message: "Loading sessions...")
                } else if let error, runs.isEmpty {
                    MWErrorState(message: error, onAction: {
                        Task { await loadRuns() }
                    })
                } else {
                    sessionList
                }
            }
            .background(theme.bgDeepest)
            .navigationTitle("Sessions")
            .searchable(text: $searchText, prompt: "Search sessions...")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if store.isConnected {
                        Button {
                            showFilters = true
                        } label: {
                            Image(systemName: filters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                                .foregroundColor(filters.isActive ? MWColors.accentCyan : MWColors.textSecondary)
                        }

                        Button {
                            Task { await loadRuns() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .foregroundColor(MWColors.textSecondary)
                        }
                    }
                }
            }
            .sheet(isPresented: $showFilters) {
                SessionFiltersView(filters: $filters, runs: runs)
            }
            .task {
                if store.isConnected {
                    await loadRuns()
                }
            }
            .refreshable {
                await loadRuns()
            }
        }
    }

    // MARK: - Not Connected View

    private var notConnectedView: some View {
        VStack(spacing: MWSpacing.xxl) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(MWColors.accentPrimary.opacity(0.08))
                    .frame(width: 100, height: 100)

                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .font(.system(size: 40))
                    .foregroundStyle(MWColors.accentPrimary, MWColors.accentCyan)
            }

            VStack(spacing: MWSpacing.sm) {
                Text("Connect to MiWarp Desktop")
                    .font(MWTypography.title())
                    .foregroundColor(MWColors.textPrimary)

                Text("Your phone connects to a running MiWarp Desktop instance over the local network.")
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Steps
            VStack(alignment: .leading, spacing: MWSpacing.md) {
                stepRow(number: 1, text: "Enable Web Server in Desktop Settings")
                stepRow(number: 2, text: "Set bind to 0.0.0.0 (LAN access)")
                stepRow(number: 3, text: "Scan QR or add connection manually")
            }
            .padding(.horizontal, MWSpacing.xl)
            .padding(.vertical, MWSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg)
                    .fill(MWColors.glassBg)
                    .overlay(MWGeometricPattern(opacityOverride: min(theme.textureOpacity, 0.10)))
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .strokeBorder(MWColors.glassBorder, lineWidth: 0.5)
                    )
            )
            .padding(.horizontal, MWSpacing.xl)

            VStack(spacing: MWSpacing.md) {
                // Primary action
                NavigationLink {
                    PairingView()
                } label: {
                    Label("Connect Desktop", systemImage: "plus.circle.fill")
                        .font(MWTypography.bodyMedium())
                        .foregroundColor(MWColors.accentOnAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.md)
                        .background(
                            Capsule()
                                .fill(MWColors.accentPrimary)
                        )
                }
                .padding(.horizontal, MWSpacing.xxxl)

                // Secondary hint
                Text("Make sure Desktop Web Server is enabled")
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()
        }
    }

    private func stepRow(number: Int, text: String) -> some View {
        HStack(spacing: MWSpacing.md) {
            Text("\(number)")
                .font(MWTypography.caption2())
                .foregroundColor(MWColors.accentOnAccent)
                .frame(width: 22, height: 22)
                .background(
                    Circle()
                        .fill(MWColors.accentCyan.opacity(0.6))
                )

            Text(text)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textSecondary)
        }
        .background(MWPatternedBackdrop())
    }

    // MARK: - Session List

    private var sessionList: some View {
        VStack(spacing: 0) {
            // Connection status header
            connectionStatusHeader

            // Filter chips
            if !runs.isEmpty {
                filterChipsRow
            }

            // Content
            if filteredRuns.isEmpty && !searchText.isEmpty {
                MWEmptyState(
                    icon: "magnifyingglass",
                    title: "No Results",
                    message: "No sessions match \"\(searchText)\""
                )
            } else if filteredRuns.isEmpty {
                MWEmptyState(
                    icon: "checkmark.circle",
                    title: "All Clear",
                    message: "No sessions match the current filters"
                )
            } else {
                List {
                    ForEach(filteredRuns) { run in
                        NavigationLink(value: run) {
                            SessionCardView(run: run)
                        }
                        .listRowInsets(EdgeInsets(
                            top: MWSpacing.sm,
                            leading: MWSpacing.lg,
                            bottom: MWSpacing.sm,
                            trailing: MWSpacing.lg
                        ))
                        .listRowBackground(MWColors.bgDeepest)
                        .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
                .navigationDestination(for: MiWarpRun.self) { run in
                    ChatView(runId: run.id, runTitle: run.displayTitle)
                }
            }
        }
    }

    private var connectionStatusHeader: some View {
        HStack(spacing: MWSpacing.sm) {
            Circle()
                .fill(store.isConnected ? MWColors.statusSuccess : MWColors.statusError)
                .frame(width: 6, height: 6)

            Text(store.isConnected ? "Connected" : "Disconnected")
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textTertiary)

            if let conn = store.activeConnection {
                Text("·")
                    .foregroundColor(MWColors.textTertiary)
                Text(conn.name)
                    .font(MWTypography.monoCaption())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()

            Text("\(filteredRuns.count) sessions")
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textTertiary)
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(theme.bgDeep)
    }

    private var filterChipsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: MWSpacing.sm) {
                filterChip(title: "All", isActive: filters.status == nil) {
                    filters.status = nil
                }
                filterChip(title: "Running", isActive: filters.status == .running) {
                    filters.status = filters.status == .running ? nil : .running
                }
                filterChip(title: "Approval", isActive: filters.status == .waitingApproval) {
                    filters.status = filters.status == .waitingApproval ? nil : .waitingApproval
                }
                filterChip(title: "Completed", isActive: filters.status == .completed) {
                    filters.status = filters.status == .completed ? nil : .completed
                }
                filterChip(title: "Failed", isActive: filters.status == .failed) {
                    filters.status = filters.status == .failed ? nil : .failed
                }
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.vertical, MWSpacing.sm)
        }
        .background(theme.bgDeepest)
    }

    private func filterChip(title: String, isActive: Bool, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            Text(title)
                .font(MWTypography.caption())
                            .foregroundColor(isActive ? MWColors.tabActive : MWColors.textTertiary)
                .padding(.horizontal, MWSpacing.md)
                .padding(.vertical, MWSpacing.xs)
                .background(
                    Capsule()
                        .fill(isActive ? MWColors.tabActive.opacity(0.12) : MWColors.bgSurface)
                )
                .overlay(
                    Capsule()
                        .strokeBorder(
                            isActive ? MWColors.tabActive.opacity(0.3) : MWColors.divider,
                            lineWidth: 0.5
                        )
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Load

    private func loadRuns() async {
        guard let rpc = store.rpc else {
            if runs.isEmpty {
                error = "Not connected"
            }
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
