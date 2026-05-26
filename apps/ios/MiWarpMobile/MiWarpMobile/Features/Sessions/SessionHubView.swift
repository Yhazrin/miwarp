import SwiftUI

struct SessionHubView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    let usesInlineChat: Bool
    #if canImport(ActivityKit)
    @StateObject private var syncManager = SessionSyncManager.shared
    #endif
    @State private var runs: [MiWarpRun] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var searchText = ""
    @State private var filters = SessionFilters()
    @State private var localSelectedRun: MiWarpRun?
    @StateObject private var toastPresenter = MiToastPresenter()
    private let externalSelectedRun: Binding<MiWarpRun?>?

    init(usesInlineChat: Bool = false, selectedRun: Binding<MiWarpRun?>? = nil) {
        self.usesInlineChat = usesInlineChat
        self.externalSelectedRun = selectedRun
    }

    private var selectedRun: MiWarpRun? {
        externalSelectedRun?.wrappedValue ?? localSelectedRun
    }

    private func selectRun(_ run: MiWarpRun) {
        if let externalSelectedRun {
            externalSelectedRun.wrappedValue = run
        } else {
            localSelectedRun = run
        }
    }

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
        MWAdaptiveReader { layout in
            if usesInlineChat && layout.shouldUseSplitView {
                inlineSplitBody(layout: layout)
            } else {
                compactBody(layout: layout)
            }
        }
    }

    private func compactBody(layout: MWAdaptiveLayout) -> some View {
        NavigationStack {
            contentState(layout: layout, navigationMode: .push)
            .navigationTitle(String(localized: "sessions.title"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: String(localized: "sessions.search"))
            .toolbar { toolbarContent }
            .task { await loadRunsIfConnected() }
            .onChange(of: store.isConnected) { _, connected in
                if connected { Task { await loadRuns() } }
            }
            .refreshable { await loadRuns() }
            .background(MWPatternedBackdrop())
            .miToastPresenter(toastPresenter)
        }
    }

    private func inlineSplitBody(layout: MWAdaptiveLayout) -> some View {
        HStack(spacing: 0) {
            NavigationStack {
                contentState(layout: layout, navigationMode: .selection)
                    .navigationTitle("Sessions")
                    .navigationBarTitleDisplayMode(.inline)
                    .searchable(text: $searchText, prompt: "Search sessions...")
                    .toolbar { toolbarContent }
                    .task { await loadRunsIfConnected() }
                    .onChange(of: store.isConnected) { _, connected in
                        if connected { Task { await loadRuns() } }
                    }
                    .refreshable { await loadRuns() }
            }
            .frame(width: layout.listColumnWidth)

            Divider()

            NavigationStack {
                if let selectedRun {
                    ChatView(runId: selectedRun.id, runTitle: selectedRun.displayTitle)
                } else {
                    ContentUnavailableView {
                        Label("Select a session", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Choose a conversation to continue.")
                    }
                    .frame(maxWidth: layout.detailMaxWidth)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(MWPatternedBackdrop())
                    .navigationTitle("Session")
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(MWPatternedBackdrop())
        .miToastPresenter(toastPresenter)
    }

    @ViewBuilder
    private func contentState(layout: MWAdaptiveLayout, navigationMode: SessionNavigationMode) -> some View {
        if !store.isConnected && runs.isEmpty {
            notConnectedView(layout: layout)
        } else if store.isConnected && !isLoading && runs.isEmpty {
            connectedEmptyView(layout: layout)
        } else if isLoading && runs.isEmpty {
            ScrollView {
                VStack(spacing: MWSpacing.md) {
                    MiSkeletonCard(lines: 4, height: 168)
                    MiSkeletonCard(lines: 3, showsAvatar: true)
                    MiSkeletonCard(lines: 3, showsAvatar: true)
                }
                .padding(.horizontal, 16)
                .padding(.top, 20)
                .frame(maxWidth: layout.contentMaxWidth)
                .frame(maxWidth: .infinity)
            }
            .background(MWPatternedBackdrop())
        } else if let error, runs.isEmpty {
            ContentUnavailableView {
                Label("Cannot Load Sessions", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await loadRuns() } }
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: layout.contentMaxWidth)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            sessionList(layout: layout, navigationMode: navigationMode)
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
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

    // MARK: - Filter Menu

    @ViewBuilder
    private var filterMenuContent: some View {
        Button {
            filters.status = nil
        } label: {
            Label(String(localized: "sessions.filterAll"), systemImage: filters.status == nil ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .running ? nil : .running
        } label: {
            Label(String(localized: "sessions.filterRunning"), systemImage: filters.status == .running ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .waitingApproval ? nil : .waitingApproval
        } label: {
            Label(String(localized: "sessions.filterApproval"), systemImage: filters.status == .waitingApproval ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .failed ? nil : .failed
        } label: {
            Label(String(localized: "sessions.filterFailed"), systemImage: filters.status == .failed ? "checkmark" : "")
        }
        Button {
            filters.status = filters.status == .completed ? nil : .completed
        } label: {
            Label(String(localized: "sessions.filterRecent"), systemImage: filters.status == .completed ? "checkmark" : "")
        }
    }

    // MARK: - Not Connected View

    private func notConnectedView(layout: MWAdaptiveLayout) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                HomeDashboardView(
                    runs: [],
                    connectionState: store.connectionState,
                    activeConnection: store.activeConnection,
                    toastPresenter: toastPresenter
                )
                notConnectedHero
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .frame(maxWidth: layout.contentMaxWidth)
            .frame(maxWidth: .infinity)
        }
        .background(MWPatternedBackdrop())
    }

    private var notConnectedHero: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(String(localized: "pairing.connectDesktop"))
                    .font(.title2.weight(.semibold))
                    .foregroundColor(heroTextColor)

                Text(String(localized: "sessions.syncDescription"))
                    .font(.callout)
                    .foregroundColor(heroTextColor.opacity(0.85))
            }

            NavigationLink {
                PairingView()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 16, weight: .medium))
                    Text(String(localized: "sessions.connectNow"))
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
                heroPill(icon: "server.rack", label: String(localized: "pairing.enableServer"))
                heroPill(icon: "network", label: String(localized: "pairing.lanAccess"))
                heroPill(icon: "qrcode.viewfinder", label: String(localized: "pairing.scanQR"))
            }
        }
        .padding(16)
        .background(
            LinearGradient(
                gradient: Gradient(colors: [
                    MWColors.accentPrimary,
                    MWColors.accentPrimary.opacity(0.85),
                    theme.accentSecondary.opacity(0.7)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
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

    private func connectedEmptyView(layout: MWAdaptiveLayout) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                HomeDashboardView(
                    runs: runs,
                    connectionState: store.connectionState,
                    activeConnection: store.activeConnection,
                    toastPresenter: toastPresenter
                )
                connectedHeroCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .frame(maxWidth: layout.contentMaxWidth)
            .frame(maxWidth: .infinity)
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

                    Text(String(localized: "sessions.desktopConnected"))
                        .font(.title2.weight(.semibold))
                        .foregroundColor(.white)
                }

                Text(String(localized: "sessions.waitingSync"))
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
                        Text(String(localized: "sessions.syncNow"))
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
            Text(String(localized: "sessions.noDesktop"))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.cardTextSecondary)
            Text(String(localized: "sessions.startDesktop"))
                .font(.caption)
                .foregroundStyle(theme.cardTextTertiary)
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
            Text(String(localized: "sessions.noSessions"))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.cardTextSecondary)
            Text(String(localized: "sessions.startSession"))
                .font(.caption)
                .foregroundStyle(theme.cardTextTertiary)
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

    private func sessionList(layout: MWAdaptiveLayout, navigationMode: SessionNavigationMode) -> some View {
        List {
            Section {
                HomeDashboardView(
                    runs: runs,
                    connectionState: store.connectionState,
                    activeConnection: store.activeConnection,
                    toastPresenter: toastPresenter
                )
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 8, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }

            // Connection status header
            Section {
                EmptyView()
            } header: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(store.isConnected ? MWColors.statusSuccess : MWColors.statusError)
                        .frame(width: 6, height: 6)

                    Text(store.isConnected ? String(localized: "connection.connected") : String(localized: "connection.disconnected"))
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

                    Text(String(format: String(localized: "sessions.count"), filteredRuns.count))
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
                    Label(String(localized: "sessions.allClear"), systemImage: "checkmark.circle")
                } description: {
                    Text(String(localized: "sessions.noMatch"))
                }
                .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(filteredRuns) { run in
                        sessionRow(for: run, navigationMode: navigationMode)
                        .listRowBackground(rowBackground(for: run, navigationMode: navigationMode))
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if run.status == .running {
                                Button(role: .destructive) {
                                    // stop action
                                } label: {
                                    Label(String(localized: "action.stop"), systemImage: "stop.fill")
                                }
                            }
                            Button {
                                // pin action
                            } label: {
                                Label(String(localized: "action.pin"), systemImage: "pin")
                            }
                            .tint(MWColors.statusWarning)
                        }
                        .contextMenu {
                            Button {
                                #if os(iOS)
                                UIPasteboard.general.string = run.cwd
                                #endif
                            } label: {
                                Label(String(localized: "sessions.copyPath"), systemImage: "doc.on.doc")
                            }

                            if let model = run.model {
                                Button {
                                    #if os(iOS)
                                    UIPasteboard.general.string = model
                                    #endif
                                } label: {
                                    Label(String(localized: "sessions.copyModel"), systemImage: "cpu")
                                }
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
        .frame(maxWidth: navigationMode == .push ? layout.contentMaxWidth : .infinity)
        .frame(maxWidth: .infinity)
        .navigationDestination(for: MiWarpRun.self) { run in
            ChatView(runId: run.id, runTitle: run.displayTitle)
        }
    }

    @ViewBuilder
    private func sessionRow(for run: MiWarpRun, navigationMode: SessionNavigationMode) -> some View {
        switch navigationMode {
        case .push:
            NavigationLink(value: run) {
                SessionRowView(run: run)
            }
        case .selection:
            Button {
                selectRun(run)
            } label: {
                SessionRowView(run: run)
            }
            .buttonStyle(.plain)
        }
    }

    private func rowBackground(for run: MiWarpRun, navigationMode: SessionNavigationMode) -> Color {
        guard navigationMode == .selection, selectedRun?.id == run.id else {
            return Color.clear
        }
        return theme.accentPrimary.opacity(0.14)
    }

    private func loadRunsIfConnected() async {
        if store.isConnected {
            await loadRuns()
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
            ZStack {
                if run.status == .running {
                    Circle()
                        .fill(statusColor.opacity(0.3))
                        .frame(width: 14, height: 14)
                        .symbolEffect(.pulse.byLayer, options: .repeating)
                }
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
            }
            .frame(width: 14, height: 14)
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

private enum SessionNavigationMode {
    case push
    case selection
}
