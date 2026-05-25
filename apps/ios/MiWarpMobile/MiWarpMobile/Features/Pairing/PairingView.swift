import SwiftUI

struct PairingView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var showManualEntry = false
    @State private var showScanner = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: MWSpacing.lg) {
                    headerSection

                    scanQRHeroCard

                    manualSetupCard

                    if !store.connections.isEmpty {
                        savedConnectionsSection
                    }
                }
                .padding(.vertical, MWSpacing.lg)
            }
            .background(theme.bgDeepest)
            .navigationTitle("Connect")
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
        VStack(spacing: MWSpacing.xs) {
            Text(String(localized: "Connect Desktop"))
                .font(MWTypography.title())
                .foregroundColor(MWColors.textPrimary)

            Text(String(localized: "Scan QR code or enter details manually."))
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, MWSpacing.xl)
    }

    // MARK: - Scan QR Hero Card

    private var scanQRHeroCard: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                Text(String(localized: "Scan QR Code"))
                    .font(MWTypography.title())
                    .foregroundColor(.white)

                Text(String(localized: "Point your camera at the QR code shown in MiWarp Desktop."))
                    .font(MWTypography.callout())
                    .foregroundColor(.white.opacity(0.85))
            }

            Button {
                showScanner = true
            } label: {
                HStack(spacing: MWSpacing.sm) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 16, weight: .medium))

                    Text(String(localized: "Scan QR Code"))
                        .font(MWTypography.bodyMedium())

                    Spacer()

                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundColor(MWColors.accentPrimary)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.vertical, MWSpacing.md)
                .background(
                    Capsule()
                        .fill(Color.white)
                )
            }
        }
        .padding(MWSpacing.lg)
        .background(
            LinearGradient(
                gradient: Gradient(colors: [
                    Color(hex: 0xC51F62),
                    Color(hex: 0x8B3DFF)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: MWRadius.xxl))
        .padding(.horizontal, MWSpacing.md)
    }

    // MARK: - Manual Setup Card

    private var manualSetupCard: some View {
        VStack(spacing: MWSpacing.sm) {
            Button {
                showManualEntry = true
            } label: {
                HStack(spacing: MWSpacing.md) {
                    Image(systemName: "keyboard")
                        .font(.system(size: 20))
                        .foregroundColor(MWColors.accentPrimary)
                        .frame(width: 28)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Manual Setup"))
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(MWColors.textPrimary)

                        Text(String(localized: "Host, port, and token"))
                            .font(MWTypography.caption())
                            .foregroundColor(MWColors.textTertiary)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(MWColors.textTertiary)
                }
                .padding(MWSpacing.lg)
                .background(
                    RoundedRectangle(cornerRadius: MWRadius.lg)
                        .fill(MWColors.glassBg)
                        .overlay(
                            RoundedRectangle(cornerRadius: MWRadius.lg)
                                .strokeBorder(MWColors.glassBorder, lineWidth: 0.5)
                        )
                )
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, MWSpacing.md)
    }

    // MARK: - Saved Connections

    private var savedConnectionsSection: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            HStack {
                Text(String(localized: "Saved Connections"))
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
    @State private var isAuthenticating = false

    var body: some View {
        NavigationStack {
            VStack {
                QRScannerView { code in
                    handleQRCode(code)
                }
                .ignoresSafeArea()

                if isAuthenticating {
                    HStack(spacing: MWSpacing.sm) {
                        ProgressView()
                            .tint(MWColors.accentCyan)
                        Text("Verifying...")
                            .font(MWTypography.caption())
                            .foregroundColor(MWColors.textSecondary)
                    }
                    .padding()
                }

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
        guard let rawHost = queryItems.first(where: { $0.name == "host" })?.value,
              let portStr = queryItems.first(where: { $0.name == "port" })?.value,
              let port = Int(portStr),
              let token = queryItems.first(where: { $0.name == "token" })?.value else {
            error = "Missing connection parameters"
            return
        }

        let host = normalizeHost(rawHost)
        let label = queryItems.first(where: { $0.name == "label" })?.value

        isAuthenticating = true
        error = nil

        Task {
            do {
                let result = try await verifyToken(host: host, port: port, token: token)
                await MainActor.run {
                    self.isAuthenticating = false
                    switch result {
                    case .success:
                        self.connectWithQrCode(host: host, port: port, token: token, label: label)
                    case .authFailed:
                        self.error = "Authentication Failed: invalid token"
                    case .networkError:
                        self.error = "Server Unavailable: cannot reach \(host):\(port)"
                    }
                }
            } catch {
                await MainActor.run {
                    self.isAuthenticating = false
                    self.error = "Server Unavailable: \(error.localizedDescription)"
                }
            }
        }
    }

    private func normalizeHost(_ host: String) -> String {
        var result = host.trimmingCharacters(in: .whitespacesAndNewlines)
        if result.hasPrefix("[") && result.hasSuffix("]") {
            result = String(result.dropFirst().dropLast())
        }
        return result
    }

    enum PreflightResult {
        case success
        case authFailed
        case networkError
    }

    private func verifyToken(host: String, port: Int, token: String) async throws -> PreflightResult {
        guard let authURL = URL(string: "http://\(host):\(port)/auth") else {
            return .networkError
        }

        var request = URLRequest(url: authURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 5

        let body = ["token": token]
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response): (Data, URLResponse)
        do {
            (_, response) = try await URLSession.shared.data(for: request)
        } catch {
            return .networkError
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            return .networkError
        }

        switch httpResponse.statusCode {
        case 200:
            return .success
        case 403:
            return .authFailed
        default:
            return .networkError
        }
    }

    private func connectWithQrCode(host: String, port: Int, token: String, label: String?) {
        let connectionName = label ?? host
        let connection = MiWarpConnection(
            name: connectionName,
            host: host,
            port: port,
            isDefault: store.connections.isEmpty
        )

        do {
            try store.addOrUpdateConnection(connection, token: token)
            if let savedConn = store.findConnection(host: host, port: port) {
                store.connect(to: savedConn)
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
