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

// MARK: - Event Reducer

@MainActor
final class MiWarpEventReducer: ObservableObject {
    @Published private(set) var messages: [DisplayMessage] = []
    @Published private(set) var pendingPermissions: [PendingPermission] = []
    @Published private(set) var usage: UsageSummary = UsageSummary()
    @Published private(set) var currentStatus: RunStatus = .idle
    @Published private(set) var lastSeq: Int = 0
    @Published private(set) var streamingMessageId: String?

    private var seenSeqs: Set<Int> = []
    private var messageAccumulator: [String: String] = [:] // messageId -> accumulated text

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

        case .commandOutput(let payload):
            handleCommandOutput(payload)

        case .sessionInit:
            break

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
        lastSeq = 0
        seenSeqs.removeAll()
        messageAccumulator.removeAll()
        streamingMessageId = nil
    }

    // MARK: - Handlers

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
        let msgId = payload.messageId ?? "streaming"
        let delta = payload.delta ?? payload.content ?? ""

        if streamingMessageId == msgId {
            // Append to existing streaming message
            if let index = messages.lastIndex(where: { $0.id == msgId }) {
                messages[index].content += delta
            }
        } else {
            // Start new streaming message
            streamingMessageId = msgId
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

        messageAccumulator[msgId, default: ""] += delta
    }

    private func handleMessageComplete(_ payload: MessageCompletePayload) {
        let msgId = payload.messageId ?? "streaming"
        if let index = messages.lastIndex(where: { $0.id == msgId }) {
            messages[index].isStreaming = false
            if let content = payload.content {
                messages[index].content = content
            }
        }
        streamingMessageId = nil
        messageAccumulator.removeValue(forKey: msgId)
    }

    private func handleToolStart(_ payload: ToolStartPayload) {
        guard let toolName = payload.toolName else { return }
        let toolId = payload.toolUseId ?? UUID().uuidString

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

        for msgIndex in messages.indices {
            if let toolIndex = messages[msgIndex].toolCalls.firstIndex(where: { $0.id == toolId }) {
                messages[msgIndex].toolCalls[toolIndex].output = outputString
                messages[msgIndex].toolCalls[toolIndex].isComplete = true
                messages[msgIndex].toolCalls[toolIndex].isError = payload.status != "success"
                break
            }
        }
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
