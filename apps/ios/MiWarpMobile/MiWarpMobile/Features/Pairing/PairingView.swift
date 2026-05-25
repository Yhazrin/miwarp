import SwiftUI

struct PairingView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var showManualEntry = false
    @State private var showScanner = false

    var body: some View {
        NavigationStack {
            List {
                heroSection

                Section {
                    Button {
                        showScanner = true
                    } label: {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                    }

                    NavigationLink {
                        ManualConnectionSheet()
                    } label: {
                        Label("Manual Setup", systemImage: "keyboard")
                    }
                } header: {
                    Text("Add Connection")
                }

                if !store.connections.isEmpty {
                    Section {
                        ForEach(store.connections) { connection in
                            ConnectionRow(
                                connection: connection,
                                isActive: store.activeConnection?.id == connection.id,
                                connectionState: store.activeConnection?.id == connection.id ? store.connectionState : .disconnected,
                                onConnect: { store.connect(to: connection) },
                                onDisconnect: { store.disconnect() },
                                onDelete: { store.removeConnection(connection) }
                            )
                        }
                    } header: {
                        Text("Saved Connections")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Connect")
            .sheet(isPresented: $showManualEntry) {
                ManualConnectionSheet()
            }
            .sheet(isPresented: $showScanner) {
                QRScannerSheet()
            }
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Connect Desktop")
                        .font(.title2.weight(.semibold))
                        .foregroundColor(.white)

                    Text("Scan QR code or enter details manually.")
                        .font(.callout)
                        .foregroundColor(.white.opacity(0.85))
                }

                HStack(spacing: 8) {
                    heroPill(icon: "server.rack", label: "Enable Server")
                    heroPill(icon: "network", label: "LAN Access")
                    heroPill(icon: "qrcode.viewfinder", label: "Scan QR")
                }
            }
            .padding(.vertical, 8)
            .listRowInsets(EdgeInsets())
            .frame(maxWidth: .infinity)
            .padding(16)
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
        }
    }

    private func heroPill(icon: String, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
            Text(label)
                .font(.caption)
        }
        .foregroundColor(.white.opacity(0.9))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(Color.white.opacity(0.2))
        )
    }
}

// MARK: - Connection Row

struct ConnectionRow: View {
    let connection: MiWarpConnection
    let isActive: Bool
    let connectionState: ConnectionState
    var onConnect: (() -> Void)?
    var onDisconnect: (() -> Void)?
    var onDelete: (() -> Void)?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(connection.name)
                        .font(.body.weight(.medium))

                    if connection.isDefault {
                        Image(systemName: "star.fill")
                            .font(.system(size: 9))
                            .foregroundColor(.orange)
                    }
                }

                Text("\(connection.host):\(connection.port)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if isActive {
                MWStatusIndicator(state: connectionState)
            }
        }
        .swipeActions(edge: .trailing) {
            if isActive && connectionState == .connected {
                Button {
                    onDisconnect?()
                } label: {
                    Label("Disconnect", systemImage: "xmark.circle")
                }
                .tint(.red)
            } else {
                Button {
                    onConnect?()
                } label: {
                    Label("Connect", systemImage: "play.fill")
                }
                .tint(.green)
            }

            Button(role: .destructive) {
                onDelete?()
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            if isActive && connectionState == .connected {
                Button {
                    onDisconnect?()
                } label: {
                    Label("Disconnect", systemImage: "xmark.circle")
                }
            } else {
                Button {
                    onConnect?()
                } label: {
                    Label("Connect", systemImage: "play.fill")
                }
            }
            Divider()
            Button(role: .destructive) {
                onDelete?()
            } label: {
                Label("Delete", systemImage: "trash")
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
                            .foregroundStyle(.red)
                            .font(.callout)
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
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Verifying...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                }

                if let error {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.callout)
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
