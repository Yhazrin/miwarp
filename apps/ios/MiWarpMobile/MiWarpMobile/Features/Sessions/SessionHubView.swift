import SwiftUI

struct SessionHubView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    #if canImport(ActivityKit)
    @StateObject private var syncManager = SessionSyncManager.shared
    #endif
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
                } else if store.isConnected && !isLoading && runs.isEmpty {
                    connectedEmptyView
                } else if isLoading && runs.isEmpty {
                    ContentUnavailableView {
                        Label("Loading Sessions", systemImage: "arrow.clockwise")
                    } description: {
                        Text("Fetching sessions from your desktop...")
                    }
                } else if let error, runs.isEmpty {
                    ContentUnavailableView {
                        Label("Cannot Load Sessions", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await loadRuns() } }
                            .buttonStyle(.bordered)
                    }
                } else {
                    sessionList
                }
            }
            .navigationTitle("Sessions")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search sessions...")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if store.isConnected {
                        Menu {
                            filterMenuContent
                        } label: {
                            HStack(spacing: 4) {
                                Text(activeFilterLabel)
                                    .font(.caption)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 10, weight: .medium))
                            }
                            .foregroundColor(filters.isActive ? theme.tabActive : .secondary)
                        }

                        Button {
                            Task { await loadRuns() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                }
            }
            .task {
                if store.isConnected {
                    await loadRuns()
                }
            }
            .onChange(of: store.isConnected) { _, connected in
                if connected {
                    Task { await loadRuns() }
                }
            }
            .refreshable {
                await loadRuns()
            }
            .background(MWPatternedBackdrop())
        }
    }

    // MARK: - Filter Menu

    @ViewBuilder
    private var filterMenuContent: some View {
        Button {
            filters.status = nil
        } label: {
            Label("All", systemImage: filters.status == nil ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .running ? nil : .running
        } label: {
            Label("Running", systemImage: filters.status == .running ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .waitingApproval ? nil : .waitingApproval
        } label: {
            Label("Approval", systemImage: filters.status == .waitingApproval ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .failed ? nil : .failed
        } label: {
            Label("Failed", systemImage: filters.status == .failed ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .completed ? nil : .completed
        } label: {
            Label("Recent", systemImage: filters.status == .completed ? "checkmark" : "")
        }
    }

    // MARK: - Not Connected View

    private var notConnectedView: some View {
        ScrollView {
            VStack(spacing: 16) {
                notConnectedHero
                statusHint
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
        }
        .background(MWPatternedBackdrop())
    }

    private var notConnectedHero: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Connect Desktop")
                    .font(.title2.weight(.semibold))
                    .foregroundColor(heroTextColor)

                Text("Sync local MiWarp sessions over your network.")
                    .font(.callout)
                    .foregroundColor(heroTextColor.opacity(0.85))
            }

            NavigationLink {
                PairingView()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 16, weight: .medium))
                    Text("Connect Now")
                        .font(.body.weight(.medium))
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundColor(theme.accentPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    Capsule()
                        .fill(Color.white)
                )
            }

            HStack(spacing: 8) {
                heroPill(icon: "server.rack", label: "Enable Server")
                heroPill(icon: "network", label: "LAN Access")
                heroPill(icon: "qrcode.viewfinder", label: "Scan QR")
            }
        }
        .padding(16)
        .background(MWColors.accentPrimary)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var heroTextColor: Color {
        switch theme.accentTheme {
        case .deepSeaMilk, .auroraPomelo, .auroraLime:
            return .black
        default:
            return .white
        }
    }

    // MARK: - Connected Empty View

    private var connectedEmptyView: some View {
        ScrollView {
            VStack(spacing: 16) {
                connectedHeroCard
                connectedStatusHint
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
        }
        .background(MWPatternedBackdrop())
    }

    private var connectedHeroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(MWColors.statusSuccess)

                    Text("Desktop Connected")
                        .font(.title2.weight(.semibold))
                        .foregroundColor(.white)
                }

                Text("Waiting for sessions to sync.")
                    .font(.callout)
                    .foregroundColor(.white.opacity(0.85))
            }

            #if canImport(ActivityKit)
            Button {
                if syncManager.isSyncing {
                    syncManager.cancelSync()
                } else {
                    syncManager.startSync(store: store)
                    Task {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        while syncManager.isSyncing {
                            try? await Task.sleep(nanoseconds: 1_000_000_000)
                        }
                        await loadRuns()
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    if syncManager.isSyncing {
                        ProgressView()
                            .scaleEffect(0.8)
                        Text(syncManager.syncPhase.displayTitle)
                            .font(.body.weight(.medium))
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 14, weight: .medium))
                        Text("Sync Now")
                            .font(.body.weight(.medium))
                    }
                    Spacer()
                }
                .foregroundColor(theme.accentPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    Capsule()
                        .fill(Color.white)
                )
            }
            .disabled(syncManager.isSyncing && syncManager.syncPhase == .preparing)
            #else
            Button {
                Task { await loadRuns() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .medium))
                    Text("Sync Now")
                        .font(.body.weight(.medium))
                    Spacer()
                }
                .foregroundColor(theme.accentPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    Capsule()
                        .fill(Color.white)
                )
            }
            #endif

            if let conn = store.activeConnection {
                HStack(spacing: 4) {
                    Image(systemName: "desktopcomputer")
                        .font(.system(size: 10))
                    Text(conn.host)
                        .font(.caption)
                }
                .foregroundColor(.white.opacity(0.7))
            }
        }
        .padding(16)
        .background(
            LinearGradient(
                gradient: Gradient(colors: [
                    MWColors.statusSuccess,
                    MWColors.statusSuccess.opacity(0.8)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Status Hints

    private var statusHint: some View {
        VStack(spacing: 4) {
            Text("No desktop connected")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            Text("Start MiWarp Desktop and enable Web Server to begin.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(MWColors.cardBg)
        )
    }

    private var connectedStatusHint: some View {
        VStack(spacing: 4) {
            Text("No sessions yet")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            Text("Start a session in MiWarp Desktop to see it here.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(MWColors.cardBg)
        )
    }

    // MARK: - Helper

    private func heroPill(icon: String, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
            Text(label)
                .font(.caption)
        }
        .foregroundColor(.white.opacity(0.9))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(Color.white.opacity(0.2))
        )
    }

    // MARK: - Session List

    private var sessionList: some View {
        List {
            // Connection status header
            Section {
                EmptyView()
            } header: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(store.isConnected ? MWColors.statusSuccess : MWColors.statusError)
                        .frame(width: 6, height: 6)

                    Text(store.isConnected ? "Connected" : "Disconnected")
                        .font(.caption)
                        .foregroundColor(theme.textTertiary)

                    if let conn = store.activeConnection {
                        Text("·")
                            .foregroundColor(theme.textTertiary)
                        Text(conn.host)
                            .font(.caption.monospaced())
                            .foregroundColor(theme.textTertiary)
                    }

                    Spacer()

                    Text("\(filteredRuns.count) sessions")
                        .font(.caption)
                        .foregroundColor(theme.textTertiary)
                }
            }
            .listRowBackground(Color.clear)

            if filteredRuns.isEmpty && !searchText.isEmpty {
                ContentUnavailableView.search(text: searchText)
                    .listRowBackground(Color.clear)
            } else if filteredRuns.isEmpty {
                ContentUnavailableView {
                    Label("All Clear", systemImage: "checkmark.circle")
                } description: {
                    Text("No sessions match the current filters")
                }
                .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(filteredRuns) { run in
                        NavigationLink(value: run) {
                            SessionRowView(run: run)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if run.status == .running {
                                Button(role: .destructive) {
                                    // stop action
                                } label: {
                                    Label("Stop", systemImage: "stop.fill")
                                }
                            }
                            Button {
                                // pin action
                            } label: {
                                Label("Pin", systemImage: "pin")
                            }
                            .tint(MWColors.statusWarning)
                        }
                        .contextMenu {
                            Button {
                                // view details
                            } label: {
                                Label("Details", systemImage: "info.circle")
                            }
                            if run.status == .running {
                                Button(role: .destructive) {
                                    // stop
                                } label: {
                                    Label("Stop", systemImage: "stop.fill")
                                }
                            }
                            Divider()
                            Button {
                                // copy path
                            } label: {
                                Label("Copy Path", systemImage: "doc.on.doc")
                            }
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(MWPatternedBackdrop())
        .navigationDestination(for: MiWarpRun.self) { run in
            ChatView(runId: run.id, runTitle: run.displayTitle)
        }
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

// MARK: - Session Row (native style)

struct SessionRowView: View {
    @EnvironmentObject private var theme: MWTheme
    let run: MiWarpRun

    private var statusColor: Color {
        MWColors.color(for: run.status)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 3) {
                Text(run.displayTitle)
                    .font(.body.weight(.medium))
                    .foregroundColor(theme.textPrimary)
                    .lineLimit(2)

                if let cwd = run.displayCwd {
                    Text(cwd)
                        .font(.caption.monospaced())
                        .foregroundColor(theme.textTertiary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                if let time = run.displayRelativeTime {
                    Text(time)
                        .font(.caption)
                        .foregroundColor(theme.textTertiary)
                }

                if let msgs = run.displayMessageCount {
                    Text(msgs)
                        .font(.caption2)
                        .foregroundColor(theme.textTertiary)
                }
            }
        }
        .padding(.vertical, 2)
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
