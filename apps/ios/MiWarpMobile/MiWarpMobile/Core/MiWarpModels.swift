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
    case running
    case idle
    case waitingInput = "waiting_input"
    case waitingApproval = "waiting_approval"
    case completed
    case failed
    case stopped

    var displayLabel: String {
        switch self {
        case .running: return "Running"
        case .idle: return "Idle"
        case .waitingInput: return "Waiting Input"
        case .waitingApproval: return "Waiting Approval"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .stopped: return "Stopped"
        }
    }

    var systemImage: String {
        switch self {
        case .running: return "play.circle.fill"
        case .idle: return "moon.circle.fill"
        case .waitingInput: return "hand.raised.circle.fill"
        case .waitingApproval: return "exclamationmark.shield.fill"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .stopped: return "stop.circle.fill"
        }
    }
}

// MARK: - Run Source

enum RunSource: String, Codable {
    case cli
    case web
    case mobile
    case api
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
    var model: String
    var status: RunStatus
    var source: RunSource
    var messageCount: Int
    var lastActivity: Date?
    var hasApprovalPending: Bool
    var hasFilesChanged: Bool
    var hasArtifacts: Bool
    var createdAt: Date?

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

struct BusEvent: Identifiable, Codable {
    let seq: Int
    let runId: String
    let payload: BusEventPayload

    var id: Int { seq }

    enum CodingKeys: String, CodingKey {
        case seq
        case runId = "run_id"
        case payload
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
        case content
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
        case content
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
    let output: String?
    let isError: Bool?

    enum CodingKeys: String, CodingKey {
        case toolName = "tool_name"
        case toolUseId = "tool_use_id"
        case output
        case isError = "is_error"
    }
}

struct UserMessagePayload: Codable {
    let content: String?
    let role: String?
}

struct RunStatePayload: Codable {
    let status: RunStatus?
    let error: String?
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
        case costUsd = "cost_usd"
    }
}

struct ThinkingDeltaPayload: Codable {
    let delta: String?
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
    let toolInput: AnyCodable?
    let description: String?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case toolName = "tool_name"
        case toolInput = "tool_input"
        case description
    }
}

struct PermissionDeniedPayload: Codable {
    let requestId: String?
    let toolName: String?
    let reason: String?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case toolName = "tool_name"
        case reason
    }
}

struct CompactBoundaryPayload: Codable {
    let messageCount: Int?

    enum CodingKeys: String, CodingKey {
        case messageCount = "message_count"
    }
}

struct SystemStatusPayload: Codable {
    let message: String?
    let level: String?
}

struct HookStartedPayload: Codable {
    let hookName: String?
    let hookId: String?

    enum CodingKeys: String, CodingKey {
        case hookName = "hook_name"
        case hookId = "hook_id"
    }
}

struct HookProgressPayload: Codable {
    let hookId: String?
    let progress: Double?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case hookId = "hook_id"
        case progress
        case message
    }
}

struct HookResponsePayload: Codable {
    let hookId: String?
    let output: String?
    let success: Bool?

    enum CodingKeys: String, CodingKey {
        case hookId = "hook_id"
        case output
        case success
    }
}

struct HookCallbackPayload: Codable {
    let hookId: String?
    let callbackType: String?

    enum CodingKeys: String, CodingKey {
        case hookId = "hook_id"
        case callbackType = "callback_type"
    }
}

struct TaskNotificationPayload: Codable {
    let title: String?
    let body: String?
    let level: String?
}

struct ToolProgressPayload: Codable {
    let toolUseId: String?
    let progress: Double?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case toolUseId = "tool_use_id"
        case progress
        case message
    }
}

struct ToolUseSummaryPayload: Codable {
    let toolName: String?
    let durationMs: Int?
    let summary: String?

    enum CodingKeys: String, CodingKey {
        case toolName = "tool_name"
        case durationMs = "duration_ms"
        case summary
    }
}

struct FilesPersistedPayload: Codable {
    let files: [String]?
}

struct ControlCancelledPayload: Codable {
    let reason: String?
}

struct CommandOutputPayload: Codable {
    let command: String?
    let output: String?
    let exitCode: Int?

    enum CodingKeys: String, CodingKey {
        case command
        case output
        case exitCode = "exit_code"
    }
}

struct ElicitationPromptPayload: Codable {
    let prompt: String?
    let options: [String]?
}

struct RateLimitEventPayload: Codable {
    let retryAfter: Double?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case retryAfter = "retry_after"
        case message
    }
}

struct AuthStatusPayload: Codable {
    let authenticated: Bool?
    let provider: String?
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
    let filesChanged: [ArtifactFile]?
    let diffSummary: String?
    let commands: [String]?
    let costEstimate: Double?

    enum CodingKeys: String, CodingKey {
        case filesChanged = "files_changed"
        case diffSummary = "diff_summary"
        case commands
        case costEstimate = "cost_estimate"
    }
}

struct ArtifactFile: Identifiable, Codable {
    let path: String
    let status: FileChangeStatus
    let additions: Int?
    let deletions: Int?

    var id: String { path }
}

enum FileChangeStatus: String, Codable {
    case added
    case modified
    case deleted
    case renamed
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
