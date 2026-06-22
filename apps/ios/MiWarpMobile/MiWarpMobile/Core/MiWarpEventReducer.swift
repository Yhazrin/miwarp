import Foundation

// MARK: - Display Message

struct DisplayMessage: Identifiable {
    let id: String
    var role: MessageRole
    var content: String
    var timestamp: Date
    var isStreaming: Bool
    var toolCalls: [DisplayToolCall]
    var thinking: String?

    enum MessageRole {
        case user
        case assistant
        case system
    }
}

// MARK: - Display Tool Call

struct DisplayToolCall: Identifiable {
    let id: String
    let toolName: String
    var inputPreview: String?
    var output: String?
    var isComplete: Bool
    var isError: Bool
    var isExpanded: Bool
}

// MARK: - Permission Request

struct PendingPermission: Identifiable {
    let id: String // requestId
    let runId: String
    let toolName: String
    let toolUseId: String
    let toolInput: AnyCodable?
    let description: String?
}

// MARK: - Usage Summary

struct UsageSummary {
    var inputTokens: Int = 0
    var outputTokens: Int = 0
    var cacheReadTokens: Int = 0
    var cacheWriteTokens: Int = 0
    var costUsd: Double = 0
}

// MARK: - Protocol Recovery State

struct ProtocolRecoveryState: Equatable {
    var notice: String?
    var isRecovering: Bool = false
    var showReloadAction: Bool = false
}

// MARK: - Event Reducer

@Observable
@MainActor
final class MiWarpEventReducer {
    private(set) var messages: [DisplayMessage] = []
    private(set) var pendingPermissions: [PendingPermission] = []
    private(set) var usage: UsageSummary = UsageSummary()
    private(set) var currentStatus: RunStatus = .idle
    private(set) var sessionAgent: String?
    private(set) var sessionModel: String?
    private(set) var lastSeq: Int = 0
    private(set) var streamingMessageId: String?
    private(set) var protocolRecovery = ProtocolRecoveryState()
    /// Tracks all in-flight streaming message IDs so handleMessageComplete can find them.
    private var pendingStreamingIds: Set<String> = []

    private struct ToolLocation {
        let messageIndex: Int
        let toolIndex: Int
    }

    /// Steady-state O(1) lookup for tool delta/end events in long conversations.
    private var toolLocations: [String: ToolLocation] = [:]
    private var seenSeqs: Set<Int> = []

    // MARK: - Process Event

    func processEvent(_ event: BusEvent) {
        // Dedup
        guard !seenSeqs.contains(event.seq) else { return }
        seenSeqs.insert(event.seq)
        lastSeq = max(lastSeq, event.seq)

        // Cap seenSeqs to prevent unbounded growth
        if seenSeqs.count > 8192 {
            seenSeqs = Set(seenSeqs.filter { $0 > lastSeq - 8192 })
        }

        switch event.payload {
        case .userMessage(let payload):
            handleUserMessage(payload)

        case .messageDelta(let payload):
            handleMessageDelta(payload)

        case .messageComplete(let payload):
            handleMessageComplete(payload)

        case .toolStart(let payload):
            handleToolStart(payload)

        case .toolEnd(let payload):
            handleToolEnd(payload)

        case .runState(let payload):
            handleRunState(payload)

        case .usageUpdate(let payload):
            handleUsageUpdate(payload)

        case .thinkingDelta(let payload):
            handleThinkingDelta(payload)

        case .permissionPrompt(let payload):
            handlePermissionPrompt(payload, runId: event.runId)

        case .permissionDenied(let payload):
            handlePermissionDenied(payload)

        case .systemStatus(let payload):
            handleSystemStatus(payload)

        case .toolInputDelta(let payload):
            handleToolInputDelta(payload)

        case .commandOutput(let payload):
            handleCommandOutput(payload)

        case .sessionInit(let payload):
            handleSessionInit(payload)

        case .sessionRecovering(let payload):
            handleSessionRecovering(payload)

        case .sessionRecovered(let payload):
            handleSessionRecovered(payload)

        case .protocolDesync(let payload):
            handleProtocolDesync(payload)

        case .fullReload:
            // Server requests full state reset — clear and re-fetch
            reset()

        default:
            break
        }
    }

    // MARK: - Load History

    func loadHistory(_ events: [BusEvent]) {
        reset()
        for event in events.sorted(by: { $0.seq < $1.seq }) {
            processEvent(event)
        }
    }

    func reset() {
        messages.removeAll()
        pendingPermissions.removeAll()
        usage = UsageSummary()
        currentStatus = .idle
        sessionAgent = nil
        sessionModel = nil
        lastSeq = 0
        seenSeqs.removeAll()
        streamingMessageId = nil
        pendingStreamingIds.removeAll()
        toolLocations.removeAll()
        protocolRecovery = ProtocolRecoveryState()
    }

