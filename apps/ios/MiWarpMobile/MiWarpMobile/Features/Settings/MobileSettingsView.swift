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
                    generalSection

                    connectionSection

                    sessionsSection

                    aiModelsSection

                    advancedSection
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

    // MARK: - General

    private var generalSection: some View {
        settingsGroup(title: String(localized: "General"), icon: "gearshape.fill") {
            VStack(spacing: MWSpacing.md) {
                appearanceRow
                Divider().background(MWColors.divider)
                themeRow
            }
        }
    }

    private var appearanceRow: some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            HStack {
                Image(systemName: theme.appearanceMode.systemImage)
                    .foregroundColor(MWColors.accentCyan)
                    .frame(width: 24)
                Text(String(localized: "Appearance"))
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textPrimary)
                Spacer()
            }

            Picker("", selection: $theme.appearanceMode) {
                ForEach(MWAppearanceMode.allCases) { mode in
                    Text(mode.displayName).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .padding(.leading, MWSpacing.xl)
        }
    }

    private var themeRow: some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            HStack {
                Image(systemName: "swatchpalette")
                    .foregroundColor(MWColors.accentCyan)
                    .frame(width: 24)
                Text(String(localized: "Accent Theme"))
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textPrimary)
                Spacer()
            }

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: MWSpacing.sm),
                    GridItem(.flexible(), spacing: MWSpacing.sm),
                    GridItem(.flexible(), spacing: MWSpacing.sm)
                ],
                spacing: MWSpacing.sm
            ) {
                ForEach(MWAccentTheme.allCases.prefix(6)) { accent in
                    themePreview(accent)
                }
            }
            .padding(.leading, MWSpacing.xl)
        }
    }

    private func themePreview(_ accent: MWAccentTheme) -> some View {
        let isSelected = theme.accentTheme == accent
        return Button {
            withAnimation(.easeInOut(duration: MWMotion.normal)) {
                theme.accentTheme = accent
            }
        } label: {
            VStack(spacing: MWSpacing.xs) {
                ZStack {
                    RoundedRectangle(cornerRadius: MWRadius.sm)
                        .fill(LinearGradient(
                            gradient: Gradient(colors: [accent.primarySwatch, accent.secondarySwatch]),
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ))
                        .frame(height: 36)

                    Image(systemName: isSelected ? "checkmark" : "")
                        .font(.caption.bold())
                        .foregroundColor(.white)
                }

                Text(accent.displayName)
                    .font(MWTypography.caption2())
                    .foregroundColor(MWColors.textSecondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Connection

    private var connectionSection: some View {
        settingsGroup(title: String(localized: "Connection"), icon: "network") {
            VStack(alignment: .leading, spacing: MWSpacing.md) {
                if let connection = store.activeConnection, store.isConnected {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(MWColors.statusSuccess)
                        Text(connection.name)
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(MWColors.textPrimary)
                        Spacer()
                        Text(connection.host)
                            .font(MWTypography.monoCaption())
                            .foregroundColor(MWColors.textSecondary)
                    }

                    Divider().background(MWColors.divider)

                    HStack(spacing: MWSpacing.md) {
                        Button {
                            store.disconnect()
                        } label: {
                            Label(String(localized: "Disconnect"), systemImage: "xmark.circle")
                                .font(MWTypography.subheadlineMedium())
                                .foregroundColor(MWColors.statusError)
                        }
                        .buttonStyle(.plain)

                        Button {
                            store.reconnect()
                        } label: {
                            Label(String(localized: "Reconnect"), systemImage: "arrow.clockwise")
                                .font(MWTypography.subheadlineMedium())
                                .foregroundColor(MWColors.textSecondary)
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    HStack {
                        Image(systemName: "wifi.slash")
                            .foregroundColor(MWColors.textTertiary)
                        Text(String(localized: "No active connection"))
                            .font(MWTypography.callout())
                            .foregroundColor(MWColors.textTertiary)
                        Spacer()

                        Button {
                            store.connectToDefault()
                        } label: {
                            Label(String(localized: "Connect"), systemImage: "play.circle")
                                .font(MWTypography.subheadlineMedium())
                                .foregroundColor(MWColors.accentPrimary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Sessions

    private var sessionsSection: some View {
        settingsGroup(title: String(localized: "Sessions"), icon: "bubble.left.and.bubble.right.fill") {
            VStack(spacing: MWSpacing.sm) {
                HStack {
                    Image(systemName: "info.circle")
                        .foregroundColor(MWColors.accentCyan)
                        .frame(width: 24)
                    Text(String(localized: "Sessions sync automatically"))
                        .font(MWTypography.callout())
                        .foregroundColor(MWColors.textPrimary)
                    Spacer()
                }

                Divider().background(MWColors.divider)

                HStack {
                    Image(systemName: "trash")
                        .foregroundColor(MWColors.statusError)
                        .frame(width: 24)
                    Text(String(localized: "Clear Session History"))
                        .font(MWTypography.callout())
                        .foregroundColor(MWColors.textPrimary)
                    Spacer()
                }
            }
        }
    }

    // MARK: - AI & Models

    private var aiModelsSection: some View {
        settingsGroup(title: String(localized: "AI & Models"), icon: "cpu") {
            VStack(spacing: MWSpacing.sm) {
                HStack {
                    Image(systemName: "cpu")
                        .foregroundColor(MWColors.accentCyan)
                        .frame(width: 24)
                    Text(String(localized: "Default Mode"))
                        .font(MWTypography.callout())
                        .foregroundColor(MWColors.textPrimary)
                    Spacer()
                    Text("Focus")
                        .font(MWTypography.monoCaption())
                        .foregroundColor(MWColors.textSecondary)
                }
            }
        }
    }

    // MARK: - Advanced

    private var advancedSection: some View {
        settingsGroup(title: String(localized: "Advanced"), icon: "slider.horizontal.3") {
            VStack(spacing: MWSpacing.sm) {
                Button {
                    showLogs = true
                } label: {
                    HStack {
                        Image(systemName: "doc.text")
                            .foregroundColor(MWColors.accentCyan)
                            .frame(width: 24)
                        Text(String(localized: "View Logs"))
                            .font(MWTypography.callout())
                            .foregroundColor(MWColors.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(MWColors.textTertiary)
                    }
                }
                .buttonStyle(.plain)

                Divider().background(MWColors.divider)

                Button {
                    copyDebugInfo()
                } label: {
                    HStack {
                        Image(systemName: "doc.on.doc")
                            .foregroundColor(MWColors.accentCyan)
                            .frame(width: 24)
                        Text(String(localized: "Copy Debug Info"))
                            .font(MWTypography.callout())
                            .foregroundColor(MWColors.textPrimary)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)

                Divider().background(MWColors.divider)

                #if canImport(ActivityKit)
                NavigationLink {
                    LiveActivityDemoView()
                } label: {
                    HStack {
                        Image(systemName: "livephoto")
                            .foregroundColor(MWColors.accentCyan)
                            .frame(width: 24)
                        Text(String(localized: "Live Activity Demo"))
                            .font(MWTypography.callout())
                            .foregroundColor(MWColors.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(MWColors.textTertiary)
                    }
                }
                .buttonStyle(.plain)

                Divider().background(MWColors.divider)
                #endif

                Button {
                    clearTokens()
                } label: {
                    HStack {
                        Image(systemName: "key")
                            .foregroundColor(MWColors.statusError)
                            .frame(width: 24)
                        Text(String(localized: "Clear Saved Tokens"))
                            .font(MWTypography.callout())
                            .foregroundColor(MWColors.statusError)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)

                Divider().background(MWColors.divider)

                Button {
                    showAbout = true
                } label: {
                    HStack {
                        Image(systemName: "info.circle")
                            .foregroundColor(MWColors.accentCyan)
                            .frame(width: 24)
                        Text(String(localized: "About MiWarp Mobile"))
                            .font(MWTypography.callout())
                            .foregroundColor(MWColors.textPrimary)
                        Spacer()
                        Text("v1.0.0")
                            .font(MWTypography.monoCaption())
                            .foregroundColor(MWColors.textTertiary)
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(MWColors.textTertiary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Helpers

    private func settingsGroup<Content: View>(title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
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
            .padding(.horizontal, MWSpacing.lg)
        }
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
