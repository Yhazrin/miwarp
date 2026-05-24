import SwiftUI

struct MobileSettingsView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var showLogs = false
    @State private var showAbout = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: MWSpacing.lg) {
                    // Connection
                    connectionSection

                    // Appearance
                    appearanceSection

                    // Diagnostics
                    diagnosticsSection

                    // Security
                    securitySection

                    // About
                    aboutSection
                }
                .padding(.vertical, MWSpacing.lg)
            }
            .background(theme.bgDeepest)
            .navigationTitle("Settings")
            .sheet(isPresented: $showLogs) {
                LogsView()
            }
            .sheet(isPresented: $showAbout) {
                AboutView()
            }
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        settingsSection(title: "Connection", icon: "network") {
            if let connection = store.activeConnection {
                settingsRow(icon: "desktopcomputer", label: "Server", value: "\(connection.host):\(connection.port)")
                settingsRow(icon: "circle.fill", label: "Status", value: store.connectionState.displayLabel, valueColor: statusColor)

                if store.isConnected {
                    settingsRow(icon: "timer", label: "Latency", value: "—")
                }
            } else {
                HStack {
                    Image(systemName: "wifi.slash")
                        .foregroundColor(MWColors.textTertiary)
                    Text("No active connection")
                        .font(MWTypography.callout())
                        .foregroundColor(MWColors.textTertiary)
                }
                .padding(.vertical, MWSpacing.xs)
            }

            Divider()
                .background(theme.divider)

            HStack(spacing: MWSpacing.md) {
                Button {
                    if store.isConnected {
                        store.disconnect()
                    } else {
                        store.connectToDefault()
                    }
                } label: {
                    Label(
                        store.isConnected ? "Disconnect" : "Connect",
                        systemImage: store.isConnected ? "xmark.circle" : "play.circle"
                    )
                    .font(MWTypography.subheadlineMedium())
                    .foregroundColor(store.isConnected ? MWColors.statusError : MWColors.accentPrimary)
                }
                .buttonStyle(.plain)

                if store.isConnected {
                    Button {
                        store.reconnect()
                    } label: {
                        Label("Reconnect", systemImage: "arrow.clockwise")
                            .font(MWTypography.subheadlineMedium())
                            .foregroundColor(MWColors.textSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var statusColor: Color {
        switch store.connectionState {
        case .connected: return MWColors.statusSuccess
        case .connecting, .reconnecting: return MWColors.statusPending
        case .authFailed, .serverUnavailable: return MWColors.statusError
        default: return MWColors.textTertiary
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            Label("Appearance", systemImage: "paintbrush")
                .font(MWTypography.subheadlineMedium())
                .foregroundColor(theme.textSecondary)
                .padding(.horizontal, MWSpacing.lg)

            MWGlassCard {
                VStack(alignment: .leading, spacing: MWSpacing.lg) {
                    settingsSegmentedPicker(
                        icon: theme.appearanceMode.systemImage,
                        title: "Appearance",
                        selection: $theme.appearanceMode,
                        values: MWAppearanceMode.allCases
                    ) { $0.displayName }

                    Divider()
                        .background(theme.divider)

                    settingsSegmentedPicker(
                        icon: "square.grid.3x3.middle.filled",
                        title: "Texture",
                        selection: $theme.textureStrength,
                        values: MWTextureStrength.allCases
                    ) { $0.displayName }
                }
            }
            .padding(.horizontal, MWSpacing.lg)

            VStack(alignment: .leading, spacing: MWSpacing.md) {
                Label("Accent Theme", systemImage: "swatchpalette")
                    .font(MWTypography.subheadlineMedium())
                    .foregroundColor(theme.textSecondary)

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: MWSpacing.md),
                        GridItem(.flexible(), spacing: MWSpacing.md)
                    ],
                    spacing: MWSpacing.md
                ) {
                    ForEach(MWAccentTheme.allCases) { accent in
                        MWAccentThemePreviewCard(accentTheme: accent)
                    }
                }
            }
            .padding(.horizontal, MWSpacing.lg)
        }
    }

    // MARK: - Diagnostics

    private var diagnosticsSection: some View {
        settingsSection(title: "Diagnostics", icon: "stethoscope") {
            settingsButton(icon: "doc.text", label: "View Logs") {
                showLogs = true
            }

            Divider()
                .background(theme.divider)

            settingsButton(icon: "doc.on.doc", label: "Copy Debug Info") {
                copyDebugInfo()
            }
        }
    }

    // MARK: - Security

    private var securitySection: some View {
        settingsSection(title: "Security", icon: "lock.shield") {
            settingsButton(icon: "key", label: "Clear Saved Tokens", destructive: true) {
                clearTokens()
            }
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        settingsSection(title: "About", icon: "info.circle") {
            settingsButton(icon: "info.circle", label: "About MiWarp Mobile") {
                showAbout = true
            }
        }
    }

    // MARK: - Helpers

    private func settingsSection<Content: View>(title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            Label(title, systemImage: icon)
                .font(MWTypography.subheadlineMedium())
                .foregroundColor(MWColors.textSecondary)
                .padding(.horizontal, MWSpacing.lg)

            MWGlassCard {
                VStack(alignment: .leading, spacing: MWSpacing.md) {
                    content()
                }
            }
        }
        .padding(.horizontal, MWSpacing.lg)
    }

    private func settingsRow(icon: String, label: String, value: String, valueColor: Color? = nil) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(MWColors.accentCyan)
                .frame(width: 24)
            Text(label)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textPrimary)
            Spacer()
            Text(value)
                .font(MWTypography.monoCaption())
                .foregroundColor(valueColor ?? MWColors.textSecondary)
        }
    }

    private func settingsSegmentedPicker<Value: Hashable>(
        icon: String,
        title: String,
        selection: Binding<Value>,
        values: [Value],
        label: @escaping (Value) -> String
    ) -> some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            HStack(spacing: MWSpacing.sm) {
                Image(systemName: icon)
                    .foregroundColor(theme.accentSecondary)
                    .frame(width: 24)
                Text(title)
                    .font(MWTypography.callout())
                    .foregroundColor(theme.textPrimary)
            }

            Picker(title, selection: selection) {
                ForEach(values, id: \.self) { value in
                    Text(label(value)).tag(value)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private func settingsButton(icon: String, label: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(destructive ? MWColors.statusError : MWColors.accentCyan)
                    .frame(width: 24)
                Text(label)
                    .font(MWTypography.callout())
                    .foregroundColor(destructive ? MWColors.statusError : MWColors.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundColor(MWColors.textTertiary)
            }
        }
        .buttonStyle(.plain)
    }

    private func copyDebugInfo() {
        let info = """
        MiWarp Mobile Debug Info
        Connected: \(store.isConnected)
        Connection: \(store.activeConnection?.name ?? "none")
        State: \(store.connectionState.displayLabel)
        Appearance: \(theme.appearanceMode.displayName)
        Effective Scheme: \(theme.effectiveColorScheme == .dark ? "dark" : "light")
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

// MARK: - Theme Preview

private struct MWAccentThemePreviewCard: View {
    @EnvironmentObject private var theme: MWTheme
    let accentTheme: MWAccentTheme

    private var isSelected: Bool {
        theme.accentTheme == accentTheme
    }

    private var tokens: MWThemeTokens {
        MWColors.tokens(for: accentTheme, scheme: theme.effectiveColorScheme)
    }

    var body: some View {
        Button {
            withAnimation(.easeInOut(duration: MWMotion.normal)) {
                theme.accentTheme = accentTheme
            }
        } label: {
            VStack(alignment: .leading, spacing: MWSpacing.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        Text(accentTheme.displayName)
                            .font(MWTypography.caption())
                            .foregroundColor(tokens.textPrimary)
                            .lineLimit(2)

                        HStack(spacing: MWSpacing.xs) {
                            Circle()
                                .fill(accentTheme.primarySwatch)
                                .frame(width: 12, height: 12)
                            Circle()
                                .fill(accentTheme.secondarySwatch)
                                .frame(width: 12, height: 12)
                        }
                    }

                    Spacer()

                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.caption)
                        .foregroundColor(isSelected ? tokens.accentPrimary : tokens.textTertiary)
                }

                ZStack(alignment: .topLeading) {
                    MWThemePreviewPattern(tokens: tokens, opacity: theme.textureStrength == .off ? 0.08 : theme.textureOpacity)
                        .frame(height: 88)
                        .clipShape(RoundedRectangle(cornerRadius: MWRadius.md, style: .continuous))

                    VStack(alignment: .leading, spacing: MWSpacing.sm) {
                        RoundedRectangle(cornerRadius: MWRadius.sm, style: .continuous)
                            .fill(tokens.glassBg)
                            .overlay(
                                RoundedRectangle(cornerRadius: MWRadius.sm, style: .continuous)
                                    .strokeBorder(tokens.glassBorder, lineWidth: 1)
                            )
                            .frame(width: 72, height: 28)

                        HStack(spacing: MWSpacing.xs) {
                            Capsule()
                                .fill(tokens.tabActive.opacity(0.18))
                                .overlay(
                                    Capsule()
                                        .strokeBorder(tokens.tabActive.opacity(0.28), lineWidth: 0.5)
                                )
                                .frame(width: 36, height: 14)

                            Capsule()
                                .fill(tokens.statusRunning.opacity(0.18))
                                .overlay(
                                    HStack(spacing: 3) {
                                        Circle()
                                            .fill(tokens.statusRunning)
                                            .frame(width: 4, height: 4)
                                        RoundedRectangle(cornerRadius: 1)
                                            .fill(tokens.statusRunning)
                                            .frame(width: 18, height: 3)
                                    }
                                )
                                .frame(width: 48, height: 14)
                        }
                    }
                    .padding(MWSpacing.sm)
                }
            }
            .padding(MWSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg, style: .continuous)
                    .fill(tokens.cardBg)
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg, style: .continuous)
                            .strokeBorder(isSelected ? tokens.accentPrimary.opacity(0.44) : tokens.glassBorder, lineWidth: isSelected ? 1.5 : 1)
                    )
            )
            .shadow(color: isSelected ? tokens.glow : .clear, radius: 14, x: 0, y: 8)
        }
        .buttonStyle(.plain)
    }
}

private struct MWThemePreviewPattern: View {
    let tokens: MWThemeTokens
    let opacity: Double

    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(tokens.bgBase))

            guard opacity > 0 else { return }

            let step: CGFloat = 16
            var path = Path()
            var x = -size.height
            while x < size.width + size.height {
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x + size.height * 0.58, y: size.height))
                x += step
            }

            var maze = Path()
            var y: CGFloat = 8
            while y < size.height {
                var xPos: CGFloat = 8
                while xPos < size.width {
                    maze.move(to: CGPoint(x: xPos, y: y))
                    maze.addLine(to: CGPoint(x: xPos + 18, y: y))
                    maze.addLine(to: CGPoint(x: xPos + 18, y: y + 10))
                    maze.addLine(to: CGPoint(x: xPos + 30, y: y + 10))
                    xPos += 42
                }
                y += 26
            }

            context.stroke(path, with: .color(tokens.textPrimary.opacity(opacity * 0.34)), lineWidth: 0.45)
            context.stroke(maze, with: .color(tokens.accentSecondary.opacity(opacity)), lineWidth: 1.0)
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
                VStack(alignment: .leading, spacing: MWSpacing.xs) {
                    HStack {
                        Text(entry.timestamp, style: .time)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(MWColors.textTertiary)
                        Text("[\(entry.category)]")
                            .font(MWTypography.monoSmall())
                            .foregroundColor(MWColors.accentCyan)
                        Spacer()
                        Text(entry.level.rawValue.uppercased())
                            .font(MWTypography.caption2())
                            .foregroundColor(logLevelColor(entry.level))
                    }
                    Text(entry.message)
                        .font(MWTypography.monoCaption())
                        .foregroundColor(MWColors.textSecondary)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 2)
            }
            .listStyle(.plain)
            .background(theme.bgDeepest)
            .navigationTitle("Logs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Clear") { logger.clearLogs() }
                        .foregroundColor(MWColors.statusError)
                }
            }
        }
    }

    private func logLevelColor(_ level: MiWarpLogger.LogLevel) -> Color {
        switch level {
        case .debug: return MWColors.textTertiary
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
            VStack(spacing: MWSpacing.xxl) {
                Spacer()

                ZStack {
                    Circle()
                        .fill(MWColors.accentPrimary.opacity(0.08))
                        .frame(width: 88, height: 88)
                    Image(systemName: "cpu")
                        .font(.system(size: 40))
                        .foregroundStyle(MWColors.accentPrimary, MWColors.accentCyan)
                }

                VStack(spacing: MWSpacing.sm) {
                    Text("MiWarp Mobile")
                        .font(MWTypography.title())
                        .foregroundColor(MWColors.textPrimary)

                    Text("Version 1.0.0")
                        .font(MWTypography.caption())
                        .foregroundColor(MWColors.textTertiary)
                }

                Text("Local-first Agent Session Control Center.\nConnect, monitor, and interact with your AI coding sessions from anywhere on your network.")
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, MWSpacing.xxl)

                Spacer()
            }
            .background(theme.bgDeepest)
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