    // MARK: - Handlers

    private func handleSessionInit(_ payload: SessionInitPayload) {
        sessionAgent = payload.agent
        sessionModel = payload.model
    }

    private func handleSessionRecovering(_ payload: SessionRecoveringPayload) {
        let seconds = max(1, Int((payload.deadlineMs ?? 5000) / 1000))
        protocolRecovery = ProtocolRecoveryState(
            notice: String(format: String(localized: "protocol.sessionRecovering"), seconds),
            isRecovering: true,
            showReloadAction: false
        )
    }

    private func handleSessionRecovered(_ payload: SessionRecoveredPayload) {
        if payload.ok == true {
            protocolRecovery = ProtocolRecoveryState()
            return
        }

        protocolRecovery = ProtocolRecoveryState(
            notice: String(localized: "protocol.sessionRecoveryFailed"),
            isRecovering: false,
            showReloadAction: true
        )
        currentStatus = .failed
    }

    private func handleProtocolDesync(_ payload: ProtocolDesyncPayload) {
        _ = payload
        protocolRecovery = ProtocolRecoveryState(
            notice: String(localized: "protocol.desyncToast"),
            isRecovering: false,
            showReloadAction: true
        )
        currentStatus = .failed
    }

    func clearProtocolRecoveryNotice() {
        protocolRecovery.notice = nil
        protocolRecovery.showReloadAction = false
    }

    private func handleUserMessage(_ payload: UserMessagePayload) {
        guard let content = payload.content else { return }
        let msg = DisplayMessage(
            id: "user-\(lastSeq)",
            role: .user,
            content: content,
            timestamp: Date(),
            isStreaming: false,
            toolCalls: []
        )
        messages.append(msg)
    }

    private func handleMessageDelta(_ payload: MessageDeltaPayload) {
        // Use provided messageId, or generate a UUID — never a static string that collides across messages.
        let msgId = payload.messageId ?? UUID().uuidString
        let delta = payload.delta ?? payload.content ?? ""

        if streamingMessageId == msgId {
            // Append to existing streaming message
            if let index = messages.lastIndex(where: { $0.id == msgId }) {
                messages[index].content += delta
            }
        } else {
            // Start new streaming message
            streamingMessageId = msgId
            pendingStreamingIds.insert(msgId)
            let msg = DisplayMessage(
                id: msgId,
                role: .assistant,
                content: delta,
                timestamp: Date(),
                isStreaming: true,
                toolCalls: []
            )
            messages.append(msg)
        }

    }

    private func handleMessageComplete(_ payload: MessageCompletePayload) {
        let msgId: String?
        if let id = payload.messageId {
            msgId = id
        } else if let current = streamingMessageId, pendingStreamingIds.contains(current) {
            msgId = current
        } else {
            msgId = nil
        }
        guard let id = msgId else { return }
        if let index = messages.lastIndex(where: { $0.id == id }) {
            messages[index].isStreaming = false
            if let content = payload.content {
                messages[index].content = content
            }
        }
        pendingStreamingIds.remove(id)
        streamingMessageId = pendingStreamingIds.first
    }

    private func handleToolStart(_ payload: ToolStartPayload) {
        guard let toolName = payload.toolName else { return }
        let toolId = payload.toolUseId ?? UUID().uuidString

        // Skip if this toolUseId is already present (prevents duplicate IDs from retried events).
        if findToolLocation(toolId) != nil { return }

        var inputPreview: String?
        if let input = payload.input {
            if let dict = input.dictValue {
                if let data = try? JSONSerialization.data(withJSONObject: dict, options: .fragmentsAllowed),
                   let str = String(data: data, encoding: .utf8) {
                    inputPreview = String(str.prefix(200))
                }
            } else if let str = input.stringValue {
                inputPreview = String(str.prefix(200))
            }
        }

        let toolCall = DisplayToolCall(
            id: toolId,
            toolName: toolName,
            inputPreview: inputPreview,
            output: nil,
            isComplete: false,
            isError: false,
            isExpanded: false
        )

        // Attach to last assistant message or create new one
        if let lastIndex = messages.indices.last, messages[lastIndex].role == .assistant {
            messages[lastIndex].toolCalls.append(toolCall)
            toolLocations[toolId] = ToolLocation(
                messageIndex: lastIndex,
                toolIndex: messages[lastIndex].toolCalls.count - 1
            )
        } else {
            let msg = DisplayMessage(
                id: "tool-\(toolId)",
                role: .assistant,
                content: "",
                timestamp: Date(),
                isStreaming: false,
                toolCalls: [toolCall]
            )
            messages.append(msg)
            toolLocations[toolId] = ToolLocation(
                messageIndex: messages.count - 1,
                toolIndex: 0
            )
        }
    }

