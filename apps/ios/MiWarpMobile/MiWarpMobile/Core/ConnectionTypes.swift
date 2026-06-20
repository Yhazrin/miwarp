import Foundation
import SwiftUI

// MARK: - Connection

struct MiWarpConnection: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var host: String
    var port: Int
    var isDefault: Bool
    let createdAt: Date

    init(id: UUID = UUID(), name: String, host: String, port: Int, isDefault: Bool = false) {
        self.id = id
        self.name = name
        self.host = host
        self.port = port
        self.isDefault = isDefault
        self.createdAt = Date()
    }

    var wsURL: URL? {
        URL(string: "\(WSEndpoint.wsScheme)://\(host):\(port)\(WSEndpoint.wsPath)")
    }
}

// MARK: - Connection State

enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case authenticating
    case connected
    case reconnecting(attempt: Int)
    case authFailed(reason: String)
    case serverUnavailable(reason: String)

    var isActive: Bool {
        switch self {
        case .connected, .reconnecting: return true
        default: return false
        }
    }

    var isReconnecting: Bool {
        if case .reconnecting = self { return true }
        return false
    }

    var displayLabel: String {
        switch self {
        case .disconnected: return String(localized: "connection.disconnected")
        case .connecting: return String(localized: "connection.connecting")
        case .authenticating: return String(localized: "connection.authenticating")
        case .connected: return String(localized: "connection.connected")
        case .reconnecting(let attempt): return String(format: String(localized: "connection.reconnecting"), attempt)
        case .authFailed: return String(localized: "connection.authFailed")
        case .serverUnavailable: return String(localized: "connection.serverUnavailable")
        }
    }
}
