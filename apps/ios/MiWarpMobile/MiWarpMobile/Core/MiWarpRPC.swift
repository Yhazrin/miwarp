import Foundation

// MARK: - RPC Client

final class MiWarpRPC: @unchecked Sendable {
    private let client: MiWarpWebSocketClient
    private let logger = MiWarpLogger.shared

    init(client: MiWarpWebSocketClient) {
        self.client = client
    }

    // MARK: - Runs

    func listRuns() async throws -> [MiWarpRun] {
        let result = try await client.sendRequest(method: "list_runs")
        guard let array = result.arrayValue else {
            throw RPCError.invalidResponse
        }
        let data = try JSONSerialization.data(withJSONObject: array)
        return try JSONDecoder().decode([MiWarpRun].self, from: data)
    }

    func getRun(id: String) async throws -> MiWarpRun {
        let result = try await client.sendRequest(method: "get_run", params: ["id": id])
        let data = try JSONSerialization.data(withJSONObject: result.value)
        return try JSONDecoder().decode(MiWarpRun.self, from: data)
    }

    // MARK: - Bus Events

    func getBusEvents(runId: String, sinceSeq: Int? = nil) async throws -> [BusEvent] {
        var params: [String: Any] = ["id": runId]
        if let sinceSeq {
            params["since_seq"] = sinceSeq
        }
        let result = try await client.sendRequest(method: "get_bus_events", params: params)
        guard let array = result.arrayValue else {
            throw RPCError.invalidResponse
        }
        let data = try JSONSerialization.data(withJSONObject: array)
        return try JSONDecoder().decode([BusEvent].self, from: data)
    }

    // MARK: - Subscribe / Unsubscribe

    func subscribe(runId: String, lastSeq: Int? = nil) async throws {
        var params: [String: Any] = ["run_id": runId]
        if let lastSeq {
            params["last_seq"] = lastSeq
        }
        _ = try await client.sendRequest(method: "_subscribe", params: params)
        logger.rpcInfo("Subscribed to run \(runId)")
    }

    func unsubscribe(runId: String) async throws {
        _ = try await client.sendRequest(method: "_unsubscribe", params: ["run_id": runId])
        logger.rpcInfo("Unsubscribed from run \(runId)")
    }

    // MARK: - Session Actions

    func sendMessage(runId: String, message: String, attachments: [[String: Any]]? = nil) async throws {
        var params: [String: Any] = ["run_id": runId, "message": message]
        if let attachments {
            params["attachments"] = attachments
        }
        _ = try await client.sendRequest(method: "send_session_message", params: params)
    }

    func startSession(runId: String, mode: String? = nil, initialMessage: String? = nil) async throws {
        var params: [String: Any] = ["run_id": runId]
        if let mode { params["mode"] = mode }
        if let initialMessage { params["initial_message"] = initialMessage }
        _ = try await client.sendRequest(method: "start_session", params: params)
    }

    func stopSession(runId: String) async throws {
        _ = try await client.sendRequest(method: "stop_session", params: ["run_id": runId])
    }

    func forkSession(runId: String) async throws -> String {
        let result = try await client.sendRequest(method: "fork_session", params: ["run_id": runId])
        guard let newRunId = result.stringValue else {
            throw RPCError.invalidResponse
        }
        return newRunId
    }

    // MARK: - Permissions

    func respondPermission(
        runId: String,
        requestId: String,
        behavior: String,
        denyMessage: String? = nil
    ) async throws {
        var params: [String: Any] = [
            "run_id": runId,
            "request_id": requestId,
            "behavior": behavior,
        ]
        if let denyMessage {
            params["deny_message"] = denyMessage
        }
        _ = try await client.sendRequest(method: "respond_permission", params: params)
    }

    func approveSessionTool(runId: String, toolName: String) async throws {
        _ = try await client.sendRequest(
            method: "approve_session_tool",
            params: ["run_id": runId, "tool_name": toolName]
        )
    }

    // MARK: - Artifacts

    func getRunArtifacts(id: String) async throws -> RunArtifacts {
        let result = try await client.sendRequest(method: "get_run_artifacts", params: ["id": id])
        let data = try JSONSerialization.data(withJSONObject: result.value)
        return try JSONDecoder().decode(RunArtifacts.self, from: data)
    }

    // MARK: - Git

    func getGitStatus(cwd: String) async throws -> GitStatus {
        let result = try await client.sendRequest(method: "get_git_status", params: ["cwd": cwd])
        let data = try JSONSerialization.data(withJSONObject: result.value)
        return try JSONDecoder().decode(GitStatus.self, from: data)
    }

    func getGitDiff(cwd: String, staged: Bool? = nil, file: String? = nil) async throws -> GitDiff {
        var params: [String: Any] = ["cwd": cwd]
        if let staged { params["staged"] = staged }
        if let file { params["file"] = file }
        let result = try await client.sendRequest(method: "get_git_diff", params: params)
        let data = try JSONSerialization.data(withJSONObject: result.value)
        return try JSONDecoder().decode(GitDiff.self, from: data)
    }

    // MARK: - Server

    func getWebServerStatus() async throws -> WebServerStatus {
        let result = try await client.sendRequest(method: "get_web_server_status")
        let data = try JSONSerialization.data(withJSONObject: result.value)
        return try JSONDecoder().decode(WebServerStatus.self, from: data)
    }

    // MARK: - Errors

    enum RPCError: LocalizedError {
        case invalidResponse
        case notConnected

        var errorDescription: String? {
            switch self {
            case .invalidResponse: return "Invalid response from server"
            case .notConnected: return "Not connected to server"
            }
        }
    }
}

// MARK: - Web Server Status

struct WebServerStatus: Codable {
    let enabled: Bool?
    let running: Bool?
    let port: Int?
    let bind: String?
}