    private func handleToolEnd(_ payload: ToolEndPayload) {
        guard let toolId = payload.toolUseId else { return }
        let outputString: String? = {
            guard let output = payload.output else { return nil }
            if let str = output.stringValue { return str }
            if let dict = output.dictValue,
               let data = try? JSONSerialization.data(withJSONObject: dict, options: [.fragmentsAllowed, .sortedKeys]),
               let str = String(data: data, encoding: .utf8) {
                return str
            }
            if let arr = output.arrayValue,
               let data = try? JSONSerialization.data(withJSONObject: arr, options: [.fragmentsAllowed, .sortedKeys]),
               let str = String(data: data, encoding: .utf8) {
                return str
            }
            return nil
        }()

        guard let location = findToolLocation(toolId) else { return }
        messages[location.messageIndex].toolCalls[location.toolIndex].output = outputString
        messages[location.messageIndex].toolCalls[location.toolIndex].isComplete = true
        messages[location.messageIndex].toolCalls[location.toolIndex].isError = payload.status != "success"
    }

    private func handleRunState(_ payload: RunStatePayload) {
        if let status = payload.status {
            currentStatus = status
        }
    }

    private func handleUsageUpdate(_ payload: UsageUpdatePayload) {
        usage.inputTokens += payload.inputTokens ?? 0
        usage.outputTokens += payload.outputTokens ?? 0
        usage.cacheReadTokens += payload.cacheReadTokens ?? 0
        usage.cacheWriteTokens += payload.cacheWriteTokens ?? 0
        if let cost = payload.costUsd {
            usage.costUsd += cost
        }
    }

    private func handleThinkingDelta(_ payload: ThinkingDeltaPayload) {
        guard let text = payload.text else { return }
        if let lastIndex = messages.indices.last, messages[lastIndex].role == .assistant {
            messages[lastIndex].thinking = (messages[lastIndex].thinking ?? "") + text
        }
    }

    private func handlePermissionPrompt(_ payload: PermissionPromptPayload, runId: String) {
        guard let requestId = payload.requestId, let toolName = payload.toolName else { return }
        let permission = PendingPermission(
            id: requestId,
            runId: runId,
            toolName: toolName,
            toolUseId: payload.toolUseId ?? "",
            toolInput: payload.toolInput,
            description: payload.description
        )
        pendingPermissions.append(permission)
        currentStatus = .waitingApproval
    }

    private func handlePermissionDenied(_ payload: PermissionDeniedPayload) {
        if let toolUseId = payload.toolUseId, !toolUseId.isEmpty {
            pendingPermissions.removeAll { $0.toolUseId == toolUseId }
        } else if let toolName = payload.toolName {
            pendingPermissions.removeAll { $0.toolName == toolName }
        }
        if pendingPermissions.isEmpty { currentStatus = .running }
    }

    private func handleSystemStatus(_ payload: SystemStatusPayload) {
        guard let status = payload.status, !status.isEmpty else { return }
        let msg = DisplayMessage(
            id: "system-\(lastSeq)",
            role: .system,
            content: status,
            timestamp: Date(),
            isStreaming: false,
            toolCalls: []
        )
        messages.append(msg)
    }

    private func handleToolInputDelta(_ payload: ToolInputDeltaPayload) {
        guard
            let toolId = payload.toolUseId,
            let delta = payload.partialJson,
            let location = findToolLocation(toolId)
        else { return }

        messages[location.messageIndex].toolCalls[location.toolIndex].inputPreview =
            (messages[location.messageIndex].toolCalls[location.toolIndex].inputPreview ?? "") + delta
    }

    private func findToolLocation(_ toolId: String) -> ToolLocation? {
        if let cached = toolLocations[toolId],
           messages.indices.contains(cached.messageIndex),
           messages[cached.messageIndex].toolCalls.indices.contains(cached.toolIndex),
           messages[cached.messageIndex].toolCalls[cached.toolIndex].id == toolId {
            return cached
        }

        // Defensive fallback keeps behavior correct if future code mutates message ordering.
        for messageIndex in messages.indices {
            if let toolIndex = messages[messageIndex].toolCalls.firstIndex(where: { $0.id == toolId }) {
                let location = ToolLocation(messageIndex: messageIndex, toolIndex: toolIndex)
                toolLocations[toolId] = location
                return location
            }
        }
        toolLocations.removeValue(forKey: toolId)
        return nil
    }

    private func handleCommandOutput(_ payload: CommandOutputPayload) {
        guard let content = payload.content, !content.isEmpty else { return }
        let msg = DisplayMessage(
            id: "cmdout-\(lastSeq)",
            role: .system,
            content: content,
            timestamp: Date(),
            isStreaming: false,
            toolCalls: []
        )
        messages.append(msg)
    }

    // MARK: - Remove Permission

    func removePermission(requestId: String) {
        pendingPermissions.removeAll { $0.id == requestId }
    }
}
