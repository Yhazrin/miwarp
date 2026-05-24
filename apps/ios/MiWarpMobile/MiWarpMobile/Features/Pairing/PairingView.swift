import SwiftUI

struct PairingView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var showManualEntry = false
    @State private var showScanner = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: MWSpacing.xl) {
                    // Header
                    headerSection

                    // Quick actions
                    quickActionsSection

                    // Onboarding (when no connections)
                    if store.connections.isEmpty {
                        onboardingSection
                    }

                    // Saved connections
                    if !store.connections.isEmpty {
                        savedConnectionsSection
                    }
                }
                .padding(.vertical, MWSpacing.lg)
            }
            .background(theme.bgDeepest)
            .navigationTitle("Connections")
            .sheet(isPresented: $showManualEntry) {
                ManualConnectionSheet()
            }
            .sheet(isPresented: $showScanner) {
                QRScannerSheet()
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: MWSpacing.sm) {
            Text("Connect your phone to a running MiWarp Desktop")
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, MWSpacing.xl)
    }

    // MARK: - Quick Actions

    private var quickActionsSection: some View {
        HStack(spacing: MWSpacing.md) {
            // Scan QR
            Button {
                showScanner = true
            } label: {
                VStack(spacing: MWSpacing.sm) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 28))
                        .foregroundColor(MWColors.accentCyan)
                    Text("Scan QR")
                        .font(MWTypography.subheadlineMedium())
                        .foregroundColor(MWColors.textPrimary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, MWSpacing.lg)
                .mwGlassSurface(
                    cornerRadius: MWRadius.lg,
                    borderColor: MWColors.accentCyan.opacity(0.2),
                    fillColor: MWColors.cardBg
                )
            }
            .buttonStyle(.plain)

            // Add Manually
            Button {
                showManualEntry = true
            } label: {
                VStack(spacing: MWSpacing.sm) {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 28))
                        .foregroundColor(MWColors.accentPrimary)
                    Text("Add Manually")
                        .font(MWTypography.subheadlineMedium())
                        .foregroundColor(MWColors.textPrimary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, MWSpacing.lg)
                .mwGlassSurface(
                    cornerRadius: MWRadius.lg,
                    borderColor: MWColors.accentPrimary.opacity(0.2),
                    fillColor: MWColors.cardBg
                )
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, MWSpacing.lg)
    }

    // MARK: - Onboarding

    private var onboardingSection: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            Text("Getting Started")
                .font(MWTypography.title3())
                .foregroundColor(MWColors.textPrimary)
                .padding(.horizontal, MWSpacing.lg)

            MWGlassCard {
                VStack(alignment: .leading, spacing: MWSpacing.md) {
                    onboardingStep(
                        icon: "desktopcomputer",
                        title: "Enable Web Server",
                        desc: "Open MiWarp Desktop → Settings → Web Server"
                    )
                    onboardingStep(
                        icon: "network",
                        title: "Set bind to 0.0.0.0",
                        desc: "Allows your phone to connect over LAN"
                    )
                    onboardingStep(
                        icon: "qrcode",
                        title: "Scan QR or enter manually",
                        desc: "Use the QR code from Desktop or type host/token"
                    )
                }
            }
            .padding(.horizontal, MWSpacing.lg)
        }
    }

    private func onboardingStep(icon: String, title: String, desc: String) -> some View {
        HStack(alignment: .top, spacing: MWSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(MWColors.accentCyan)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(MWTypography.subheadlineMedium())
                    .foregroundColor(MWColors.textPrimary)
                Text(desc)
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textTertiary)
            }
        }
    }

    // MARK: - Saved Connections

    private var savedConnectionsSection: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            HStack {
                Text("Saved Connections")
                    .font(MWTypography.title3())
                    .foregroundColor(MWColors.textPrimary)
                Spacer()
                Text("\(store.connections.count)")
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textTertiary)
                    .padding(.horizontal, MWSpacing.sm)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(MWColors.bgSurface)
                    )
            }
            .padding(.horizontal, MWSpacing.lg)

            ForEach(store.connections) { connection in
                ConnectionCard(
                    connection: connection,
                    isActive: store.activeConnection?.id == connection.id,
                    connectionState: store.activeConnection?.id == connection.id ? store.connectionState : .disconnected,
                    onConnect: {
                        store.connect(to: connection)
                    },
                    onDisconnect: {
                        store.disconnect()
                    },
                    onDelete: {
                        store.removeConnection(connection)
                    }
                )
                .padding(.horizontal, MWSpacing.lg)
            }
        }
    }
}

// MARK: - Connection Card

