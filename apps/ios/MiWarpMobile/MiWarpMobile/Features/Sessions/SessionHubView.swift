import SwiftUI

struct SessionHubView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var runs: [MiWarpRun] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var searchText = ""
    @State private var filters = SessionFilters()

    private var filteredRuns: [MiWarpRun] {
        runs.filter { run in
            if !searchText.isEmpty {
                let query = searchText.lowercased()
                let matchesSearch = (run.displayTitle.lowercased().contains(query)) ||
                    (run.cwd.lowercased().contains(query)) ||
                    ((run.model ?? "").lowercased().contains(query))
                if !matchesSearch { return false }
            }
            if let agent = filters.agent, run.agent != agent { return false }
            if let status = filters.status, run.status != status { return false }
            if let source = filters.source, run.source != source { return false }
            return true
        }
    }

    private var activeFilterLabel: String {
        switch filters.status {
        case .running: return String(localized: "Running")
        case .waitingApproval: return String(localized: "Approval")
        case .failed: return String(localized: "Failed")
        case .completed: return String(localized: "Recent")
        case .idle: return String(localized: "Idle")
        case .pending: return String(localized: "Pending")
        case .stopped: return String(localized: "Stopped")
        case nil: return String(localized: "All")
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if !store.isConnected && runs.isEmpty {
                    notConnectedView
                } else if isLoading && runs.isEmpty {
                    MWLoadingState(message: String(localized: "Loading sessions..."))
                } else if let error, runs.isEmpty {
                    MWErrorState(
                        message: error,
                        title: String(localized: "Cannot Load Sessions"),
                        actionTitle: String(localized: "Retry"),
                        onAction: { Task { await loadRuns() } }
                    )
                } else {
                    sessionList
                }
            }
            .background(theme.bgDeepest)
            .navigationTitle(String(localized: "Sessions"))
            .searchable(text: $searchText, prompt: String(localized: "Search..."))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if store.isConnected {
                        Menu {
                            Button {
                                filters.status = nil
                            } label: {
                                Label { Text(String(localized: "All")) } icon: {
                                    if filters.status == nil {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                            Button {
                                filters.status = filters.status == .running ? nil : .running
                            } label: {
                                Label { Text(String(localized: "Running")) } icon: {
                                    if filters.status == .running {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                            Button {
                                filters.status = filters.status == .waitingApproval ? nil : .waitingApproval
                            } label: {
                                Label { Text(String(localized: "Approval")) } icon: {
                                    if filters.status == .waitingApproval {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                            Button {
                                filters.status = filters.status == .failed ? nil : .failed
                            } label: {
                                Label { Text(String(localized: "Failed")) } icon: {
                                    if filters.status == .failed {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                            Button {
                                filters.status = filters.status == .completed ? nil : .completed
                            } label: {
                                Label { Text(String(localized: "Recent")) } icon: {
                                    if filters.status == .completed {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text(activeFilterLabel)
                                    .font(MWTypography.caption())
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 10, weight: .medium))
                            }
                            .foregroundColor(filters.isActive ? MWColors.tabActive : MWColors.textSecondary)
                        }

                        Button {
                            Task { await loadRuns() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundColor(MWColors.textSecondary)
                        }
                    }
                }
            }
            .task {
                if store.isConnected {
                    await loadRuns()
                }
            }
            .onChange(of: store.isConnected) { connected in
                if connected {
                    Task { await viewModel.loadRuns() }
                }
            }
            .refreshable {
                await loadRuns()
            }
        }
    }

    // MARK: - Not Connected View

    private var notConnectedView: some View {
        ScrollView {
            VStack(spacing: MWSpacing.lg) {
                // Header with title + subtitle
                VStack(alignment: .leading, spacing: MWSpacing.xs) {
                    Text(String(localized: "Sessions"))
                        .font(MWTypography.largeTitle())
                        .foregroundColor(MWColors.textPrimary)

                    Text(String(localized: "Connect, sync, and continue your MiWarp conversations."))
                        .font(MWTypography.callout())
                        .foregroundColor(MWColors.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.top, MWSpacing.md)

                // Hero Card
                heroCard

                // Status hint
                statusHint

                Spacer(minLength: MWSpacing.xxl)
            }
            .padding(.horizontal, MWSpacing.md)
        }
        .background(theme.bgDeepest)
    }

    // MARK: - Hero Card

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            // Card header
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                Text(String(localized: "Connect Desktop"))
                    .font(MWTypography.title())
                    .foregroundColor(.white)

                Text(String(localized: "Sync local MiWarp sessions over your network."))
                    .font(MWTypography.callout())
                    .foregroundColor(.white.opacity(0.85))
            }

            // Connect Now button
            NavigationLink {
                PairingView()
            } label: {
                HStack(spacing: MWSpacing.sm) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 16, weight: .medium))

                    Text(String(localized: "Connect Now"))
                        .font(MWTypography.bodyMedium())

                    Spacer()

                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundColor(MWColors.accentPrimary)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.vertical, MWSpacing.md)
                .background(
                    Capsule()
                        .fill(Color.white)
                )
            }

            // Step pills
            HStack(spacing: MWSpacing.sm) {
                stepPill(icon: "server.rack", label: String(localized: "Enable Server"))
                stepPill(icon: "network", label: String(localized: "LAN Access"))
                stepPill(icon: "qrcode.viewfinder", label: String(localized: "Scan QR"))
            }
        }
        .padding(MWSpacing.lg)
        .background(
            LinearGradient(
                gradient: Gradient(colors: [
                    Color(hex: 0xC51F62),
                    Color(hex: 0x8B3DFF)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: MWRadius.xxl))
    }

    private func stepPill(icon: String, label: String) -> some View {
        HStack(spacing: MWSpacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))

            Text(label)
                .font(MWTypography.caption())
        }
        .foregroundColor(.white.opacity(0.9))
        .padding(.horizontal, MWSpacing.sm)
        .padding(.vertical, MWSpacing.xs)
        .background(
            Capsule()
                .fill(Color.white.opacity(0.2))
        )
    }

    // MARK: - Status Hint

    private var statusHint: some View {
        VStack(spacing: MWSpacing.xs) {
            Text(String(localized: "No desktop connected"))
                .font(MWTypography.subheadlineMedium())
                .foregroundColor(MWColors.textSecondary)

            Text(String(localized: "Start MiWarp Desktop and enable Web Server to begin."))
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, MWSpacing.md)
        .padding(.horizontal, MWSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.md)
                .fill(Color(hex: 0xFFF0F5).opacity(0.6))
        )
    }

    // MARK: - Session List

    private var sessionList: some View {
        VStack(spacing: 0) {
            // Connection status header
            connectionStatusHeader

            // Content
            if filteredRuns.isEmpty && !searchText.isEmpty {
                MWEmptyState(
                    icon: "magnifyingglass",
                    title: String(localized: "No Results"),
                    message: String(localized: "No sessions match \"\(searchText)\"")
                )
            } else if filteredRuns.isEmpty {
                MWEmptyState(
                    icon: "checkmark.circle",
                    title: String(localized: "All Clear"),
                    message: String(localized: "No sessions match the current filters")
                )
            } else {
                List {
                    ForEach(filteredRuns) { run in
                        sessionRow(for: run)
                    }
                }
                .listStyle(.plain)
                .background(theme.bgDeepest)
                .navigationDestination(for: MiWarpRun.self) { run in
                    ChatView(runId: run.id, runTitle: run.displayTitle)
                }
            }
        }
        .background(theme.bgDeepest)
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: 1)
        }
    }

    @ViewBuilder
    private func sessionRow(for run: MiWarpRun) -> some View {
        NavigationLink(value: run) {
            SessionCardView(run: run)
        }
        .listRowInsets(EdgeInsets(
            top: 0,
            leading: MWSpacing.md,
            bottom: 0,
            trailing: MWSpacing.md
        ))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if run.status == .running {
                Button(role: .destructive) {
                    // stop action
                } label: {
                    Label(String(localized: "Stop"), systemImage: "stop.fill")
                }
            }
            Button {
                // pin action
            } label: {
                Label(String(localized: "Pin"), systemImage: "pin")
            }
            .tint(MWColors.statusWarning)
        }
        .contextMenu {
            Button {
                // view details
            } label: {
                Label(String(localized: "Details"), systemImage: "info.circle")
            }
            if run.status == .running {
                Button(role: .destructive) {
                    // stop
                } label: {
                    Label(String(localized: "Stop"), systemImage: "stop.fill")
                }
            }
            Divider()
            Button {
                // copy path
            } label: {
                Label(String(localized: "Copy Path"), systemImage: "doc.on.doc")
            }
        }
    }

    private var connectionStatusHeader: some View {
        HStack(spacing: MWSpacing.sm) {
            Circle()
                .fill(store.isConnected ? Color(hex: 0x22C55E) : MWColors.statusError)
                .frame(width: 6, height: 6)

            Text(store.isConnected ? String(localized: "Connected") : String(localized: "Disconnected"))
                .font(.system(size: 12))
                .foregroundColor(MWColors.textTertiary)

            if let conn = store.activeConnection {
                Text("·")
                    .foregroundColor(MWColors.textTertiary)
                Text(conn.host)
                    .font(.system(size: 11).monospaced())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()

            Text("\(filteredRuns.count) " + String(localized: "sessions"))
                .font(.system(size: 12))
                .foregroundColor(MWColors.textTertiary)
        }
        .padding(.horizontal, MWSpacing.md)
        .padding(.vertical, MWSpacing.xs)
        .background(theme.bgDeepest)
    }

    // MARK: - Load

    private func loadRuns() async {
        guard let rpc = store.rpc else {
            if runs.isEmpty {
                error = String(localized: "Not connected")
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
