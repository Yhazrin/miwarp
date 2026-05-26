import SwiftUI

// MARK: - Diagonal Clash Shape for swatch buttons

/// Top-left triangle (primary color)
struct TopLeftTriangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// Bottom-right triangle (secondary color)
struct BottomRightTriangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

struct MobileSettingsView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var showLogs = false
    @State private var showAbout = false
    @State private var showComponentLab = false
    @State private var showClearTokensConfirm = false

    var body: some View {
        NavigationStack {
            Form {
                generalSection
                connectionSection
                sessionsSection
                aiModelsSection
                advancedSection
            }
            .navigationTitle(String(localized: "settings.title"))
            .sheet(isPresented: $showLogs) {
                LogsView()
            }
            .sheet(isPresented: $showAbout) {
                AboutView()
            }
            .sheet(isPresented: $showComponentLab) {
                ComponentLabView()
            }
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
        }
    }

    // MARK: - General

    private var generalSection: some View {
        Section {
            Picker(selection: $theme.appearanceMode) {
                ForEach(MWAppearanceMode.allCases) { mode in
                    Label(mode.displayName, systemImage: mode.systemImage)
                        .tag(mode)
                }
            } label: {
                Label(String(localized: "settings.appearance"), systemImage: theme.appearanceMode.systemImage)
            }

            accentThemePicker
        } header: {
            Label(String(localized: "settings.general"), systemImage: "gearshape.fill")
        }
        .listRowBackground(theme.cardBg)
    }

    private var accentThemePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(String(localized: "settings.accentTheme"), systemImage: "swatchpalette")
                .font(.body)

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 6),
                    GridItem(.flexible(), spacing: 6),
                    GridItem(.flexible(), spacing: 6)
                ],
                spacing: 6
            ) {
                ForEach(MWAccentTheme.allCases.prefix(6)) { accent in
                    accentSwatchButton(accent)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func accentSwatchButton(_ accent: MWAccentTheme) -> some View {
        let isSelected = theme.accentTheme == accent
        return Button {
            withAnimation(.spring(duration: 0.35, bounce: 0.35)) {
                theme.accentTheme = accent
            }
        } label: {
            VStack(spacing: 3) {
                ZStack {
                    // Top-left triangle: primary color (clash!)
                    TopLeftTriangle()
                        .fill(Color(accent.primarySwatch))
                    // Bottom-right triangle: secondary color
                    BottomRightTriangle()
                        .fill(Color(accent.secondarySwatch))

                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.caption.bold())
                            .foregroundColor(.white)
                            .shadow(color: .black.opacity(0.4), radius: 2, x: 0, y: 1)
                            .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(isSelected ? Color.white.opacity(0.6) : Color.clear, lineWidth: 2)
                        .animation(.spring(duration: 0.3, bounce: 0.3), value: isSelected)
                )
                .scaleEffect(isSelected ? 1.05 : 1.0)
                .animation(.spring(duration: 0.3, bounce: 0.4), value: isSelected)

                Text(accent.displayName)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: isSelected)
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section {
            if let connection = store.activeConnection, store.isConnected {
                LabeledContent {
                    Text(connection.host)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                } label: {
                    Label(connection.name, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(MWColors.statusSuccess)
                }

                Button(role: .destructive) {
                    store.disconnect()
                } label: {
                    Label(String(localized: "action.disconnect"), systemImage: "xmark.circle")
                }

                Button {
                    store.reconnect()
                } label: {
                    Label(String(localized: "action.reconnect"), systemImage: "arrow.clockwise")
                }
            } else {
                Label(String(localized: "connection.noActive"), systemImage: "wifi.slash")
                    .foregroundStyle(.tertiary)

                Button {
                    store.connectToDefault()
                } label: {
                    Label(String(localized: "action.connect"), systemImage: "play.circle")
                        .foregroundStyle(theme.accentPrimary)
                }
            }
        } header: {
            Label(String(localized: "settings.connection"), systemImage: "network")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - Sessions

    private var sessionsSection: some View {
        Section {
            Label(String(localized: "settings.sessionsAutoSync"), systemImage: "info.circle")
                .foregroundStyle(.secondary)

            Button(role: .destructive) {
                // Clear session history
            } label: {
                Label(String(localized: "settings.clearSessionHistory"), systemImage: "trash")
            }
        } header: {
            Label(String(localized: "settings.sessions"), systemImage: "bubble.left.and.bubble.right.fill")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - AI & Models

    private var aiModelsSection: some View {
        Section {
            LabeledContent(String(localized: "settings.defaultMode")) {
                Text(String(localized: "settings.defaultFocus"))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
        } header: {
            Label(String(localized: "settings.aiModels"), systemImage: "cpu")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - Advanced

    private var advancedSection: some View {
        Section {
            Button {
                showLogs = true
            } label: {
                Label(String(localized: "settings.viewLogs"), systemImage: "doc.text")
            }

            Button {
                copyDebugInfo()
            } label: {
                Label(String(localized: "settings.copyDebugInfo"), systemImage: "doc.on.doc")
            }

            #if canImport(ActivityKit)
            NavigationLink {
                LiveActivityDemoView()
            } label: {
                Label(String(localized: "settings.liveActivityDemo"), systemImage: "livephoto")
            }
            #endif

            Button {
                showComponentLab = true
            } label: {
                Label(String(localized: "settings.componentLab"), systemImage: "square.3.layers.3d")
            }

            Button(role: .destructive) {
                showClearTokensConfirm = true
            } label: {
                Label(String(localized: "settings.clearTokens"), systemImage: "key")
            }
            .confirmationDialog(String(localized: "settings.clearTokensConfirm"), isPresented: $showClearTokensConfirm, titleVisibility: .visible) {
                Button(String(localized: "settings.removeAll"), role: .destructive) { clearTokens() }
                Button(String(localized: "action.cancel"), role: .cancel) {}
            }

            Button {
                showAbout = true
            } label: {
                HStack {
                    Label(String(localized: "settings.about"), systemImage: "info.circle")
                    Spacer()
                    Text("v\(appVersion)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                }
            }
        } header: {
            Label(String(localized: "settings.advanced"), systemImage: "slider.horizontal.3")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - Helpers

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private func copyDebugInfo() {
        let info = """
        MiWarp Mobile Debug Info
        Connected: \(store.isConnected)
        Connection: \(store.activeConnection?.name ?? "none")
        State: \(store.connectionState.displayLabel)
        Appearance: \(theme.appearanceMode.displayName)
        Accent Theme: \(theme.accentTheme.displayName)
        Texture: \(theme.textureStrength.displayName)
        """
        #if os(iOS)
        UIPasteboard.general.string = info
        #endif
    }

    private func clearTokens() {
        store.disconnect()
        for connection in store.connections {
            store.removeConnection(connection)
        }
    }
}

// MARK: - Logs View

struct LogsView: View {
    @Environment(\.dismiss) private var dismiss
    let logger = MiWarpLogger.shared

    var body: some View {
        NavigationStack {
            List(logger.recentLogs) { entry in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(entry.timestamp, style: .time)
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                        Text("[\(entry.category)]")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(entry.level.rawValue.uppercased())
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(logLevelColor(entry.level))
                    }
                    Text(entry.message)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 2)
            }
            .listStyle(.plain)
            .navigationTitle(String(localized: "settings.logs"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "action.done")) { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(String(localized: "action.clear")) { logger.clearLogs() }
                        .foregroundStyle(MWColors.statusError)
                }
            }
        }
    }

    private func logLevelColor(_ level: MiWarpLogger.LogLevel) -> Color {
        switch level {
        case .debug: return .secondary
        case .info: return MWColors.accentPrimary
        case .warning: return MWColors.statusWarning
        case .error: return MWColors.statusError
        }
    }
}

// MARK: - About View

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()

                ZStack {
                    Circle()
                        .fill(theme.accentPrimary.opacity(0.08))
                        .frame(width: 88, height: 88)
                    Image(systemName: "cpu")
                        .font(.system(size: 40))
                        .foregroundStyle(theme.accentPrimary, theme.accentSecondary)
                }

                VStack(spacing: 6) {
                    Text(String(localized: "about.appName"))
                        .font(.title2.weight(.semibold))
                    Text(String(format: String(localized: "about.version"), Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                Text(String(localized: "about.description"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 32)

                Spacer()
            }
            .navigationTitle(String(localized: "settings.about"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "action.done")) { dismiss() }
                }
            }
        }
    }
}

// MARK: - Component Lab

struct ComponentLabView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var ringProgress: Double = 0.65

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // MWTaskProgressRing
                    componentSection(title: "MWTaskProgressRing") {
                        HStack(spacing: 20) {
                            MWTaskProgressRing(progress: ringProgress, state: .running, size: 50)
                            MWTaskProgressRing(progress: ringProgress, state: .waiting, size: 50)
                            MWTaskProgressRing(progress: 1.0, state: .completed, size: 50)
                            MWTaskProgressRing(progress: 0.4, state: .failed, size: 50)
                        }
                        Slider(value: $ringProgress, in: 0...1)
                            .padding(.horizontal)
                    }

                    // MWThinkingIndicator
                    componentSection(title: "MWThinkingIndicator") {
                        VStack(spacing: 12) {
                            HStack(spacing: 20) {
                                Text(String(localized: "component.small"))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                MWThinkingIndicator(size: .small)
                            }
                            HStack(spacing: 20) {
                                Text(String(localized: "component.medium"))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                MWThinkingIndicator(size: .medium)
                            }
                        }
                    }

                    // MWStatusBadge
                    componentSection(title: "MWStatusBadge") {
                        VStack(spacing: 8) {
                            HStack(spacing: 8) {
                                MWStatusBadge(text: "Running", style: .info)
                                MWStatusBadge(text: "Completed", style: .success)
                                MWStatusBadge(text: "Warning", style: .warning)
                            }
                            HStack(spacing: 8) {
                                MWStatusBadge(text: "Failed", style: .error)
                                MWStatusBadge(text: "Idle", style: .neutral)
                            }
                        }
                    }

                    // MWStatusDot
                    componentSection(title: "MWStatusDot") {
                        HStack(spacing: 16) {
                            VStack(spacing: 8) {
                                MWStatusDot(status: .connected)
                                Text(String(localized: "connection.connected"))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(spacing: 8) {
                                MWStatusDot(status: .running, showGlow: true)
                                Text(String(localized: "runStatus.running"))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(spacing: 8) {
                                MWStatusDot(status: .syncing)
                                Text("syncing")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(spacing: 8) {
                                MWStatusDot(status: .failed)
                                Text(String(localized: "runStatus.failed"))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(spacing: 8) {
                                MWStatusDot(status: .waiting)
                                Text(String(localized: "runStatus.waitingApproval"))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(spacing: 8) {
                                MWStatusDot(status: .localOnly)
                                Text("localOnly")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    // MWStatusBadge with RunStatus
                    componentSection(title: "MWStatusBadge (RunStatus)") {
                        LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 8) {
                            ForEach(RunStatus.allCases, id: \.self) { status in
                                HStack {
                                    MWStatusBadge(status: status)
                                    Spacer()
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle(String(localized: "settings.componentLab"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "action.done")) { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func componentSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .foregroundStyle(MWColors.accentPrimary)

            content()
                .frame(maxWidth: .infinity)
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(MWColors.cardBg)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(MWColors.divider, lineWidth: 0.5)
                )
        )
    }
}
