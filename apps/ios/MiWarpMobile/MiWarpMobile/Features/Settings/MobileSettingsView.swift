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
        MWAdaptiveReader { layout in
            content(layout: layout)
        }
    }

    private func content(layout: MWAdaptiveLayout) -> some View {
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
            .frame(maxWidth: layout.settingsContentMaxWidth)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - General

    private var generalSection: some View {
        Section {
            Picker(selection: $theme.appearanceMode) {
                ForEach(MWAppearanceMode.allCases) { mode in
                    Label(mode.displayName, systemImage: mode.systemImage)
                        .foregroundStyle(theme.cardTextPrimary)
                        .tag(mode)
                }
            } label: {
                Label(String(localized: "settings.appearance"), systemImage: theme.appearanceMode.systemImage)
                    .foregroundStyle(theme.accentPrimary)
            }

            accentThemePicker
        } header: {
            Label(String(localized: "settings.general"), systemImage: "gearshape.fill")
                .foregroundStyle(theme.cardTextSecondary)
        }
        .listRowBackground(theme.cardBg)
    }

    private var accentThemePicker: some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            Label(String(localized: "settings.accentTheme"), systemImage: "swatchpalette")
                .font(.body)

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: MWSpacing.sm),
                    GridItem(.flexible(), spacing: MWSpacing.sm),
                    GridItem(.flexible(), spacing: MWSpacing.sm)
                ],
                spacing: MWSpacing.sm
            ) {
                ForEach(MWAccentTheme.allCases.prefix(6)) { accent in
                    accentSwatchButton(accent)
                }
            }
        }
        .padding(.vertical, MWSpacing.xs)
    }

    private func accentSwatchButton(_ accent: MWAccentTheme) -> some View {
        let isSelected = theme.accentTheme == accent
        return Button {
            withAnimation(MWMotion.springBouncy) {
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
                            .foregroundColor(theme.cardTextPrimary)
                            .shadow(color: .black.opacity(0.4), radius: 2, x: 0, y: 1)
                            .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: MWRadius.sm))
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.sm)
                        .strokeBorder(isSelected ? MWColors.accentOnAccent.opacity(0.6) : Color.clear, lineWidth: 2)
                        .animation(MWMotion.springBouncy, value: isSelected)
                )
                .scaleEffect(isSelected ? 1.05 : 1.0)
                .animation(MWMotion.springBouncy, value: isSelected)

                Text(accent.displayName)
                    .font(.system(size: 10))
                    .foregroundColor(theme.cardTextSecondary)
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
                        .foregroundStyle(theme.cardTextSecondary)
                } label: {
                    Label(connection.name, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(MWColors.statusSuccess)
                }

                Button(role: .destructive) {
                    MiHaptics.lightImpact()
                    store.disconnect()
                } label: {
                    Label(String(localized: "action.disconnect"), systemImage: "xmark.circle")
                        .foregroundStyle(theme.cardTextPrimary)
                }

                Button {
                    MiHaptics.lightImpact()
                    store.reconnect()
                } label: {
                    Label(String(localized: "action.reconnect"), systemImage: "arrow.clockwise")
                        .foregroundStyle(theme.cardTextPrimary)
                }
            } else {
                Label(String(localized: "connection.noActive"), systemImage: "wifi.slash")
                    .foregroundStyle(theme.cardTextTertiary)

                Button {
                    MiHaptics.lightImpact()
                    store.connectToDefault()
                } label: {
                    Label(String(localized: "action.connect"), systemImage: "play.circle")
                        .foregroundStyle(theme.accentPrimary)
                }
            }
        } header: {
            Label(String(localized: "settings.connection"), systemImage: "network")
                .foregroundStyle(theme.cardTextSecondary)
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - Sessions

    private var sessionsSection: some View {
        Section {
            Label(String(localized: "settings.sessionsAutoSync"), systemImage: "info.circle")
                .foregroundStyle(theme.cardTextSecondary)

            Button(role: .destructive) {
                MiHaptics.lightImpact()
                // Clear session history
            } label: {
                Label(String(localized: "settings.clearSessionHistory"), systemImage: "trash")
                    .foregroundStyle(theme.cardTextPrimary)
            }
        } header: {
            Label(String(localized: "settings.sessions"), systemImage: "bubble.left.and.bubble.right.fill")
                .foregroundStyle(theme.cardTextSecondary)
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - AI & Models

    private var aiModelsSection: some View {
        Section {
            LabeledContent(String(localized: "settings.defaultMode")) {
                Text(String(localized: "settings.defaultFocus"))
                    .font(.caption.monospaced())
                    .foregroundStyle(theme.cardTextSecondary)
            }
        } header: {
            Label(String(localized: "settings.aiModels"), systemImage: "cpu")
                .foregroundStyle(theme.cardTextSecondary)
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
                    .foregroundStyle(theme.cardTextPrimary)
            }

            Button {
                MiHaptics.lightImpact()
                copyDebugInfo()
            } label: {
                Label(String(localized: "settings.copyDebugInfo"), systemImage: "doc.on.doc")
                    .foregroundStyle(theme.cardTextPrimary)
            }

            #if canImport(ActivityKit)
            NavigationLink {
                LiveActivityDemoView()
            } label: {
                Label(String(localized: "settings.liveActivityDemo"), systemImage: "livephoto")
                    .foregroundStyle(theme.cardTextPrimary)
            }
            #endif

            Button {
                showComponentLab = true
            } label: {
                Label(String(localized: "settings.componentLab"), systemImage: "square.3.layers.3d")
                    .foregroundStyle(theme.cardTextPrimary)
            }

            Button(role: .destructive) {
                MiHaptics.lightImpact()
                showClearTokensConfirm = true
            } label: {
                Label(String(localized: "settings.clearTokens"), systemImage: "key")
                    .foregroundStyle(theme.cardTextPrimary)
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
                        .foregroundStyle(theme.cardTextPrimary)
                    Spacer()
                    Text("v\(appVersion)")
                        .font(.caption.monospaced())
                        .foregroundStyle(theme.cardTextTertiary)
                }
            }
        } header: {
            Label(String(localized: "settings.advanced"), systemImage: "slider.horizontal.3")
                .foregroundStyle(theme.cardTextSecondary)
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
    @EnvironmentObject private var theme: MWTheme
    let logger = MiWarpLogger.shared

    var body: some View {
        NavigationStack {
            List(logger.recentLogs) { entry in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(entry.timestamp, style: .time)
                            .font(.caption.monospaced())
                            .foregroundStyle(theme.cardTextTertiary)
                        Text("[\(entry.category)]")
                            .font(.caption.monospaced())
                            .foregroundStyle(theme.cardTextSecondary)
                        Spacer()
                        Text(entry.level.rawValue.uppercased())
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(logLevelColor(entry.level))
                    }
                    Text(entry.message)
                        .font(.caption.monospaced())
                        .foregroundStyle(theme.cardTextSecondary)
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
        case .debug: return theme.cardTextSecondary
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
            VStack(spacing: MWSpacing.xxxl) {
                Spacer()

                ZStack {
                    Circle()
                        .fill(theme.accentPrimary.opacity(0.08))
                        .frame(width: 88, height: 88)
                    Image(systemName: "cpu")
                        .font(.system(size: 40))
                        .foregroundStyle(theme.accentPrimary, theme.accentSecondary)
                }

                VStack(spacing: MWSpacing.sm) {
                    Text(String(localized: "about.appName"))
                        .font(.title2.weight(.semibold))
                    Text(String(format: String(localized: "about.version"), Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"))
                        .font(.caption)
                        .foregroundStyle(theme.cardTextTertiary)
                }

                Text(String(localized: "about.description"))
                    .font(.callout)
                    .foregroundStyle(theme.cardTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, MWSpacing.xxxl)

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
    @EnvironmentObject private var theme: MWTheme
    @State private var ringProgress: Double = 0.65

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: MWSpacing.xxl) {
                    // MWTaskProgressRing
                    componentSection(title: "MWTaskProgressRing") {
                        HStack(spacing: MWSpacing.xl) {
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
                        VStack(spacing: MWSpacing.md) {
                            HStack(spacing: MWSpacing.xl) {
                                Text(String(localized: "component.small"))
                                    .font(.caption)
                                    .foregroundStyle(theme.cardTextSecondary)
                                MWThinkingIndicator(size: .small)
                            }
                            HStack(spacing: MWSpacing.xl) {
                                Text(String(localized: "component.medium"))
                                    .font(.caption)
                                    .foregroundStyle(theme.cardTextSecondary)
                                MWThinkingIndicator(size: .medium)
                            }
                        }
                    }

                    // MWStatusBadge
                    componentSection(title: "MWStatusBadge") {
                        VStack(spacing: MWSpacing.sm) {
                            HStack(spacing: MWSpacing.sm) {
                                MWStatusBadge(text: "Running", style: .info)
                                MWStatusBadge(text: "Completed", style: .success)
                                MWStatusBadge(text: "Warning", style: .warning)
                            }
                            HStack(spacing: MWSpacing.sm) {
                                MWStatusBadge(text: "Failed", style: .error)
                                MWStatusBadge(text: "Idle", style: .neutral)
                            }
                        }
                    }

                    // MWStatusDot
                    componentSection(title: "MWStatusDot") {
                        HStack(spacing: MWSpacing.lg) {
                            VStack(spacing: MWSpacing.sm) {
                                MWStatusDot(status: .connected)
                                Text(String(localized: "connection.connected"))
                                    .font(.caption2)
                                    .foregroundStyle(theme.cardTextSecondary)
                            }
                            VStack(spacing: MWSpacing.sm) {
                                MWStatusDot(status: .running, showGlow: true)
                                Text(String(localized: "runStatus.running"))
                                    .font(.caption2)
                                    .foregroundStyle(theme.cardTextSecondary)
                            }
                            VStack(spacing: MWSpacing.sm) {
                                MWStatusDot(status: .syncing)
                                Text("syncing")
                                    .font(.caption2)
                                    .foregroundStyle(theme.cardTextSecondary)
                            }
                            VStack(spacing: MWSpacing.sm) {
                                MWStatusDot(status: .failed)
                                Text(String(localized: "runStatus.failed"))
                                    .font(.caption2)
                                    .foregroundStyle(theme.cardTextSecondary)
                            }
                            VStack(spacing: MWSpacing.sm) {
                                MWStatusDot(status: .waiting)
                                Text(String(localized: "runStatus.waitingApproval"))
                                    .font(.caption2)
                                    .foregroundStyle(theme.cardTextSecondary)
                            }
                            VStack(spacing: MWSpacing.sm) {
                                MWStatusDot(status: .localOnly)
                                Text("localOnly")
                                    .font(.caption2)
                                    .foregroundStyle(theme.cardTextSecondary)
                            }
                        }
                    }

                    // MWStatusBadge with RunStatus
                    componentSection(title: "MWStatusBadge (RunStatus)") {
                        LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: MWSpacing.sm) {
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
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            Text(title)
                .font(.headline)
                .foregroundStyle(theme.accentPrimary)

            content()
                .frame(maxWidth: .infinity)
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: MWRadius.card)
                .fill(theme.cardBg)
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.card)
                        .strokeBorder(theme.divider, lineWidth: 0.5)
                )
        )
    }
}
