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
                .background(.white.opacity(0.1))

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
        settingsSection(title: "Appearance", icon: "paintbrush") {
            HStack {
                Image(systemName: theme.colorScheme == .dark ? "moon.fill" : "sun.max.fill")
                    .foregroundColor(MWColors.accentCyan)
                    .frame(width: 24)

                Text("Theme")
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textPrimary)

                Spacer()

                Picker("", selection: Binding(
                    get: { theme.colorScheme },
                    set: { theme.colorScheme = $0 }
                )) {
                    Text("Dark").tag(ColorScheme.dark)
                    Text("Light").tag(ColorScheme.light)
                }
                .pickerStyle(.segmented)
                .frame(width: 140)
            }
        }
    }

    // MARK: - Diagnostics

    private var diagnosticsSection: some View {
        settingsSection(title: "Diagnostics", icon: "stethoscope") {
            settingsButton(icon: "doc.text", label: "View Logs") {
                showLogs = true
            }

            Divider()
                .background(.white.opacity(0.1))

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

    private func settingsRow(icon: String, label: String, value: String, valueColor: Color = MWColors.textSecondary) -> some View {
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
                .foregroundColor(valueColor)
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
        Theme: \(theme.colorScheme == .dark ? "dark" : "light")
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
