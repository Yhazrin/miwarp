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
        URL(string: "ws://\(host):\(port)/ws")
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

    var displayLabel: String {
        switch self {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting..."
        case .authenticating: return "Authenticating..."
        case .connected: return "Connected"
        case .reconnecting(let attempt): return "Reconnecting (attempt \(attempt))..."
        case .authFailed: return "Authentication Failed"
        case .serverUnavailable: return "Server Unavailable"
        }
    }
}

// MARK: - Run Status

enum RunStatus: String, Codable, CaseIterable {
    case pending
    case running
    case idle
    case waitingApproval = "waiting_approval" // client-only, set by permission_prompt events
    case completed
    case failed
    case stopped

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = RunStatus(rawValue: raw) ?? .pending
    }

    var displayLabel: String {
        switch self {
        case .pending: return "Pending"
        case .running: return "Running"
        case .idle: return "Idle"
        case .waitingApproval: return "Waiting Approval"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .stopped: return "Stopped"
        }
    }

    var systemImage: String {
        switch self {
        case .pending: return "clock.circle.fill"
        case .running: return "play.circle.fill"
        case .idle: return "moon.circle.fill"
        case .waitingApproval: return "exclamationmark.shield.fill"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .stopped: return "stop.circle.fill"
        }
    }
}

// MARK: - Run Source

enum RunSource: String, Codable {
    case native
    case cliImport = "cli_import"
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = RunSource(rawValue: raw) ?? .unknown
    }
}

// MARK: - MiWarp Run

struct MiWarpRun: Identifiable, Codable, Hashable {
    let id: String
    var name: String?
    var prompt: String?
    var cwd: String
    var agent: String
    var model: String?
    var status: RunStatus
    var source: RunSource?
    var messageCount: Int?
    var lastActivityAt: String?
    var startedAt: String?

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    var lastActivity: Date? {
        lastActivityAt.flatMap { MiWarpRun.isoFormatter.date(from: $0) }
    }
    var createdAt: Date? {
        startedAt.flatMap { MiWarpRun.isoFormatter.date(from: $0) }
    }

    enum CodingKeys: String, CodingKey {
        case id, name, prompt, cwd, agent, model, status, source
        case messageCount = "message_count"
        case lastActivityAt = "last_activity_at"
        case startedAt = "started_at"
    }

    var displayTitle: String {
        name ?? prompt?.prefix(80).description ?? "Untitled Session"
    }

    var shortCwd: String {
        let components = cwd.split(separator: "/")
        if components.count <= 2 { return cwd }
        return ".../" + components.suffix(2).joined(separator: "/")
    }
}

// MARK: - Bus Event

struct BusEvent: Identifiable {
    let seq: Int
    let runId: String
    let payload: BusEventPayload

    var id: Int { seq }

    init(seq: Int, runId: String, payload: BusEventPayload) {
        self.seq = seq
        self.runId = runId
        self.payload = payload
    }
}

extension BusEvent: Codable {
    enum CodingKeys: String, CodingKey {
        case seq
        case _seq
        case runId = "run_id"
        case payload
        case type
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Broadcast format has `seq`, RPC flat format has `_seq`
        if let s = try container.decodeIfPresent(Int.self, forKey: .seq) {
            seq = s
        } else if let s = try container.decodeIfPresent(Int.self, forKey: ._seq) {
            seq = s
        } else {
            seq = 0
        }

        runId = try container.decodeIfPresent(String.self, forKey: .runId) ?? ""

