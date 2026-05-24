import Foundation
import SwiftUI

// MARK: - Connection Store

@MainActor
final class MiWarpConnectionStore: ObservableObject {
    static let shared = MiWarpConnectionStore()

    private let logger = MiWarpLogger.shared
    private let userDefaults = UserDefaults.standard
    private let connectionsKey = "ocv:miwarp_connections"
    private let activeConnectionKey = "ocv:miwarp_active_connection"

    @Published var connections: [MiWarpConnection] = []
    @Published var activeConnection: MiWarpConnection?
    @Published var connectionState: ConnectionState = .disconnected

    // Sub-systems
    let wsClient = MiWarpWebSocketClient()
    private(set) var rpc: MiWarpRPC?
    private var connectionObserverTask: Task<Void, Never>?

    var isConnected: Bool { connectionState == .connected }

    init() {
        loadConnections()
        rpc = MiWarpRPC(client: wsClient)
    }

    // MARK: - Connection Management

    func addConnection(_ connection: MiWarpConnection, token: String) throws {
        try MiWarpKeychain.save(token: token, for: connection.id)
        connections.append(connection)
        if connection.isDefault || connections.count == 1 {
            setDefault(connection)
        }
        saveConnections()
        logger.info("Added connection: \(connection.name)")
    }

    func removeConnection(_ connection: MiWarpConnection) {
        connections.removeAll { $0.id == connection.id }
        MiWarpKeychain.delete(for: connection.id)
        if activeConnection?.id == connection.id {
            disconnect()
            activeConnection = nil
        }
        saveConnections()
        logger.info("Removed connection: \(connection.name)")
    }

    func updateConnection(_ connection: MiWarpConnection, token: String? = nil) throws {
        if let token {
            try MiWarpKeychain.save(token: token, for: connection.id)
        }
        if let index = connections.firstIndex(where: { $0.id == connection.id }) {
            connections[index] = connection
        }
        saveConnections()
    }

    func setDefault(_ connection: MiWarpConnection) {
        for i in connections.indices {
            connections[i].isDefault = (connections[i].id == connection.id)
        }
        saveConnections()
    }

    // MARK: - Connect / Disconnect

    func connect(to connection: MiWarpConnection) {
        guard let token = try? MiWarpKeychain.load(for: connection.id) else {
            connectionState = .authFailed(reason: "No token stored for this connection")
            return
        }

        activeConnection = connection
        userDefaults.set(connection.id.uuidString, forKey: activeConnectionKey)
        connectionState = .connecting

        // Connect first, THEN start observing the stream
        // This order is critical: wsClient.connect() creates new streams,
        // and we must observe the stream that is created AFTER our connect call
        wsClient.connect(host: connection.host, port: connection.port, token: token)

        // Cancel previous observer and observe connection state changes
        connectionObserverTask?.cancel()
        connectionObserverTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await state in self.wsClient.connectionStateStream {
                self.connectionState = state
            }
        }
    }

    func connectToDefault() {
        if let saved = userDefaults.string(forKey: activeConnectionKey),
           let conn = connections.first(where: { $0.id.uuidString == saved }) {
            connect(to: conn)
        } else if let defaultConn = connections.first(where: { $0.isDefault }) {
            connect(to: defaultConn)
        }
    }

    func disconnect() {
        connectionObserverTask?.cancel()
        connectionObserverTask = nil
        wsClient.disconnect()
        connectionState = .disconnected
    }

    func reconnect() {
        guard let activeConnection else { return }
        disconnect()
        connect(to: activeConnection)
    }

    // MARK: - Persistence

    private func saveConnections() {
        do {
            let data = try JSONEncoder().encode(connections)
            userDefaults.set(data, forKey: connectionsKey)
        } catch {
            logger.error("Failed to save connections: \(error.localizedDescription)")
        }
    }

    private func loadConnections() {
        guard let data = userDefaults.data(forKey: connectionsKey) else { return }
        do {
            connections = try JSONDecoder().decode([MiWarpConnection].self, from: data)
        } catch {
            logger.error("Failed to load connections: \(error.localizedDescription)")
        }
    }
}
