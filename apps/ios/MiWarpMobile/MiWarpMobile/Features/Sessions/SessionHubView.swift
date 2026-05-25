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
            .onChange(of: store.isConnected) { connected in
                if connected {
                    Task { await loadRuns() }
                }
            }
            .refreshable {
                await loadRuns()
            }
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
    }

    private var notConnectedHero: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Connect Desktop")
                    .font(.title2.weight(.semibold))
                    .foregroundColor(.white)

                Text("Sync local MiWarp sessions over your network.")
                    .font(.callout)
                    .foregroundColor(.white.opacity(0.85))
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
        .clipShape(RoundedRectangle(cornerRadius: 16))
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
        .task {
            await loadRuns()
        }
    }

    private var connectedHeroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(.green)

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
                    Color(hex: 0x22C55E),
                    Color(hex: 0x16A34A)
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
                .fill(Color(.secondarySystemGroupedBackground))
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
                .fill(Color(.secondarySystemGroupedBackground))
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
                        .fill(store.isConnected ? .green : .red)
                        .frame(width: 6, height: 6)

                    Text(store.isConnected ? "Connected" : "Disconnected")
                        .font(.caption)
                        .foregroundStyle(.tertiary)

                    if let conn = store.activeConnection {
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(conn.host)
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                    }

                    Spacer()

                    Text("\(filteredRuns.count) sessions")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            if filteredRuns.isEmpty && !searchText.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else if filteredRuns.isEmpty {
                ContentUnavailableView {
                    Label("All Clear", systemImage: "checkmark.circle")
                } description: {
                    Text("No sessions match the current filters")
                }
            } else {
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
                        .tint(.orange)
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
        }
        .listStyle(.plain)
        .navigationDestination(for: MiWarpRun.self) { run in
            ChatView(runId: run.id, runTitle: run.displayTitle)
        }
    }
}

// MARK: - Session Row (native style)

struct SessionRowView: View {
    let run: MiWarpRun

    private var statusColor: Color {
        switch run.status {
        case .running:    return .green
        case .waitingApproval: return .orange
        case .failed:     return .red
        case .completed:  return .gray
        case .idle:       return .secondary
        case .pending:    return .blue
        case .stopped:    return .gray
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 8) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 2) {
                    Text(run.displayTitle)
                        .font(.body.weight(.semibold))
                        .lineLimit(2)

                    Text(run.displayAgentModel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    if run.hasMetadata {
                        HStack(spacing: 6) {
                            if let cwd = run.displayCwd {
                                Text(cwd)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                            }
                            if run.displayCwd != nil, run.displayMessageCount != nil {
                                Text("·")
                                    .foregroundStyle(.tertiary)
                            }
                            if let msgs = run.displayMessageCount {
                                Text(msgs)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }

                Spacer()

                if let time = run.displayRelativeTime {
                    Text(time)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
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