        // Broadcast format has `payload` wrapper; RPC flat format is the payload itself
        if let p = try container.decodeIfPresent(BusEventPayload.self, forKey: .payload) {
            payload = p
        } else {
            // Flat format — decode the whole object as a BusEventPayload
            payload = try BusEventPayload(from: decoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(seq, forKey: .seq)
        try container.encode(runId, forKey: .runId)
        try payload.encode(to: encoder)
    }
}

enum BusEventPayload: Codable {
    case sessionInit(SessionInitPayload)
    case messageDelta(MessageDeltaPayload)
    case messageComplete(MessageCompletePayload)
    case toolStart(ToolStartPayload)
    case toolEnd(ToolEndPayload)
    case userMessage(UserMessagePayload)
    case runState(RunStatePayload)
    case usageUpdate(UsageUpdatePayload)
    case thinkingDelta(ThinkingDeltaPayload)
    case toolInputDelta(ToolInputDeltaPayload)
    case permissionPrompt(PermissionPromptPayload)
    case permissionDenied(PermissionDeniedPayload)
    case compactBoundary(CompactBoundaryPayload)
    case systemStatus(SystemStatusPayload)
    case hookStarted(HookStartedPayload)
    case hookProgress(HookProgressPayload)
    case hookResponse(HookResponsePayload)
    case hookCallback(HookCallbackPayload)
    case taskNotification(TaskNotificationPayload)
    case toolProgress(ToolProgressPayload)
    case toolUseSummary(ToolUseSummaryPayload)
    case filesPersisted(FilesPersistedPayload)
    case controlCancelled(ControlCancelledPayload)
    case commandOutput(CommandOutputPayload)
    case elicitationPrompt(ElicitationPromptPayload)
    case rateLimitEvent(RateLimitEventPayload)
    case authStatus(AuthStatusPayload)
    case ralphStarted(RalphStartedPayload)
    case ralphIteration(RalphIterationPayload)
    case ralphComplete(RalphCompletePayload)
    case raw(RawPayload)

    enum CodingKeys: String, CodingKey {
        case type
    }

    private enum EventType: String, Codable {
        case session_init
        case message_delta
        case message_complete
        case tool_start
        case tool_end
        case user_message
        case run_state
        case usage_update
        case thinking_delta
        case tool_input_delta
        case permission_prompt
        case permission_denied
        case compact_boundary
        case system_status
        case hook_started
        case hook_progress
        case hook_response
        case hook_callback
        case task_notification
        case tool_progress
        case tool_use_summary
        case files_persisted
        case control_cancelled
        case command_output
        case elicitation_prompt
        case rate_limit_event
        case auth_status
        case ralph_started
        case ralph_iteration
        case ralph_complete
        case raw
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicKey.self)

        let typeString = try container.decode(String.self, forKey: DynamicKey(stringValue: "type")!)
        guard let eventType = EventType(rawValue: typeString) else {
            let rawDict = try decoder.singleValueContainer().decode([String: AnyCodable].self)
            self = .raw(RawPayload(type: typeString, data: rawDict))
            return
        }

