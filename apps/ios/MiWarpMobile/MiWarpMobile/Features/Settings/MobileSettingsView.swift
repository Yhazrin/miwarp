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

    var body: some View {
        NavigationStack {
            Form {
                generalSection
                connectionSection
                sessionsSection
                aiModelsSection
                advancedSection
            }
            .navigationTitle("Settings")
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
                Label("Appearance", systemImage: theme.appearanceMode.systemImage)
            }

            accentThemePicker
        } header: {
            Label("General", systemImage: "gearshape.fill")
        }
        .listRowBackground(theme.cardBg)
    }

    private var accentThemePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Accent Theme", systemImage: "swatchpalette")
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
            withAnimation(.easeInOut(duration: 0.18)) {
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
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))

                Text(accent.displayName)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
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
                    Label("Disconnect", systemImage: "xmark.circle")
                }

                Button {
                    store.reconnect()
                } label: {
                    Label("Reconnect", systemImage: "arrow.clockwise")
                }
            } else {
                Label("No active connection", systemImage: "wifi.slash")
                    .foregroundStyle(.tertiary)

                Button {
                    store.connectToDefault()
                } label: {
                    Label("Connect", systemImage: "play.circle")
                        .foregroundStyle(theme.accentPrimary)
                }
            }
        } header: {
            Label("Connection", systemImage: "network")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - Sessions

    private var sessionsSection: some View {
        Section {
            Label("Sessions sync automatically", systemImage: "info.circle")
                .foregroundStyle(.secondary)

            Button(role: .destructive) {
                // Clear session history
            } label: {
                Label("Clear Session History", systemImage: "trash")
            }
        } header: {
            Label("Sessions", systemImage: "bubble.left.and.bubble.right.fill")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - AI & Models

    private var aiModelsSection: some View {
        Section {
            LabeledContent("Default Mode") {
                Text("Focus")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
        } header: {
            Label("AI & Models", systemImage: "cpu")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - Advanced

    private var advancedSection: some View {
        Section {
            Button {
                showLogs = true
            } label: {
                Label("View Logs", systemImage: "doc.text")
            }

            Button {
                copyDebugInfo()
            } label: {
                Label("Copy Debug Info", systemImage: "doc.on.doc")
            }

            #if canImport(ActivityKit)
            NavigationLink {
                LiveActivityDemoView()
            } label: {
                Label("Live Activity Demo", systemImage: "livephoto")
            }
            #endif

            Button {
                showComponentLab = true
            } label: {
                Label("Component Lab", systemImage: "square.3.layers.3d")
            }

            Button(role: .destructive) {
                clearTokens()
            } label: {
                Label("Clear Saved Tokens", systemImage: "key")
            }

            Button {
                showAbout = true
            } label: {
                HStack {
                    Label("About MiWarp Mobile", systemImage: "info.circle")
                    Spacer()
                    Text("v1.0.0")
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                }
            }
        } header: {
            Label("Advanced", systemImage: "slider.horizontal.3")
        }
        .listRowBackground(theme.cardBg)
    }

    // MARK: - Helpers

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
            .navigationTitle("Logs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Clear") { logger.clearLogs() }
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
                    Text("MiWarp Mobile")
                        .font(.title2.weight(.semibold))
                    Text("Version 1.0.0")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                Text("Local-first Agent Session Control Center.\nConnect, monitor, and interact with your AI coding sessions from anywhere on your network.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 32)

                Spacer()
            }
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
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
                                Text("Small")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                MWThinkingIndicator(size: .small)
                            }
                            HStack(spacing: 20) {
                                Text("Medium")
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
                                Text("connected")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(spacing: 8) {
                                MWStatusDot(status: .running, showGlow: true)
                                Text("running")
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
                                Text("failed")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(spacing: 8) {
                                MWStatusDot(status: .waiting)
                                Text("waiting")
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
            .navigationTitle("Component Lab")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
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