struct ConnectionCard: View {
    let connection: MiWarpConnection
    let isActive: Bool
    let connectionState: ConnectionState
    var onConnect: (() -> Void)?
    var onDisconnect: (() -> Void)?
    var onDelete: (() -> Void)?

    var body: some View {
        MWGlassCard(borderColor: isActive ? MWColors.tabActive.opacity(0.3) : nil) {
            VStack(alignment: .leading, spacing: MWSpacing.md) {
                HStack {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        HStack(spacing: MWSpacing.sm) {
                            Text(connection.name)
                                .font(MWTypography.bodyMedium())
                                .foregroundColor(MWColors.textPrimary)

                            if connection.isDefault {
                                Image(systemName: "star.fill")
                                    .font(.system(size: 10))
                                    .foregroundColor(MWColors.statusPending)
                            }
                        }

                        Text("\(connection.host):\(connection.port)")
                            .font(MWTypography.monoCaption())
                            .foregroundColor(MWColors.textSecondary)
                    }

                    Spacer()

                    if isActive {
                        MWStatusIndicator(state: connectionState)
                    }
                }

                HStack(spacing: MWSpacing.sm) {
                    if isActive && connectionState == .connected {
                        Button {
                            onDisconnect?()
                        } label: {
                            Label("Disconnect", systemImage: "xmark.circle")
                                .font(MWTypography.caption())
                                .foregroundColor(MWColors.statusError)
                                .padding(.horizontal, MWSpacing.md)
                                .padding(.vertical, MWSpacing.xs)
                                .background(
                                    Capsule()
                                        .strokeBorder(MWColors.statusError.opacity(0.3), lineWidth: 0.5)
                                )
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button {
                            onConnect?()
                        } label: {
                            Label("Connect", systemImage: "play.fill")
                                .font(MWTypography.caption())
                                .foregroundColor(MWColors.accentPrimary)
                                .padding(.horizontal, MWSpacing.md)
                                .padding(.vertical, MWSpacing.xs)
                                .background(
                                    Capsule()
                                        .fill(MWColors.accentPrimary.opacity(0.12))
                                )
                        }
                        .buttonStyle(.plain)
                    }

                    Spacer()

                    Button {
                        onDelete?()
                    } label: {
                        Image(systemName: "trash")
                            .font(.caption)
                            .foregroundColor(MWColors.textTertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - Manual Connection Sheet

struct ManualConnectionSheet: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var host = ""
    @State private var port = "9476"
    @State private var token = ""
    @State private var isDefault = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Name (optional)", text: $name)
                    TextField("Host (e.g. 192.168.1.100)", text: $host)
                        .textContentType(.URL)
                        .autocapitalization(.none)
                    TextField("Port", text: $port)
                        .keyboardType(.numberPad)
                }

                Section("Authentication") {
                    SecureField("Token", text: $token)
                }

                Section {
                    Toggle("Set as Default", isOn: $isDefault)
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundColor(MWColors.statusError)
                            .font(MWTypography.callout())
                    }
                }
            }
            .navigationTitle("New Connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save & Connect") { save() }
                        .disabled(host.isEmpty || port.isEmpty || token.isEmpty)
                }
            }
        }
    }

    private func save() {
        guard let portInt = Int(port) else {
            error = "Invalid port number"
            return
        }

        let connection = MiWarpConnection(
            name: name.isEmpty ? "\(host):\(port)" : name,
            host: host,
            port: portInt,
            isDefault: isDefault
        )

        do {
            try store.addConnection(connection, token: token)
            store.connect(to: connection)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - QR Scanner Sheet

struct QRScannerSheet: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack {
                QRScannerView { code in
                    handleQRCode(code)
                }
                .ignoresSafeArea()

                if let error {
                    Text(error)
                        .foregroundColor(MWColors.statusError)
                        .font(MWTypography.callout())
                        .padding()
                }
            }
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func handleQRCode(_ code: String) {
        guard let url = URL(string: code),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            error = "Invalid QR code format"
            return
        }

        guard components.scheme == "miwarp", components.host == "connect" else {
            error = "Not a MiWarp QR code"
            return
        }

        let queryItems = components.queryItems ?? []
        guard let host = queryItems.first(where: { $0.name == "host" })?.value,
              let portStr = queryItems.first(where: { $0.name == "port" })?.value,
              let port = Int(portStr),
              let token = queryItems.first(where: { $0.name == "token" })?.value else {
            error = "Missing connection parameters"
            return
        }

        let label = queryItems.first(where: { $0.name == "label" })?.value
        let connection = MiWarpConnection(
            name: label ?? host,
            host: host,
            port: port,
            isDefault: store.connections.isEmpty
        )

        do {
            try store.addConnection(connection, token: token)
            store.connect(to: connection)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