        switch eventType {
        case .session_init:
            self = .sessionInit(try SessionInitPayload(from: decoder))
        case .message_delta:
            self = .messageDelta(try MessageDeltaPayload(from: decoder))
        case .message_complete:
            self = .messageComplete(try MessageCompletePayload(from: decoder))
        case .tool_start:
            self = .toolStart(try ToolStartPayload(from: decoder))
        case .tool_end:
            self = .toolEnd(try ToolEndPayload(from: decoder))
        case .user_message:
            self = .userMessage(try UserMessagePayload(from: decoder))
        case .run_state:
            self = .runState(try RunStatePayload(from: decoder))
        case .usage_update:
            self = .usageUpdate(try UsageUpdatePayload(from: decoder))
        case .thinking_delta:
            self = .thinkingDelta(try ThinkingDeltaPayload(from: decoder))
        case .tool_input_delta:
            self = .toolInputDelta(try ToolInputDeltaPayload(from: decoder))
        case .permission_prompt:
            self = .permissionPrompt(try PermissionPromptPayload(from: decoder))
        case .permission_denied:
            self = .permissionDenied(try PermissionDeniedPayload(from: decoder))
        case .compact_boundary:
            self = .compactBoundary(try CompactBoundaryPayload(from: decoder))
        case .system_status:
            self = .systemStatus(try SystemStatusPayload(from: decoder))
        case .hook_started:
            self = .hookStarted(try HookStartedPayload(from: decoder))
        case .hook_progress:
            self = .hookProgress(try HookProgressPayload(from: decoder))
        case .hook_response:
            self = .hookResponse(try HookResponsePayload(from: decoder))
        case .hook_callback:
            self = .hookCallback(try HookCallbackPayload(from: decoder))
        case .task_notification:
            self = .taskNotification(try TaskNotificationPayload(from: decoder))
        case .tool_progress:
            self = .toolProgress(try ToolProgressPayload(from: decoder))
        case .tool_use_summary:
            self = .toolUseSummary(try ToolUseSummaryPayload(from: decoder))
        case .files_persisted:
            self = .filesPersisted(try FilesPersistedPayload(from: decoder))
        case .control_cancelled:
            self = .controlCancelled(try ControlCancelledPayload(from: decoder))
        case .command_output:
            self = .commandOutput(try CommandOutputPayload(from: decoder))
        case .elicitation_prompt:
            self = .elicitationPrompt(try ElicitationPromptPayload(from: decoder))
        case .rate_limit_event:
            self = .rateLimitEvent(try RateLimitEventPayload(from: decoder))
        case .auth_status:
            self = .authStatus(try AuthStatusPayload(from: decoder))
        case .ralph_started:
            self = .ralphStarted(try RalphStartedPayload(from: decoder))
        case .ralph_iteration:
            self = .ralphIteration(try RalphIterationPayload(from: decoder))
        case .ralph_complete:
            self = .ralphComplete(try RalphCompletePayload(from: decoder))
        case .raw:
            let rawDict = try decoder.singleValueContainer().decode([String: AnyCodable].self)
            self = .raw(RawPayload(type: "raw", data: rawDict))
        }
    }

    func encode(to encoder: Encoder) throws {
        // Simplified encoding for storage
        switch self {
        case .sessionInit(let p): try p.encode(to: encoder)
        case .messageDelta(let p): try p.encode(to: encoder)
        case .messageComplete(let p): try p.encode(to: encoder)
        case .toolStart(let p): try p.encode(to: encoder)
        case .toolEnd(let p): try p.encode(to: encoder)
        case .userMessage(let p): try p.encode(to: encoder)
        case .runState(let p): try p.encode(to: encoder)
        case .usageUpdate(let p): try p.encode(to: encoder)
        case .thinkingDelta(let p): try p.encode(to: encoder)
        case .toolInputDelta(let p): try p.encode(to: encoder)
        case .permissionPrompt(let p): try p.encode(to: encoder)
        case .permissionDenied(let p): try p.encode(to: encoder)
        case .compactBoundary(let p): try p.encode(to: encoder)
        case .systemStatus(let p): try p.encode(to: encoder)
        case .hookStarted(let p): try p.encode(to: encoder)
        case .hookProgress(let p): try p.encode(to: encoder)
        case .hookResponse(let p): try p.encode(to: encoder)
        case .hookCallback(let p): try p.encode(to: encoder)
        case .taskNotification(let p): try p.encode(to: encoder)
        case .toolProgress(let p): try p.encode(to: encoder)
        case .toolUseSummary(let p): try p.encode(to: encoder)
        case .filesPersisted(let p): try p.encode(to: encoder)
        case .controlCancelled(let p): try p.encode(to: encoder)
        case .commandOutput(let p): try p.encode(to: encoder)
        case .elicitationPrompt(let p): try p.encode(to: encoder)
        case .rateLimitEvent(let p): try p.encode(to: encoder)
        case .authStatus(let p): try p.encode(to: encoder)
        case .ralphStarted(let p): try p.encode(to: encoder)
        case .ralphIteration(let p): try p.encode(to: encoder)
        case .ralphComplete(let p): try p.encode(to: encoder)
        case .raw(let p): try p.encode(to: encoder)
        }
    }
}

// MARK: - Payload Types

struct SessionInitPayload: Codable {
    let sessionId: String?
    let agent: String?
    let model: String?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case agent
        case model
    }
}

