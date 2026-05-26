import SwiftUI

struct PairingView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var showScanner = false

    var body: some View {
        MWAdaptiveReader { layout in
            content(layout: layout)
        }
    }

    private func content(layout: MWAdaptiveLayout) -> some View {
        NavigationStack {
            List {
                heroSection

                Section {
                    Button {
                        showScanner = true
                    } label: {
                        Label(String(localized: "pairing.scanQR"), systemImage: "qrcode.viewfinder")
                    }

                    NavigationLink {
                        ManualConnectionSheet()
                    } label: {
                        Label(String(localized: "pairing.manualSetup"), systemImage: "keyboard")
                    }
                } header: {
                    Text(String(localized: "pairing.addConnection"))
                }
                .listRowBackground(theme.cardBg)

                if !store.connections.isEmpty {
                    Section {
                        ForEach(store.connections) { connection in
                            ConnectionRow(
                                connection: connection,
                                isActive: store.activeConnection?.id == connection.id,
                                connectionState: store.activeConnection?.id == connection.id ? store.connectionState : ConnectionState.disconnected,
                                onConnect: { store.connect(to: connection) },
                                onDisconnect: { store.disconnect() },
                                onDelete: { store.removeConnection(connection) }
                            )
                        }
                    } header: {
                        Text(String(localized: "pairing.savedConnections"))
                    }
                    .listRowBackground(theme.cardBg)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
            .frame(maxWidth: layout.connectContentMaxWidth)
            .frame(maxWidth: .infinity)
            .navigationTitle(String(localized: "action.connect"))
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
                    Text(String(localized: "pairing.connectDesktop"))
                        .font(.title2.weight(.semibold))
                        .foregroundColor(heroTextColor)

                    Text(String(localized: "pairing.heroSubtitle"))
                        .font(.callout)
                        .foregroundColor(heroSubtextColor)
                }

                HStack(spacing: 8) {
                    heroPill(icon: "server.rack", label: String(localized: "pairing.enableServer"))
                    heroPill(icon: "network", label: String(localized: "pairing.lanAccess"))
                    heroPill(icon: "qrcode.viewfinder", label: String(localized: "pairing.scanQR"))
                }
            }
            .padding(.vertical, 8)
            .listRowInsets(EdgeInsets())
            .frame(maxWidth: .infinity)
            .padding(16)
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [
                        MWColors.accentPrimary,
                        MWColors.accentPrimary.opacity(0.85),
                        theme.accentSecondary.opacity(0.7)
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        }
        .listRowBackground(Color.clear)
    }

    private var pillTextColor: Color {
        switch theme.accentTheme {
        case .deepSeaMilk, .auroraPomelo, .auroraLime:
            return .black
        default:
            return .white
        }
    }

    private var heroTextColor: Color { pillTextColor }

    private var heroSubtextColor: Color {
        switch theme.accentTheme {
        case .deepSeaMilk, .auroraPomelo, .auroraLime:
            return .black.opacity(0.75)
        default:
            return .white.opacity(0.85)
        }
    }

    private func heroPill(icon: String, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
            Text(label)
                .font(.caption)
        }
        .foregroundColor(pillTextColor)
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
    @EnvironmentObject private var theme: MWTheme
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
                            .foregroundColor(MWColors.statusWarning)
                    }
                }

                Text("\(connection.host):\(connection.port)")
                    .font(.caption.monospaced())
                    .foregroundStyle(theme.cardTextSecondary)
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
                    Label(String(localized: "action.disconnect"), systemImage: "xmark.circle")
                }
                .tint(MWColors.statusError)
            } else {
                Button {
                    onConnect?()
                } label: {
                    Label(String(localized: "action.connect"), systemImage: "play.fill")
                }
                .tint(MWColors.statusSuccess)
            }

            Button(role: .destructive) {
                onDelete?()
            } label: {
                Label(String(localized: "action.delete"), systemImage: "trash")
            }
        }
        .contextMenu {
            if isActive && connectionState == .connected {
                Button {
                    onDisconnect?()
                } label: {
                    Label(String(localized: "action.disconnect"), systemImage: "xmark.circle")
                }
            } else {
                Button {
                    onConnect?()
                } label: {
                    Label(String(localized: "action.connect"), systemImage: "play.fill")
                }
            }
            Divider()
            Button(role: .destructive) {
                onDelete?()
            } label: {
                Label(String(localized: "action.delete"), systemImage: "trash")
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
                Section(String(localized: "pairing.server")) {
                    TextField(String(localized: "pairing.namePlaceholder"), text: $name)
                    TextField(String(localized: "pairing.hostPlaceholder"), text: $host)
                        .textContentType(.URL)
                        .autocapitalization(.none)
                    TextField(String(localized: "pairing.portPlaceholder"), text: $port)
                        .keyboardType(.numberPad)
                }

                Section(String(localized: "pairing.authentication")) {
                    SecureField(String(localized: "pairing.tokenPlaceholder"), text: $token)
                }

                Section {
                    Toggle(String(localized: "pairing.setDefault"), isOn: $isDefault)
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(MWColors.statusError)
                            .font(.callout)
                    }
                }
            }
            .navigationTitle(String(localized: "pairing.newConnection"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "action.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "pairing.saveAndConnect")) { save() }
                        .disabled(host.isEmpty || port.isEmpty || token.isEmpty)
                }
            }
        }
    }

    private func save() {
        guard let portInt = Int(port) else {
            error = String(localized: "pairing.invalidPort")
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
                        Text(String(localized: "pairing.verifying"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                }

                if let error {
                    Text(error)
                        .foregroundStyle(MWColors.statusError)
                        .font(.callout)
                        .padding()
                }
            }
            .navigationTitle(String(localized: "pairing.scanQR"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "action.cancel")) { dismiss() }
                }
            }
        }
    }

    private func handleQRCode(_ code: String) {
        guard let url = URL(string: code),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            error = String(localized: "pairing.invalidQRFormat")
            return
        }

        guard components.scheme == "miwarp", components.host == "connect" else {
            error = String(localized: "pairing.notMiWarpQR")
            return
        }

        let queryItems = components.queryItems ?? []
        guard let rawHost = queryItems.first(where: { $0.name == "host" })?.value,
              let portStr = queryItems.first(where: { $0.name == "port" })?.value,
              let port = Int(portStr),
              let token = queryItems.first(where: { $0.name == "token" })?.value else {
            error = String(localized: "pairing.missingParams")
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
                        self.error = String(localized: "pairing.authFailed")
                    case .networkError:
                        self.error = String(format: String(localized: "pairing.serverUnavailable"), host, "\(port)")
                    }
                }
            } catch {
                await MainActor.run {
                    self.isAuthenticating = false
                    self.error = String(format: String(localized: "pairing.serverUnavailableDetail"), error.localizedDescription)
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
