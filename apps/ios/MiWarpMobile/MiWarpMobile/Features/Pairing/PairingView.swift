import SwiftUI

struct PairingView: View {
    @Environment(MiWarpConnectionStore.self) private var store
    @State private var showManualEntry = false
    @State private var showScanner = false

    var body: some View {
        NavigationStack {
            List {
                if store.connections.isEmpty {
                    Section {
                        MWEmptyState(
                            icon: "point.3.filled.connected.trianglepath.dotted",
                            title: "No Connections",
                            message: "Scan a QR code or add a connection manually to get started."
                        )
                        .listRowBackground(Color.clear)
                        .frame(height: 300)
                    }
                } else {
                    ConnectionListView()
                }

                Section {
                    Button {
                        showManualEntry = true
                    } label: {
                        Label("Add Manually", systemImage: "plus.circle")
                    }

                    Button {
                        showScanner = true
                    } label: {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                    }
                }
            }
            .navigationTitle("Connections")
            .sheet(isPresented: $showManualEntry) {
                ManualConnectionSheet()
            }
            .sheet(isPresented: $showScanner) {
                QRScannerSheet()
            }
        }
    }
}

// MARK: - Manual Connection Sheet

struct ManualConnectionSheet: View {
    @Environment(MiWarpConnectionStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var host = ""
    @State private var port = "9821"
    @State private var token = ""
    @State private var isDefault = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Name", text: $name)
                    TextField("Host", text: $host)
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
                    Button("Save") { save() }
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
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - QR Scanner Sheet

struct QRScannerSheet: View {
    @Environment(MiWarpConnectionStore.self) private var store
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

        let connection = MiWarpConnection(
            name: host,
            host: host,
            port: port,
            isDefault: store.connections.isEmpty
        )

        do {
            try store.addConnection(connection, token: token)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
