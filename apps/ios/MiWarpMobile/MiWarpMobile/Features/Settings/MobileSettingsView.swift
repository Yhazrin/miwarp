import SwiftUI

struct MobileSettingsView: View {
    @Environment(MiWarpConnectionStore.self) private var store
    @Environment(MWTheme.self) private var theme
    @State private var showLogs = false
    @State private var showAbout = false

    var body: some View {
        NavigationStack {
            List {
                // Connection
                Section("Connection") {
                    if let connection = store.activeConnection {
                        LabeledContent("Server", value: "\(connection.host):\(connection.port)")
                        LabeledContent("Status", value: store.connectionState.displayLabel)
                    } else {
                        Text("No active connection")
                            .foregroundColor(MWColors.textTertiary)
                    }

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
                    }

                    if store.isConnected {
                        Button {
                            store.reconnect()
                        } label: {
                            Label("Reconnect", systemImage: "arrow.clockwise")
                        }
                    }
                }

                // Appearance
                Section("Appearance") {
                    Picker("Theme", selection: Binding(
                        get: { theme.colorScheme },
                        set: { theme.colorScheme = $0 }
                    )) {
                        Text("Dark").tag(ColorScheme.dark)
                        Text("Light").tag(ColorScheme.light)
                    }
                }

                // Diagnostics
                Section("Diagnostics") {
                    Button {
                        showLogs = true
                    } label: {
                        Label("View Logs", systemImage: "doc.text")
                    }
                }

                // About
                Section {
                    Button {
                        showAbout = true
                    } label: {
                        Label("About MiWarp Mobile", systemImage: "info.circle")
                    }
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showLogs) {
                LogsView()
            }
            .sheet(isPresented: $showAbout) {
                AboutView()
            }
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
            .navigationTitle("Logs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Clear") { logger.clearLogs() }
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

    var body: some View {
        NavigationStack {
            VStack(spacing: MWSpacing.xxl) {
                Image(systemName: "cpu")
                    .font(.system(size: 64))
                    .foregroundColor(MWColors.accentPrimary)

                Text("MiWarp Mobile")
                    .font(MWTypography.largeTitle())
                    .foregroundColor(MWColors.textPrimary)

                Text("Version 1.0.0")
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)

                Text("A mobile companion for MiWarp desktop.\nConnect, monitor, and interact with your AI coding sessions.")
                    .font(MWTypography.body())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)

                Spacer()
            }
            .padding(.top, MWSpacing.massive)
            .background(MWColors.bgDeepest)
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
