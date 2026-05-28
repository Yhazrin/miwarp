import SwiftUI

struct SessionHubView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    let usesInlineChat: Bool
    #if canImport(ActivityKit)
    @StateObject private var syncManager = SessionSyncManager.shared
    #endif
    @State private var runs: [MiWarpRun] = []
    @State private var pendingSpotlightSessionId: String?
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
        case .running: return String(localized: "sessions.filterRunning")
        case .waitingApproval: return String(localized: "sessions.filterApproval")
        case .failed: return String(localized: "sessions.filterFailed")
        case .completed: return String(localized: "sessions.filterRecent")
        case .idle: return String(localized: "runStatus.idle")
        case .pending: return String(localized: "runStatus.pending")
        case .stopped: return String(localized: "runStatus.stopped")
        case nil: return String(localized: "sessions.filterAll")
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
        .onReceive(NotificationCenter.default.publisher(for: .spotlightSessionOpen)) { notification in
            guard let sessionId = notification.object as? String else { return }
            if let run = runs.first(where: { $0.id == sessionId }) {
                selectRun(run)
            } else {
                // Runs not loaded yet; store and resolve after load
                pendingSpotlightSessionId = sessionId
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
                    .navigationTitle(String(localized: "sessions.title"))
                    .navigationBarTitleDisplayMode(.inline)
                    .searchable(text: $searchText, prompt: String(localized: "sessions.search"))
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
                        Label(String(localized: "sessions.selectSession"), systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text(String(localized: "sessions.selectSessionDesc"))
                    }
                    .frame(maxWidth: layout.detailMaxWidth)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(MWPatternedBackdrop())
                    .navigationTitle(String(localized: "sessions.title"))
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
                .transition(.opacity)
        } else if store.isConnected && !isLoading && runs.isEmpty {
            connectedEmptyView(layout: layout)
                .transition(.opacity)
        } else if isLoading && runs.isEmpty {
            ScrollView {
                VStack(spacing: MWSpacing.md) {
                    MiSkeletonCard(lines: 4, height: 168)
                    MiSkeletonCard(lines: 3, showsAvatar: true)
                    MiSkeletonCard(lines: 3, showsAvatar: true)
                }
                .padding(.horizontal, MWSpacing.lg)
                .padding(.top, MWSpacing.xl)
                .frame(maxWidth: layout.contentMaxWidth)
                .frame(maxWidth: .infinity)
            }
            .background(MWPatternedBackdrop())
        } else if let error, runs.isEmpty {
            ContentUnavailableView {
                Label(String(localized: "sessions.cannotLoad"), systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button(String(localized: "action.retry")) { Task { await loadRuns() } }
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: layout.contentMaxWidth)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.opacity)
        } else {
            sessionList(layout: layout, navigationMode: navigationMode)
                .transition(.opacity)
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            if store.isConnected {
                Menu {
                    filterMenuContent
                } label: {
                    HStack(spacing: MWSpacing.xs) {
                        Text(activeFilterLabel)
                            .font(.caption)
                        Image(systemName: "chevron.down")
                            .font(MWTypography.caption2().weight(.medium))
                    }
                    .foregroundColor(filters.isActive ? theme.tabActive : .secondary)
                }
                .accessibilityLabel(String(localized: "a11y.filterSessions"))

                Button {
                    MiHaptics.lightImpact()
                    Task { await loadRuns() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel(String(localized: "a11y.refreshSessions"))
            }
        }
    }

    // MARK: - Filter Menu

    @ViewBuilder
    private var filterMenuContent: some View {
        Button {
            MiHaptics.lightImpact()
            filters.status = nil
        } label: {
            Label(String(localized: "sessions.filterAll"), systemImage: filters.status == nil ? "checkmark" : "")
        }
        Button {
            MiHaptics.lightImpact()
            filters.status = filters.status == .running ? nil : .running
        } label: {
            Label(String(localized: "sessions.filterRunning"), systemImage: filters.status == .running ? "checkmark" : "")
        }
        Button {
            MiHaptics.lightImpact()
            filters.status = filters.status == .waitingApproval ? nil : .waitingApproval
        } label: {
            Label(String(localized: "sessions.filterApproval"), systemImage: filters.status == .waitingApproval ? "checkmark" : "")
        }
        Button {
            MiHaptics.lightImpact()
            filters.status = filters.status == .failed ? nil : .failed
        } label: {
            Label(String(localized: "sessions.filterFailed"), systemImage: filters.status == .failed ? "checkmark" : "")
        }
        Button {
            MiHaptics.lightImpact()
            filters.status = filters.status == .completed ? nil : .completed
        } label: {
            Label(String(localized: "sessions.filterRecent"), systemImage: filters.status == .completed ? "checkmark" : "")
        }
    }

    // MARK: - Not Connected View

    private func notConnectedView(layout: MWAdaptiveLayout) -> some View {
        ScrollView {
            VStack(spacing: MWSpacing.lg) {
                HomeDashboardView(
                    runs: [],
                    connectionState: store.connectionState,
                    activeConnection: store.activeConnection,
                    toastPresenter: toastPresenter
                )
                notConnectedHero
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.top, MWSpacing.xl)
            .frame(maxWidth: layout.contentMaxWidth)
            .frame(maxWidth: .infinity)
        }
        .background(MWPatternedBackdrop())
    }

    private var notConnectedHero: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                Text(String(localized: "pairing.connectDesktop"))
                    .font(.title2.weight(.semibold))
                    .foregroundColor(theme.accentOnAccent)

                Text(String(localized: "sessions.syncDescription"))
                    .font(.callout)
                    .foregroundColor(theme.accentOnAccent.opacity(0.85))
            }

            NavigationLink {
                PairingView()
            } label: {
                HStack(spacing: MWSpacing.sm) {
                    Image(systemName: "plus.circle.fill")
                        .font(MWTypography.title3().weight(.medium))
                    Text(String(localized: "sessions.connectNow"))
                        .font(.body.weight(.medium))
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(MWTypography.callout().weight(.medium))
                }
                .foregroundColor(theme.accentPrimary)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.vertical, MWSpacing.md)
                .background(
                    Capsule()
                        .fill(MWColors.accentOnAccent)
                )
            }

            HStack(spacing: MWSpacing.sm) {
                heroPill(icon: "server.rack", label: String(localized: "pairing.enableServer"))
                heroPill(icon: "network", label: String(localized: "pairing.lanAccess"))
                heroPill(icon: "qrcode.viewfinder", label: String(localized: "pairing.scanQR"))
            }
        }
        .padding(MWSpacing.lg)
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
        .clipShape(RoundedRectangle(cornerRadius: MWRadius.bubble))
    }

    // MARK: - Connected Empty View

    private func connectedEmptyView(layout: MWAdaptiveLayout) -> some View {
        ScrollView {
            VStack(spacing: MWSpacing.lg) {
                HomeDashboardView(
                    runs: runs,
                    connectionState: store.connectionState,
                    activeConnection: store.activeConnection,
                    toastPresenter: toastPresenter
                )
                connectedHeroCard
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.top, MWSpacing.xl)
            .frame(maxWidth: layout.contentMaxWidth)
            .frame(maxWidth: .infinity)
        }
        .background(MWPatternedBackdrop())
    }

    private var connectedHeroCard: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                HStack(spacing: MWSpacing.sm) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(MWTypography.title2().weight(.regular))
                        .foregroundColor(MWColors.statusSuccess)

                    Text(String(localized: "sessions.desktopConnected"))
                        .font(.title2.weight(.semibold))
                        .foregroundColor(theme.accentOnAccent)
                }

                Text(String(localized: "sessions.waitingSync"))
                    .font(.callout)
                    .foregroundColor(theme.accentOnAccent.opacity(0.85))
            }

            #if canImport(ActivityKit)
            Button {
                MiHaptics.lightImpact()
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
                HStack(spacing: MWSpacing.sm) {
                    if syncManager.isSyncing {
                        ProgressView()
                            .scaleEffect(0.8)
                        Text(syncManager.syncPhase.displayTitle)
                            .font(.body.weight(.medium))
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(MWTypography.callout().weight(.medium))
                        Text(String(localized: "sessions.syncNow"))
                            .font(.body.weight(.medium))
                    }
                    Spacer()
                }
                .foregroundColor(theme.accentPrimary)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.vertical, MWSpacing.md)
                .background(
                    Capsule()
                        .fill(MWColors.accentOnAccent)
                )
            }
            .disabled(syncManager.isSyncing && syncManager.syncPhase == .preparing)
            #else
            Button {
                MiHaptics.lightImpact()
                Task { await loadRuns() }
            } label: {
                HStack(spacing: MWSpacing.sm) {
                    Image(systemName: "arrow.clockwise")
                        .font(MWTypography.callout().weight(.medium))
                    Text(String(localized: "sessions.syncNow"))
                        .font(.body.weight(.medium))
                    Spacer()
                }
                .foregroundColor(theme.accentPrimary)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.vertical, MWSpacing.md)
                .background(
                    Capsule()
                        .fill(MWColors.accentOnAccent)
                )
            }
            #endif

            if let conn = store.activeConnection {
                HStack(spacing: MWSpacing.xs) {
                    Image(systemName: "desktopcomputer")
                        .font(MWTypography.caption2())
                    Text(conn.host)
                        .font(.caption)
                }
                .foregroundColor(theme.accentOnAccent.opacity(0.7))
            }
        }
        .padding(MWSpacing.lg)
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
        .clipShape(RoundedRectangle(cornerRadius: MWRadius.bubble))
    }

    // MARK: - Status Hints

    private var statusHint: some View {
        VStack(spacing: MWSpacing.xs) {
            Text(String(localized: "sessions.noDesktop"))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.cardTextSecondary)
            Text(String(localized: "sessions.startDesktop"))
                .font(.caption)
                .foregroundStyle(theme.cardTextTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, MWSpacing.md)
        .padding(.horizontal, MWSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.lg)
                .fill(MWColors.cardBg)
        )
    }

    private var connectedStatusHint: some View {
        VStack(spacing: MWSpacing.xs) {
            Text(String(localized: "sessions.noSessions"))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.cardTextSecondary)
            Text(String(localized: "sessions.startSession"))
                .font(.caption)
                .foregroundStyle(theme.cardTextTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, MWSpacing.md)
        .padding(.horizontal, MWSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.lg)
                .fill(MWColors.cardBg)
        )
    }

    // MARK: - Helper

    private func heroPill(icon: String, label: String) -> some View {
        HStack(spacing: MWSpacing.xs) {
            Image(systemName: icon)
                .font(MWTypography.caption2().weight(.medium))
            Text(label)
                .font(.caption)
        }
        .foregroundColor(theme.accentOnAccent.opacity(0.9))
        .padding(.horizontal, MWSpacing.sm)
        .padding(.vertical, MWSpacing.xs)
        .background(
            Capsule()
                .fill(theme.accentOnAccent.opacity(0.2))
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
                HStack(spacing: MWSpacing.sm) {
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
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .opacity))
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if run.status == .running {
                                Button(role: .destructive) {
                                    MiHaptics.lightImpact()
                                    // stop action
                                } label: {
                                    Label(String(localized: "action.stop"), systemImage: "stop.fill")
                                }
                            }
                            Button {
                                MiHaptics.lightImpact()
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
        .animation(MWMotion.springStandard, value: filteredRuns.map(\.id))
        .frame(maxWidth: navigationMode == .push ? layout.contentMaxWidth : .infinity)
        .frame(maxWidth: .infinity)
        .navigationDestination(for: MiWarpRun.self) { run in
            ChatView(runId: run.id, runTitle: run.displayTitle)
        }
    }

    @ViewBuilder
    private func sessionRow(for run: MiWarpRun, navigationMode: SessionNavigationMode) -> some View {
        let rowLabel = String(format: String(localized: "a11y.sessionRow"), run.displayTitle)
        switch navigationMode {
        case .push:
            NavigationLink(value: run) {
                SessionRowView(run: run)
            }
            .accessibilityLabel(rowLabel)
        case .selection:
            Button {
                selectRun(run)
            } label: {
                SessionRowView(run: run)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(rowLabel)
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
                error = String(localized: "connection.noActive")
            }
            return
        }

        withAnimation(MWMotion.springStandard) {
            isLoading = true
            error = nil
        }

        do {
            let loaded = try await rpc.listRuns()
            withAnimation(MWMotion.springStandard) {
                runs = loaded
                isLoading = false
            }
            MiHaptics.success()
            SpotlightIndexer.indexSessions(loaded)

            // Resolve any pending Spotlight session after load
            if let pendingId = pendingSpotlightSessionId,
               let run = loaded.first(where: { $0.id == pendingId }) {
                pendingSpotlightSessionId = nil
                selectRun(run)
            }
        } catch {
            withAnimation(MWMotion.springStandard) {
                self.error = error.localizedDescription
                isLoading = false
            }
        }
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
        HStack(alignment: .top, spacing: MWSpacing.lg) {
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
            .padding(.top, MWSpacing.sm)

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
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(run.displayTitle), \(String(localized: "a11y.status")): \(run.status)")
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