struct MessageDeltaPayload: Codable {
    let role: String?
    let content: String?
    let delta: String?
    let messageId: String?

    enum CodingKeys: String, CodingKey {
        case role
        case content = "text"
        case delta
        case messageId = "message_id"
    }
}

struct MessageCompletePayload: Codable {
    let role: String?
    let content: String?
    let messageId: String?

    enum CodingKeys: String, CodingKey {
        case role
        case content = "text"
        case messageId = "message_id"
    }
}

struct ToolStartPayload: Codable {
    let toolName: String?
    let toolUseId: String?
    let input: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case toolName = "tool_name"
        case toolUseId = "tool_use_id"
        case input
    }
}

struct ToolEndPayload: Codable {
    let toolName: String?
    let toolUseId: String?
    let output: AnyCodable?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case toolName = "tool_name"
        case toolUseId = "tool_use_id"
        case output
        case status
    }
}

struct UserMessagePayload: Codable {
    let content: String?
    let role: String?

    enum CodingKeys: String, CodingKey {
        case content = "text"
        case role
    }
}

struct RunStatePayload: Codable {
    let status: RunStatus?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case status = "state"
        case error
    }
}

struct UsageUpdatePayload: Codable {
    let inputTokens: Int?
    let outputTokens: Int?
    let cacheReadTokens: Int?
    let cacheWriteTokens: Int?
    let costUsd: Double?

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case cacheReadTokens = "cache_read_tokens"
        case cacheWriteTokens = "cache_write_tokens"
        case costUsd = "total_cost_usd"
    }
}

struct ThinkingDeltaPayload: Codable {
    let text: String?

    enum CodingKeys: String, CodingKey {
        case text
    }
}

struct ToolInputDeltaPayload: Codable {
    let toolUseId: String?
    let delta: String?

    enum CodingKeys: String, CodingKey {
        case toolUseId = "tool_use_id"
        case delta
    }
}

struct PermissionPromptPayload: Codable {
    let requestId: String?
    let toolName: String?
    let toolUseId: String?
    let toolInput: AnyCodable?
    let description: String?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case toolName = "tool_name"
        case toolUseId = "tool_use_id"
        case toolInput = "tool_input"
        case description = "decision_reason"
    }
}

struct PermissionDeniedPayload: Codable {
    let toolName: String?
    let toolUseId: String?

    enum CodingKeys: String, CodingKey {
        case toolName = "tool_name"
        case toolUseId = "tool_use_id"
    }
}

struct CompactBoundaryPayload: Codable {
    let messageCount: Int?

    enum CodingKeys: String, CodingKey {
        case messageCount = "message_count"
    }
}

struct SystemStatusPayload: Codable {
    let status: String?
    let data: AnyCodable?
}

struct HookStartedPayload: Codable {
    let hookEvent: String?
    let hookId: String?
    let data: AnyCodable?
    let hookName: String?

    enum CodingKeys: String, CodingKey {
        case hookEvent = "hook_event"
        case hookId = "hook_id"
        case data
        case hookName = "hook_name"
    }
}

struct HookProgressPayload: Codable {
    let hookId: String?
    let data: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case hookId = "hook_id"
        case data
    }
}

struct HookResponsePayload: Codable {
    let hookId: String?
    let hookEvent: String?
    let outcome: String?
    let data: AnyCodable?
    let hookName: String?
    let stdout: String?

    enum CodingKeys: String, CodingKey {
        case hookId = "hook_id"
        case hookEvent = "hook_event"
        case outcome
        case data
        case hookName = "hook_name"
        case stdout
    }
}

struct HookCallbackPayload: Codable {
    let requestId: String?
    let hookEvent: String?
    let hookId: String?
    let hookName: String?
    let data: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case hookEvent = "hook_event"
        case hookId = "hook_id"
        case hookName = "hook_name"
        case data
    }
}

