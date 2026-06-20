import Foundation

// MARK: - WebSocket Endpoints

enum WSEndpoint {
    static let wsScheme = "ws"
    static let httpScheme = "http"
    static let wsPath = "/ws"
    static let loginPath = "/login"
    static let maskedToken = "••••"
    static let tokenQueryItem = "token"
}

// MARK: - WebSocket HTTP Headers

enum WSHeader {
    static let authorization = "Authorization"
    static let bearerPrefix = "Bearer "
    static let token = "X-MiWarp-Token"
}

// MARK: - WebSocket Close Codes (server-defined)

enum WSCloseCode {
    /// Server's custom code: token rotated / session expired / token version mismatch.
    /// Reconnecting won't help — surface auth error immediately.
    static let tokenExpired: Int = 4401
}

// MARK: - RPC Method Names

enum WSMethod {
    static let subscribe = "_subscribe"
    static let fullReload = "_full_reload"
}

// MARK: - Server Event Names

enum WSEventName {
    static let busEvent = "bus-event"
    static let fullReload = "_full_reload"
    static let chunkBegin = "chunk_begin"
    static let chunk = "chunk"
    static let chunkEnd = "chunk_end"
}

// MARK: - JSON Field Names (bus + chunk protocol)

enum WSField {
    static let type = "type"
    static let seq = "seq"
    static let rpcSeq = "_seq"
    static let runId = "run_id"
    static let payload = "payload"
    static let event = "event"
    static let result = "result"
    static let error = "error"
    static let id = "id"
    static let msgId = "msg_id"
    static let total = "total"
    static let idx = "idx"
    static let data = "data"
    static let lastSeq = "last_seq"
    static let text = "text"
    static let role = "role"
    static let messageId = "message_id"
}

// MARK: - WebSocket Request

struct WSRequest: Codable {
    let id: String
    let method: String
    let params: [String: AnyCodable]?

    init(method: String, params: [String: Any]? = nil) {
        self.id = UUID().uuidString
        self.method = method
        self.params = params?.mapValues { AnyCodable($0) }
    }
}

// MARK: - WebSocket Response

struct WSResponse: Decodable {
    let id: String?
    let result: AnyCodable?
    let error: String?
    let event: String?
    let seq: Int?
    let runId: String?
    let payload: AnyCodable?
    /// Bus events are decoded directly from the original JSON payload, avoiding
    /// an AnyCodable → JSONEncoder → JSONDecoder round trip for every event.
    let busEventPayload: BusEventPayload?

    enum CodingKeys: String, CodingKey {
        case id
        case result
        case error
        case event
        case seq
        case runId = "run_id"
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        result = try container.decodeIfPresent(AnyCodable.self, forKey: .result)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        event = try container.decodeIfPresent(String.self, forKey: .event)
        seq = try container.decodeIfPresent(Int.self, forKey: .seq)
        runId = try container.decodeIfPresent(String.self, forKey: .runId)

        if event == WSEventName.busEvent {
            busEventPayload = try? container.decode(BusEventPayload.self, forKey: .payload)
            payload = busEventPayload == nil
                ? try container.decodeIfPresent(AnyCodable.self, forKey: .payload)
                : nil
        } else {
            payload = try container.decodeIfPresent(AnyCodable.self, forKey: .payload)
            busEventPayload = nil
        }
    }
}

// MARK: - WebSocket Errors

enum WSError: LocalizedError {
    case notConnected
    case encodingFailed
    case timeout
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .notConnected: return String(localized: "wsError.notConnected")
        case .encodingFailed: return String(localized: "wsError.encodingFailed")
        case .timeout: return String(localized: "wsError.timeout")
        case .serverError(let msg): return msg
        }
    }
}
