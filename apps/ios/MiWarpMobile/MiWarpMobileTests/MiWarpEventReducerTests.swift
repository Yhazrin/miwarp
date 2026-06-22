import XCTest
@testable import MiWarpMobile

@MainActor
final class MiWarpEventReducerTests: XCTestCase {

    private var reducer: MiWarpEventReducer!

    override func setUp() {
        reducer = MiWarpEventReducer()
    }

    // MARK: - Dedup

    func testDuplicateSeqIsIgnored() {
        let event = BusEvent(seq: 1, runId: "r1", payload: .userMessage(UserMessagePayload(content: "hello", role: "user")))
        reducer.processEvent(event)
        reducer.processEvent(event) // duplicate
        XCTAssertEqual(reducer.messages.count, 1)
    }

    func testDifferentSeqsAreProcessed() {
        let e1 = BusEvent(seq: 1, runId: "r1", payload: .userMessage(UserMessagePayload(content: "a", role: "user")))
        let e2 = BusEvent(seq: 2, runId: "r1", payload: .userMessage(UserMessagePayload(content: "b", role: "user")))
        reducer.processEvent(e1)
        reducer.processEvent(e2)
        XCTAssertEqual(reducer.messages.count, 2)
    }

    // MARK: - User Message

    func testUserMessageCreatesMessage() {
        let event = BusEvent(seq: 1, runId: "r1", payload: .userMessage(UserMessagePayload(content: "hello", role: "user")))
        reducer.processEvent(event)
        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].role, .user)
        XCTAssertEqual(reducer.messages[0].content, "hello")
    }

    func testUserMessageNilContentIsSkipped() {
        let event = BusEvent(seq: 1, runId: "r1", payload: .userMessage(UserMessagePayload(content: nil, role: "user")))
        reducer.processEvent(event)
        XCTAssertEqual(reducer.messages.count, 0)
    }

    // MARK: - Streaming (messageDelta + messageComplete)

    func testStreamingMessageAccumulation() {
        let msgId = "msg-1"
        let d1 = BusEvent(seq: 1, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "Hello", messageId: msgId)))
        let d2 = BusEvent(seq: 2, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: " world", messageId: msgId)))
        let d3 = BusEvent(seq: 3, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "!", messageId: msgId)))

        reducer.processEvent(d1)
        reducer.processEvent(d2)
        reducer.processEvent(d3)

        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].content, "Hello world!")
        XCTAssertTrue(reducer.messages[0].isStreaming)
    }

    func testMessageCompleteFinalizesContent() {
        let msgId = "msg-1"
        let delta = BusEvent(seq: 1, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "partial", messageId: msgId)))
        let complete = BusEvent(seq: 2, runId: "r1", payload: .messageComplete(MessageCompletePayload(role: "assistant", content: "final content", messageId: msgId)))

        reducer.processEvent(delta)
        reducer.processEvent(complete)

        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].content, "final content")
        XCTAssertFalse(reducer.messages[0].isStreaming)
    }

    func testMessageCompleteWithoutContentKeepsAccumulated() {
        let msgId = "msg-1"
        let delta = BusEvent(seq: 1, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "accumulated", messageId: msgId)))
        let complete = BusEvent(seq: 2, runId: "r1", payload: .messageComplete(MessageCompletePayload(role: "assistant", content: nil, messageId: msgId)))

        reducer.processEvent(delta)
        reducer.processEvent(complete)

        XCTAssertEqual(reducer.messages[0].content, "accumulated")
        XCTAssertFalse(reducer.messages[0].isStreaming)
    }

    // MARK: - Tool Lifecycle

    func testToolStartAttachesToLastAssistantMessage() {
        // Create assistant message first
        let delta = BusEvent(seq: 1, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "thinking", messageId: "msg-1")))
        reducer.processEvent(delta)

        let toolStart = BusEvent(seq: 2, runId: "r1", payload: .toolStart(ToolStartPayload(toolName: "bash", toolUseId: "tool-1", input: nil)))
        reducer.processEvent(toolStart)

        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].toolCalls.count, 1)
        XCTAssertEqual(reducer.messages[0].toolCalls[0].toolName, "bash")
        XCTAssertFalse(reducer.messages[0].toolCalls[0].isComplete)
    }

    func testToolEndMarksComplete() {
        let delta = BusEvent(seq: 1, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "text", messageId: "msg-1")))
        let toolStart = BusEvent(seq: 2, runId: "r1", payload: .toolStart(ToolStartPayload(toolName: "bash", toolUseId: "tool-1", input: nil)))
        let toolEnd = BusEvent(seq: 3, runId: "r1", payload: .toolEnd(ToolEndPayload(toolName: "bash", toolUseId: "tool-1", output: AnyCodable("done"), status: "success")))

        reducer.processEvent(delta)
        reducer.processEvent(toolStart)
        reducer.processEvent(toolEnd)

        XCTAssertEqual(reducer.messages[0].toolCalls[0].isComplete, true)
        XCTAssertEqual(reducer.messages[0].toolCalls[0].isError, false)
    }

    func testToolEndWithErrorFlag() {
        let delta = BusEvent(seq: 1, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "text", messageId: "msg-1")))
        let toolStart = BusEvent(seq: 2, runId: "r1", payload: .toolStart(ToolStartPayload(toolName: "bash", toolUseId: "tool-1", input: nil)))
        let toolEnd = BusEvent(seq: 3, runId: "r1", payload: .toolEnd(ToolEndPayload(toolName: "bash", toolUseId: "tool-1", output: AnyCodable("error"), status: "error")))

        reducer.processEvent(delta)
        reducer.processEvent(toolStart)
        reducer.processEvent(toolEnd)

        XCTAssertEqual(reducer.messages[0].toolCalls[0].isError, true)
    }

    func testToolStartWithoutAssistantMessageCreatesNew() {
        let toolStart = BusEvent(seq: 1, runId: "r1", payload: .toolStart(ToolStartPayload(toolName: "read", toolUseId: "tool-1", input: nil)))
        reducer.processEvent(toolStart)

        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].role, .assistant)
        XCTAssertEqual(reducer.messages[0].toolCalls.count, 1)
    }

    func testToolDeltaAndEndUpdateTheIndexedToolAcrossMultipleMessages() {
        reducer.processEvent(BusEvent(
            seq: 1,
            runId: "r1",
            payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "first", messageId: "msg-1"))
        ))
        reducer.processEvent(BusEvent(
            seq: 2,
            runId: "r1",
            payload: .toolStart(ToolStartPayload(toolName: "bash", toolUseId: "tool-1", input: nil))
        ))
        reducer.processEvent(BusEvent(
            seq: 3,
            runId: "r1",
            payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "second", messageId: "msg-2"))
        ))
        reducer.processEvent(BusEvent(
            seq: 4,
            runId: "r1",
            payload: .toolStart(ToolStartPayload(toolName: "read", toolUseId: "tool-2", input: nil))
        ))
        reducer.processEvent(BusEvent(
            seq: 5,
            runId: "r1",
            payload: .toolInputDelta(ToolInputDeltaPayload(toolUseId: "tool-1", partialJson: "{\"command\":"))
        ))
        reducer.processEvent(BusEvent(
            seq: 6,
            runId: "r1",
            payload: .toolEnd(ToolEndPayload(toolName: "bash", toolUseId: "tool-1", output: AnyCodable("done"), status: "success"))
        ))

        XCTAssertEqual(reducer.messages[0].toolCalls[0].inputPreview, "{\"command\":")
        XCTAssertEqual(reducer.messages[0].toolCalls[0].output, "done")
        XCTAssertTrue(reducer.messages[0].toolCalls[0].isComplete)
        XCTAssertFalse(reducer.messages[1].toolCalls[0].isComplete)
    }

    // MARK: - Usage Accumulation

    func testUsageTokensAccumulate() {
        let u1 = BusEvent(seq: 1, runId: "r1", payload: .usageUpdate(UsageUpdatePayload(inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, costUsd: 0.01)))
        let u2 = BusEvent(seq: 2, runId: "r1", payload: .usageUpdate(UsageUpdatePayload(inputTokens: 200, outputTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 10, costUsd: 0.02)))

        reducer.processEvent(u1)
        reducer.processEvent(u2)

        XCTAssertEqual(reducer.usage.inputTokens, 300)
        XCTAssertEqual(reducer.usage.outputTokens, 130)
        XCTAssertEqual(reducer.usage.cacheReadTokens, 30)
        XCTAssertEqual(reducer.usage.cacheWriteTokens, 15)
        XCTAssertEqual(reducer.usage.costUsd, 0.03, accuracy: 0.001)
    }

    // MARK: - Run State

    func testRunStateUpdatesStatus() {
        let event = BusEvent(seq: 1, runId: "r1", payload: .runState(RunStatePayload(status: .running, error: nil)))
        reducer.processEvent(event)
        XCTAssertEqual(reducer.currentStatus, .running)
    }

    // MARK: - Permission Lifecycle

    func testPermissionPromptAddsToPending() {
        let event = BusEvent(seq: 1, runId: "r1", payload: .permissionPrompt(PermissionPromptPayload(requestId: "req-1", toolName: "bash", toolUseId: "tool-1", toolInput: nil, description: "Run command?")))
        reducer.processEvent(event, runId: "r1")

        XCTAssertEqual(reducer.pendingPermissions.count, 1)
        XCTAssertEqual(reducer.pendingPermissions[0].toolName, "bash")
        XCTAssertEqual(reducer.currentStatus, .waitingApproval)
    }

    func testPermissionDeniedRemovesFromPending() {
        let prompt = BusEvent(seq: 1, runId: "r1", payload: .permissionPrompt(PermissionPromptPayload(requestId: "req-1", toolName: "bash", toolUseId: "tool-1", toolInput: nil, description: nil)))
        let deny = BusEvent(seq: 2, runId: "r1", payload: .permissionDenied(PermissionDeniedPayload(toolName: nil, toolUseId: "tool-1")))

        reducer.processEvent(prompt, runId: "r1")
        XCTAssertEqual(reducer.pendingPermissions.count, 1)

        reducer.processEvent(deny)
        XCTAssertEqual(reducer.pendingPermissions.count, 0)
        XCTAssertEqual(reducer.currentStatus, .running)
    }

    // MARK: - Thinking Delta

    func testThinkingDeltaAppendsToLastAssistant() {
        let delta = BusEvent(seq: 1, runId: "r1", payload: .messageDelta(MessageDeltaPayload(role: "assistant", content: nil, delta: "text", messageId: "msg-1")))
        let think1 = BusEvent(seq: 2, runId: "r1", payload: .thinkingDelta(ThinkingDeltaPayload(text: "considering ")))
        let think2 = BusEvent(seq: 3, runId: "r1", payload: .thinkingDelta(ThinkingDeltaPayload(text: "options...")))

        reducer.processEvent(delta)
        reducer.processEvent(think1)
        reducer.processEvent(think2)

        XCTAssertEqual(reducer.messages[0].thinking, "considering options...")
    }

    // MARK: - System Status

    func testSystemStatusCreatesSystemMessage() {
        let event = BusEvent(seq: 1, runId: "r1", payload: .systemStatus(SystemStatusPayload(status: "Session started", data: nil)))
        reducer.processEvent(event)

        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].role, .system)
        XCTAssertEqual(reducer.messages[0].content, "Session started")
    }

    // MARK: - Command Output

    func testCommandOutputCreatesSystemMessage() {
        let event = BusEvent(seq: 1, runId: "r1", payload: .commandOutput(CommandOutputPayload(content: "build succeeded")))
        reducer.processEvent(event)

        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].role, .system)
        XCTAssertEqual(reducer.messages[0].content, "build succeeded")
    }

    // MARK: - loadHistory

    func testLoadHistoryOrdersBySeq() {
        let e1 = BusEvent(seq: 3, runId: "r1", payload: .userMessage(UserMessagePayload(content: "third", role: "user")))
        let e2 = BusEvent(seq: 1, runId: "r1", payload: .userMessage(UserMessagePayload(content: "first", role: "user")))
        let e3 = BusEvent(seq: 2, runId: "r1", payload: .userMessage(UserMessagePayload(content: "second", role: "user")))

        reducer.loadHistory([e1, e2, e3])

        XCTAssertEqual(reducer.messages.count, 3)
        XCTAssertEqual(reducer.messages[0].content, "first")
        XCTAssertEqual(reducer.messages[1].content, "second")
        XCTAssertEqual(reducer.messages[2].content, "third")
    }

    func testLoadHistoryResetsState() {
        // First load some data
        let e1 = BusEvent(seq: 1, runId: "r1", payload: .userMessage(UserMessagePayload(content: "old", role: "user")))
        reducer.processEvent(e1)
        XCTAssertEqual(reducer.messages.count, 1)

        // loadHistory should reset
        let e2 = BusEvent(seq: 1, runId: "r2", payload: .userMessage(UserMessagePayload(content: "new", role: "user")))
        reducer.loadHistory([e2])

        XCTAssertEqual(reducer.messages.count, 1)
        XCTAssertEqual(reducer.messages[0].content, "new")
    }

    // MARK: - Reset

    func testResetClearsAllState() {
        let e1 = BusEvent(seq: 1, runId: "r1", payload: .userMessage(UserMessagePayload(content: "hello", role: "user")))
        let u1 = BusEvent(seq: 2, runId: "r1", payload: .usageUpdate(UsageUpdatePayload(inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01)))
        reducer.processEvent(e1)
        reducer.processEvent(u1)

        reducer.reset()

        XCTAssertTrue(reducer.messages.isEmpty)
        XCTAssertEqual(reducer.usage.inputTokens, 0)
        XCTAssertEqual(reducer.lastSeq, 0)
        XCTAssertNil(reducer.streamingMessageId)
    }

    // MARK: - seenSeqs Cap

    func testSeenSeqsCapDoesNotCrash() {
        // Send 8200 distinct events to trigger cap
        for i in 1...8200 {
            let event = BusEvent(seq: i, runId: "r1", payload: .runState(RunStatePayload(status: .running, error: nil)))
            reducer.processEvent(event)
        }
        // Should not crash, and lastSeq should be 8200
        XCTAssertEqual(reducer.lastSeq, 8200)
    }

    // MARK: - removePermission

    func testRemovePermissionById() {
        let prompt = BusEvent(seq: 1, runId: "r1", payload: .permissionPrompt(PermissionPromptPayload(requestId: "req-1", toolName: "bash", toolUseId: "tool-1", toolInput: nil, description: nil)))
        reducer.processEvent(prompt, runId: "r1")
        XCTAssertEqual(reducer.pendingPermissions.count, 1)

        reducer.removePermission(requestId: "req-1")
        XCTAssertEqual(reducer.pendingPermissions.count, 0)
    }

    // MARK: - Protocol Recovery

    func testSessionRecoveringSetsBanner() {
        let event = BusEvent(
            seq: 1,
            runId: "r1",
            payload: .sessionRecovering(SessionRecoveringPayload(reason: "internal_hard_timeout", deadlineMs: 5000, fromInternal: true))
        )
        reducer.processEvent(event)

        XCTAssertTrue(reducer.protocolRecovery.isRecovering)
        XCTAssertFalse(reducer.protocolRecovery.showReloadAction)
        XCTAssertNotNil(reducer.protocolRecovery.notice)
    }

    func testSessionRecoveredOkClearsBanner() {
        reducer.processEvent(BusEvent(
            seq: 1,
            runId: "r1",
            payload: .sessionRecovering(SessionRecoveringPayload(reason: "user_hard_timeout", deadlineMs: 5000, fromInternal: false))
        ))
        reducer.processEvent(BusEvent(
            seq: 2,
            runId: "r1",
            payload: .sessionRecovered(SessionRecoveredPayload(ok: true))
        ))

        XCTAssertFalse(reducer.protocolRecovery.isRecovering)
        XCTAssertNil(reducer.protocolRecovery.notice)
    }

    func testSessionRecoveredFailureOffersReload() {
        reducer.processEvent(BusEvent(
            seq: 1,
            runId: "r1",
            payload: .sessionRecovered(SessionRecoveredPayload(ok: false))
        ))

        XCTAssertTrue(reducer.protocolRecovery.showReloadAction)
        XCTAssertEqual(reducer.currentStatus, .failed)
    }

    func testProtocolDesyncOffersReloadAndFailsRun() {
        reducer.processEvent(BusEvent(
            seq: 1,
            runId: "r1",
            payload: .protocolDesync(ProtocolDesyncPayload(failCount: 5, sample: "{bad json"))
        ))

        XCTAssertTrue(reducer.protocolRecovery.showReloadAction)
        XCTAssertEqual(reducer.currentStatus, .failed)
    }

    func testBusEventPayloadDecodesSessionRecoveringFromJSON() throws {
        let json = """
        {
          "type": "session_recovering",
          "run_id": "run-1",
          "reason": "internal_hard_timeout",
          "deadline_ms": 5000,
          "from_internal": true
        }
        """.data(using: .utf8)!

        let payload = try JSONDecoder().decode(BusEventPayload.self, from: json)
        guard case .sessionRecovering(let decoded) = payload else {
            return XCTFail("Expected sessionRecovering payload")
        }
        XCTAssertEqual(decoded.reason, "internal_hard_timeout")
        XCTAssertEqual(decoded.deadlineMs, 5000)
        XCTAssertEqual(decoded.fromInternal, true)
    }

    // MARK: - WebSocket decoding

    func testWSResponseDecodesBusEventPayloadDirectly() throws {
        let json = """
        {
          "event": "bus-event",
          "seq": 12,
          "run_id": "run-1",
          "payload": {
            "type": "user_message",
            "text": "hello",
            "role": "user"
          }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(WSResponse.self, from: json)

        XCTAssertNil(response.payload)
        guard case .userMessage(let payload) = response.busEventPayload else {
            return XCTFail("Expected directly decoded user_message payload")
        }
        XCTAssertEqual(payload.content, "hello")
    }
}

// MARK: - Helper to pass runId for permission events

extension MiWarpEventReducer {
    func processEvent(_ event: BusEvent, runId: String) {
        // Permission events need runId from the bus event wrapper
        // In production, this comes from the WSResponse. For tests, we use the event's own runId.
        processEvent(event)
    }
}
