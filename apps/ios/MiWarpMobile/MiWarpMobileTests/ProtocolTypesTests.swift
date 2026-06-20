import XCTest
@testable import MiWarpMobile

final class ProtocolTypesTests: XCTestCase {

    // MARK: - WSResponse decoding

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

        XCTAssertEqual(response.event, WSEventName.busEvent)
        XCTAssertEqual(response.seq, 12)
        XCTAssertEqual(response.runId, "run-1")
        XCTAssertNil(response.payload)
        guard case .userMessage(let payload) = response.busEventPayload else {
            return XCTFail("Expected directly decoded user_message payload")
        }
        XCTAssertEqual(payload.content, "hello")
    }

    func testWSResponseWithUnknownPayloadFallsBackToRaw() throws {
        let json = """
        {
          "event": "bus-event",
          "seq": 7,
          "run_id": "run-1",
          "payload": {
            "type": "future_event_type",
            "data": "raw"
          }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(WSResponse.self, from: json)

        // Unknown event types are decoded into the `.raw` payload case so
        // callers can introspect them without losing the original JSON shape.
        XCTAssertNil(response.payload)
        guard case .raw(let raw) = response.busEventPayload else {
            return XCTFail("Expected .raw payload for unknown event type")
        }
        XCTAssertEqual(raw.type, "future_event_type")
    }

    func testWSResponseForNonBusEventKeepsPayloadAsAnyCodable() throws {
        let json = """
        {
          "id": "abc",
          "result": { "ok": true }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(WSResponse.self, from: json)

        XCTAssertEqual(response.id, "abc")
        XCTAssertNil(response.event)
        XCTAssertNil(response.busEventPayload)
        XCTAssertNotNil(response.result)
    }

    func testWSResponseErrorFieldIsDecoded() throws {
        let json = """
        {
          "id": "abc",
          "error": "method not found"
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(WSResponse.self, from: json)

        XCTAssertEqual(response.error, "method not found")
    }

    // MARK: - WSError

    func testWSErrorProvidesDescriptions() {
        XCTAssertNotNil(WSError.notConnected.errorDescription)
        XCTAssertNotNil(WSError.encodingFailed.errorDescription)
        XCTAssertNotNil(WSError.timeout.errorDescription)
        XCTAssertEqual(WSError.serverError("oops").errorDescription, "oops")
    }

    // MARK: - ConnectionState

    func testConnectionStateIsActive() {
        XCTAssertFalse(ConnectionState.disconnected.isActive)
        XCTAssertFalse(ConnectionState.connecting.isActive)
        XCTAssertFalse(ConnectionState.authenticating.isActive)
        XCTAssertTrue(ConnectionState.connected.isActive)
        XCTAssertTrue(ConnectionState.reconnecting(attempt: 1).isActive)
        XCTAssertFalse(ConnectionState.authFailed(reason: "x").isActive)
        XCTAssertFalse(ConnectionState.serverUnavailable(reason: "x").isActive)
    }

    func testConnectionStateIsReconnecting() {
        XCTAssertFalse(ConnectionState.connected.isReconnecting)
        XCTAssertFalse(ConnectionState.disconnected.isReconnecting)
        XCTAssertTrue(ConnectionState.reconnecting(attempt: 3).isReconnecting)
    }

    func testConnectionStateHasDisplayLabel() {
        XCTAssertFalse(ConnectionState.connected.displayLabel.isEmpty)
        XCTAssertFalse(ConnectionState.reconnecting(attempt: 2).displayLabel.isEmpty)
        XCTAssertFalse(ConnectionState.authFailed(reason: "x").displayLabel.isEmpty)
    }

    func testConnectionEqualityUsesAssociatedValues() {
        XCTAssertEqual(ConnectionState.reconnecting(attempt: 1), ConnectionState.reconnecting(attempt: 1))
        XCTAssertNotEqual(ConnectionState.reconnecting(attempt: 1), ConnectionState.reconnecting(attempt: 2))
        XCTAssertNotEqual(ConnectionState.connected, ConnectionState.disconnected)
    }

    // MARK: - MiWarpConnection

    func testMiWarpConnectionBuildsWebSocketURL() {
        let conn = MiWarpConnection(name: "Local", host: "127.0.0.1", port: 9090)
        XCTAssertEqual(conn.wsURL?.absoluteString, "ws://127.0.0.1:9090/ws")
    }

    // MARK: - RunStatus

    func testRunStatusRoundTripsRawValues() throws {
        for status in RunStatus.allCases {
            let data = try JSONEncoder().encode(status)
            let decoded = try JSONDecoder().decode(RunStatus.self, from: data)
            XCTAssertEqual(decoded, status)
        }
    }

    func testRunStatusDecodesUnknownAsPending() throws {
        let json = "\"unknown_status_value\"".data(using: .utf8)!
        let status = try JSONDecoder().decode(RunStatus.self, from: json)
        XCTAssertEqual(status, .pending)
    }

    func testRunStatusHasSystemImageAndLabel() {
        for status in RunStatus.allCases {
            XCTAssertFalse(status.systemImage.isEmpty, "Missing systemImage for \(status)")
            XCTAssertFalse(status.displayLabel.isEmpty, "Missing displayLabel for \(status)")
        }
    }

    // MARK: - RunSource

    func testRunSourceDecodesKnownAndUnknownValues() throws {
        let native = "\"native\"".data(using: .utf8)!
        XCTAssertEqual(try JSONDecoder().decode(RunSource.self, from: native), .native)

        let cliImport = "\"cli_import\"".data(using: .utf8)!
        XCTAssertEqual(try JSONDecoder().decode(RunSource.self, from: cliImport), .cliImport)

        let unknown = "\"future_source\"".data(using: .utf8)!
        XCTAssertEqual(try JSONDecoder().decode(RunSource.self, from: unknown), .unknown)
    }

    // MARK: - MiWarpRun

    func testMiWarpRunUsesDefaultsForMissingOptionals() throws {
        let json = """
        {
          "id": "run-1"
        }
        """.data(using: .utf8)!

        let run = try JSONDecoder().decode(MiWarpRun.self, from: json)

        XCTAssertEqual(run.id, "run-1")
        XCTAssertNil(run.name)
        XCTAssertEqual(run.cwd, "")
        XCTAssertEqual(run.agent, "")
        XCTAssertEqual(run.status, .pending)
        XCTAssertEqual(run.source, .unknown)
        XCTAssertEqual(run.messageCount, 0)
    }

    func testMiWarpRunDecodesSnakeCaseKeys() throws {
        let json = """
        {
          "id": "run-2",
          "name": "Test",
          "cwd": "/tmp",
          "agent": "claude",
          "model": "opus",
          "status": "running",
          "source": "cli_import",
          "message_count": 5,
          "last_activity_at": "2026-06-21T10:00:00Z",
          "started_at": "2026-06-21T09:55:00Z"
        }
        """.data(using: .utf8)!

        let run = try JSONDecoder().decode(MiWarpRun.self, from: json)

        XCTAssertEqual(run.id, "run-2")
        XCTAssertEqual(run.name, "Test")
        XCTAssertEqual(run.cwd, "/tmp")
        XCTAssertEqual(run.agent, "claude")
        XCTAssertEqual(run.model, "opus")
        XCTAssertEqual(run.status, .running)
        XCTAssertEqual(run.source, .cliImport)
        XCTAssertEqual(run.messageCount, 5)
        XCTAssertNotNil(run.lastActivity)
        XCTAssertNotNil(run.createdAt)
    }

    func testMiWarpRunDisplayTitleFallsBackToPrompt() {
        let unnamed = MiWarpRun(id: "1")
        XCTAssertEqual(unnamed.displayTitle, "Untitled Session")

        let promptRun = MiWarpRun(id: "2", prompt: "Refactor the chat reducer into smaller reducers")
        XCTAssertEqual(promptRun.displayTitle, "Refactor the chat reducer into smaller reducers")

        let named = MiWarpRun(id: "3", name: "Custom", prompt: "ignored")
        XCTAssertEqual(named.displayTitle, "Custom")
    }

    func testMiWarpRunShortCwdStripsToLastTwoComponents() {
        XCTAssertEqual(MiWarpRun(id: "1", cwd: "/").shortCwd, "/")
        XCTAssertEqual(MiWarpRun(id: "1", cwd: "/a/b").shortCwd, "/a/b")
        XCTAssertEqual(MiWarpRun(id: "1", cwd: "/a/b/c/d").shortCwd, ".../c/d")
    }

    func testMiWarpRunDisplayFieldsRespectEmptyOrZero() {
        let emptyCwd = MiWarpRun(id: "1")
        XCTAssertNil(emptyCwd.displayCwd)
        XCTAssertNil(emptyCwd.displayMessageCount)
        XCTAssertFalse(emptyCwd.hasMetadata)

        let withCwd = MiWarpRun(id: "2", cwd: "/a/b/c/d")
        XCTAssertEqual(withCwd.displayCwd, ".../c/d")

        let oneMsg = MiWarpRun(id: "3", messageCount: 1)
        XCTAssertEqual(oneMsg.displayMessageCount, "1 message")

        let manyMsgs = MiWarpRun(id: "4", messageCount: 12)
        XCTAssertEqual(manyMsgs.displayMessageCount, "12 messages")
    }
}