struct TaskNotificationPayload: Codable {
    let taskId: String?
    let status: String?
    let data: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case status
        case data
    }
}

struct ToolProgressPayload: Codable {
    let toolUseId: String?
    let elapsedTimeSeconds: Double?

    enum CodingKeys: String, CodingKey {
        case toolUseId = "tool_use_id"
        case elapsedTimeSeconds = "elapsed_time_seconds"
    }
}

struct ToolUseSummaryPayload: Codable {
    let toolUseId: String?
    let summary: String?
    let precedingToolUseIds: [String]?
    let data: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case toolUseId = "tool_use_id"
        case summary
        case precedingToolUseIds = "preceding_tool_use_ids"
        case data
    }
}

struct FilesPersistedPayload: Codable {
    let files: AnyCodable?
    let data: AnyCodable?
}

struct ControlCancelledPayload: Codable {
    let reason: String?
}

struct CommandOutputPayload: Codable {
    let content: String?
}

struct ElicitationPromptPayload: Codable {
    let requestId: String?
    let mcpServerName: String?
    let message: String?
    let elicitationId: String?
    let mode: String?
    let url: String?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case mcpServerName = "mcp_server_name"
        case message
        case elicitationId = "elicitation_id"
        case mode
        case url
    }
}

struct RateLimitEventPayload: Codable {
    let status: String?
    let resetsAt: Double?
    let rateLimitType: String?
    let utilization: Double?

    enum CodingKeys: String, CodingKey {
        case status
        case resetsAt = "resets_at"
        case rateLimitType = "rate_limit_type"
        case utilization
    }
}

struct AuthStatusPayload: Codable {
    let isAuthenticating: Bool?
    let output: [String]?
    let data: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case isAuthenticating = "is_authenticating"
        case output
        case data
    }
}

struct RalphStartedPayload: Codable {
    let taskId: String?

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
    }
}

struct RalphIterationPayload: Codable {
    let iteration: Int?
    let taskId: String?

    enum CodingKeys: String, CodingKey {
        case iteration
        case taskId = "task_id"
    }
}

struct RalphCompletePayload: Codable {
    let taskId: String?
    let result: String?

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case result
    }
}

struct RawPayload: Codable {
    let type: String
    let data: [String: AnyCodable]
}

// MARK: - Artifacts & Git

struct RunArtifacts: Codable {
    let taskId: String
    let filesChanged: [String]
    let diffSummary: String
    let commands: [String]
    let costEstimate: Double?
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case filesChanged = "files_changed"
        case diffSummary = "diff_summary"
        case commands
        case costEstimate = "cost_estimate"
        case updatedAt = "updated_at"
    }
}

struct GitStatus: Codable {
    let branch: String?
    let ahead: Int?
    let behind: Int?
    let dirty: Bool?
    let files: [GitFileStatus]?
}

struct GitFileStatus: Identifiable, Codable {
    let path: String
    let status: String

    var id: String { path }
}

struct GitDiff: Codable {
    let diff: String?
    let files: [String]?
}

// MARK: - AnyCodable (type-erased Codable)

struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }

    var stringValue: String? { value as? String }
    var intValue: Int? { value as? Int }
    var doubleValue: Double? { value as? Double }
    var boolValue: Bool? { value as? Bool }
    var arrayValue: [Any]? { value as? [Any] }
    var dictValue: [String: Any]? { value as? [String: Any] }
}

// MARK: - Dynamic Coding Key

struct DynamicKey: CodingKey {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = "\(intValue)"
        self.intValue = intValue
    }
}

// MARK: - WebSocket Messages

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

struct WSResponse: Codable {
    let id: String?
    let result: AnyCodable?
    let error: String?
    let event: String?
    let seq: Int?
    let runId: String?
    let payload: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case id
        case result
        case error
        case event
        case seq
        case runId = "run_id"
        case payload
    }
}
