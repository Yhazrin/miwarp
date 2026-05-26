import Foundation

// MARK: - WebSocket Client

final class MiWarpWebSocketClient: NSObject, @unchecked Sendable {
    // MARK: - Properties

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private let logger = MiWarpLogger.shared

    private struct PendingRequest {
        let continuation: CheckedContinuation<AnyCodable, Error>
        let timeoutTask: Task<Void, Never>?
    }
    private var pendingRequests: [String: PendingRequest] = [:]
    private let requestLock = NSLock()

    private var eventContinuation: AsyncStream<BusEvent>.Continuation?
    private var connectionContinuation: AsyncStream<ConnectionState>.Continuation?

    private var seqTracker: [String: Int] = [:] // runId -> last seen seq
    private let seqLock = NSLock()

    private var reconnectAttempt = 0
    private var maxReconnectAttempt = 20
    private var reconnectTimer: Timer?
    private var connectTimeoutTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var preflightSession: URLSession?
    private var preflightTask: URLSessionDataTask?
    private var isIntentionalClose = false
    private var currentURL: URL?
    private var currentToken: String?
    private var connectionGeneration: UInt64 = 0

    private(set) var connectionState: ConnectionState = .disconnected {
        didSet {
            if connectionState != oldValue {
                logger.wsInfo("State: \(connectionState.displayLabel)")
                connectionContinuation?.yield(connectionState)
            }
        }
    }

    // MARK: - Streams (recreated on each connect to avoid stale finished streams)

    private var _eventStream: AsyncStream<BusEvent>!
    private var _connectionStateStream: AsyncStream<ConnectionState>!

    var eventStream: AsyncStream<BusEvent> { _eventStream }
    var connectionStateStream: AsyncStream<ConnectionState> { _connectionStateStream }

    private func createStreams() {
        _eventStream = AsyncStream { continuation in
            self.eventContinuation = continuation
            continuation.onTermination = { @Sendable _ in }
        }
        _connectionStateStream = AsyncStream { continuation in
            self.connectionContinuation = continuation
            continuation.yield(connectionState)
            continuation.onTermination = { @Sendable _ in }
        }
    }

    // MARK: - Connect

    func connect(host: String, port: Int, token: String) {
        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = port
        components.path = "/ws"

        guard let url = components.url else {
            connectionState = .serverUnavailable(reason: "Invalid URL")
            return
        }

        connectionGeneration &+= 1
        let generation = connectionGeneration

        isIntentionalClose = true
        cancelActiveTransport()
        cancelAllPendingRequests()

        currentURL = url
        currentToken = token
        isIntentionalClose = false
        reconnectAttempt = 0
        createStreams()
        logger.wsInfo("Connecting to \(maskedURL(url))")
        performPreflightThenConnect(url: url, token: token, generation: generation)
    }

    private func performPreflightThenConnect(url: URL, token: String, generation: UInt64) {
        guard generation == connectionGeneration else { return }

        guard let probeURL = httpProbeURL(for: url) else {
            performConnect(url: url, token: token, generation: generation)
            return
        }

        connectionState = reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting

        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 6
        // No resource timeout for preflight probe

        preflightSession?.invalidateAndCancel()
        let session = URLSession(configuration: config)
        preflightSession = session

        var request = URLRequest(url: probeURL)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        logger.wsInfo("Preflight \(probeURL.absoluteString)")
        preflightTask = session.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            guard generation == self.connectionGeneration else { return }
            self.preflightTask = nil
            self.preflightSession?.finishTasksAndInvalidate()
            self.preflightSession = nil

            guard !self.isIntentionalClose else { return }

            if let error {
                self.logger.wsError("Preflight failed: \(error.localizedDescription)")
                self.connectionState = .serverUnavailable(reason: self.connectionTroubleshootingReason(for: error))
                return
            }

            if let status = (response as? HTTPURLResponse)?.statusCode {
                self.logger.wsInfo("Preflight OK: HTTP \(status)")
            } else {
                self.logger.wsInfo("Preflight OK")
            }

            self.performConnect(url: url, token: token, generation: generation)
        }
        preflightTask?.resume()
    }

    private func performConnect(url: URL, token: String, generation: UInt64) {
        guard generation == connectionGeneration else { return }

        connectionState = reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 15
        // No resource timeout — WebSocket is a long-lived connection
        urlSession = URLSession(configuration: config, delegate: self, delegateQueue: .main)

        var request = URLRequest(url: url)
        // Use header auth for security — token not in URL query logs
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(token, forHTTPHeaderField: "X-MiWarp-Token")

        let task = urlSession?.webSocketTask(with: request)
        webSocketTask = task
        task?.resume()

        if let task {
            startConnectTimeout(for: url, task: task, generation: generation)
            startReceiving(task: task, generation: generation)
            startHeartbeat(generation: generation)
        }
    }

    // MARK: - Disconnect

    func disconnect() {
        connectionGeneration &+= 1
        isIntentionalClose = true
        cancelActiveTransport()
        connectionState = .disconnected
        eventContinuation?.finish()
        eventContinuation = nil
        connectionContinuation?.finish()
        connectionContinuation = nil
        cancelAllPendingRequests()
    }

    // MARK: - Send Request

    func sendRequest(method: String, params: [String: Any]? = nil) async throws -> AnyCodable {
        guard connectionState == .connected else {
            throw WSError.notConnected
        }

        let request = WSRequest(method: method, params: params)
        let id = request.id

        let data = try JSONEncoder().encode(request)
        guard let jsonString = String(data: data, encoding: .utf8) else {
            throw WSError.encodingFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            // Timeout after 30 seconds
            let timeoutTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                self?.requestLock.lock()
                let req = self?.pendingRequests.removeValue(forKey: id)
                self?.requestLock.unlock()
                req?.continuation.resume(throwing: WSError.timeout)
            }

            requestLock.lock()
            pendingRequests[id] = PendingRequest(continuation: continuation, timeoutTask: timeoutTask)
            requestLock.unlock()

            webSocketTask?.send(.string(jsonString)) { [weak self] error in
                if let error {
                    self?.logger.wsError("Send failed: \(error.localizedDescription)")
                    self?.requestLock.lock()
                    let req = self?.pendingRequests.removeValue(forKey: id)
                    self?.requestLock.unlock()
                    req?.timeoutTask?.cancel()
                    req?.continuation.resume(throwing: error)
                }
            }
        }
    }

    // MARK: - Receive Loop

    private func startReceiving(task: URLSessionWebSocketTask, generation: UInt64) {
        task.receive { [weak self] result in
            guard let self else { return }
            guard generation == self.connectionGeneration, task === self.webSocketTask else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleMessage(text)
                    }
                @unknown default:
                    break
                }
                self.startReceiving(task: task, generation: generation) // Continue receiving

            case .failure(let error):
                self.logger.wsError("Receive error: \(error.localizedDescription)")
                if !self.isIntentionalClose {
                    self.scheduleReconnect(generation: generation)
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }

        do {
            let response = try JSONDecoder().decode(WSResponse.self, from: data)

            // Handle broadcast events (no id)
            if response.id == nil, let event = response.event {
                handleBroadcast(response: response)
                return
            }

            // Handle RPC response
            if let id = response.id {
                requestLock.lock()
                let req = pendingRequests.removeValue(forKey: id)
                requestLock.unlock()

                req?.timeoutTask?.cancel()

                if let error = response.error {
                    req?.continuation.resume(throwing: WSError.serverError(error))
                } else if let result = response.result {
                    req?.continuation.resume(returning: result)
                } else {
                    req?.continuation.resume(returning: AnyCodable([:]))
                }
            }
        } catch {
            logger.wsError("Parse error: \(error.localizedDescription)")
        }
    }

    private func handleBroadcast(response: WSResponse) {
        guard let eventName = response.event else { return }

        if eventName == "_full_reload" {
            if let runId = response.runId {
                seqLock.lock()
                seqTracker.removeValue(forKey: runId)
                seqLock.unlock()
                logger.wsInfo("Full reload for run: \(runId)")
            }
            return
        }

        if eventName == "bus-event", let runId = response.runId {
            let seq = response.seq ?? 0

            // Dedup
            seqLock.lock()
            let lastSeq = seqTracker[runId] ?? 0
            if seq <= lastSeq {
                seqLock.unlock()
                return
            }
            seqTracker[runId] = seq
            seqLock.unlock()

            // Parse payload
            if let payloadData = response.payload {
                do {
                    let payloadJSON = try JSONEncoder().encode(payloadData)
                    let payload = try JSONDecoder().decode(BusEventPayload.self, from: payloadJSON)
                    let event = BusEvent(seq: seq, runId: runId, payload: payload)
                    eventContinuation?.yield(event)
                } catch {
                    logger.eventDebug("Failed to parse bus event payload: \(error.localizedDescription)")
                    // Yield as raw event
                    let rawPayload = BusEventPayload.raw(RawPayload(type: "unparseable", data: [:]))
                    let event = BusEvent(seq: seq, runId: runId, payload: rawPayload)
                    eventContinuation?.yield(event)
                }
            }
        }
    }

    // MARK: - Heartbeat

    private func startHeartbeat(generation: UInt64) {
        // URLSessionWebSocketTask handles ping/pong automatically
        // We send periodic pings to keep the connection alive
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while let self, !self.isIntentionalClose {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled, !self.isIntentionalClose, generation == self.connectionGeneration else { break }
                self.webSocketTask?.sendPing { [weak self] error in
                    if let error {
                        self?.logger.wsDebug("Ping failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    // MARK: - Reconnect

    private func scheduleReconnect(generation: UInt64) {
        guard generation == connectionGeneration else { return }
        guard !isIntentionalClose, reconnectAttempt < maxReconnectAttempt else {
            connectionState = .serverUnavailable(reason: "Max reconnect attempts reached")
            return
        }

        reconnectAttempt += 1
        let delay = min(pow(2.0, Double(reconnectAttempt)), 30.0)
        logger.wsInfo("Reconnecting in \(delay)s (attempt \(reconnectAttempt))")

        connectionState = .reconnecting(attempt: reconnectAttempt)

        reconnectTimer?.invalidate()
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self, let url = self.currentURL, let token = self.currentToken else { return }
            guard generation == self.connectionGeneration else { return }
            self.webSocketTask?.cancel(with: .goingAway, reason: nil)
            self.webSocketTask = nil
            self.performPreflightThenConnect(url: url, token: token, generation: generation)
        }
    }

    private func startConnectTimeout(for url: URL, task: URLSessionWebSocketTask, generation: UInt64) {
        connectTimeoutTask?.cancel()
        connectTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(12))
            guard let self, !Task.isCancelled, !self.isIntentionalClose else { return }
            guard generation == self.connectionGeneration, task === self.webSocketTask else { return }
            guard self.connectionState == .connecting || self.connectionState.isReconnecting else { return }

            self.logger.wsError("Connection timed out: \(self.maskedURL(url))")
            task.cancel(with: .goingAway, reason: nil)
            self.connectionState = .serverUnavailable(
                reason: "Connection timed out. If Safari can open this address, reinstall MiWarp Mobile and allow Local Network permission."
            )
        }
    }

    private func cancelActiveTransport() {
        preflightTask?.cancel()
        preflightTask = nil
        preflightSession?.invalidateAndCancel()
        preflightSession = nil
        connectTimeoutTask?.cancel()
        connectTimeoutTask = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        // Clean up pending requests since connection is being terminated
        cancelAllPendingRequests()
    }

    private func maskedURL(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        if components.queryItems?.contains(where: { $0.name == "token" }) == true {
            components.queryItems = [URLQueryItem(name: "token", value: "••••")]
        }
        return components.string ?? url.absoluteString
    }

    private func httpProbeURL(for wsURL: URL) -> URL? {
        guard var components = URLComponents(url: wsURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.scheme = "http"
        components.path = "/login"
        components.queryItems = nil
        return components.url
    }

    private func connectionTroubleshootingReason(for error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorNotConnectedToInternet {
            return "MiWarp Mobile cannot reach the local server from inside the app. Since Safari can open it, check iOS Settings > Privacy & Security > Local Network > MiWarp, then reinstall the app if MiWarp is not listed."
        }
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorAppTransportSecurityRequiresSecureConnection {
            return "iOS blocked local cleartext networking. Reinstall the latest build with local networking enabled."
        }
        return error.localizedDescription
    }

    // MARK: - Seq Tracking

    func lastSeq(for runId: String) -> Int {
        seqLock.lock()
        defer { seqLock.unlock() }
        return seqTracker[runId] ?? 0
    }

    func resetSeq(for runId: String) {
        seqLock.lock()
        defer { seqLock.unlock() }
        seqTracker.removeValue(forKey: runId)
    }

    // MARK: - Cleanup

    private func cancelAllPendingRequests() {
        requestLock.lock()
        let requests = pendingRequests
        pendingRequests.removeAll()
        requestLock.unlock()
        for (_, req) in requests {
            req.timeoutTask?.cancel()
            req.continuation.resume(throwing: WSError.notConnected)
        }
    }

    // MARK: - Errors

    enum WSError: LocalizedError {
        case notConnected
        case encodingFailed
        case timeout
        case serverError(String)

        var errorDescription: String? {
            switch self {
            case .notConnected: return "Not connected to server"
            case .encodingFailed: return "Failed to encode request"
            case .timeout: return "Request timed out"
            case .serverError(let msg): return msg
            }
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension MiWarpWebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        guard webSocketTask === self.webSocketTask else { return }
        connectTimeoutTask?.cancel()
        connectTimeoutTask = nil
        logger.wsInfo("WebSocket connected")
        reconnectAttempt = 0
        connectionState = .connected
    }

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                    reason: Data?) {
        guard webSocketTask === self.webSocketTask else { return }
        let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        logger.wsInfo("WebSocket closed: \(closeCode.rawValue) reason=\(reasonStr)")
        guard !isIntentionalClose else { return }

        // 4401 = token rotated / session expired / token version mismatch
        // Reconnecting won't help — surface auth error immediately
        if closeCode.rawValue == 4401 {
            connectionState = .authFailed(reason: "Token expired or rotated. Please reconnect from the desktop.")
            return
        }

        scheduleReconnect(generation: connectionGeneration)
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        // Only handle if this is the current active WebSocket task
        guard let webSocketTask = task as? URLSessionWebSocketTask,
              webSocketTask === self.webSocketTask else { return }
        guard let error, !isIntentionalClose else { return }

        connectTimeoutTask?.cancel()
        connectTimeoutTask = nil
        logger.wsError("Connection failed: \(error.localizedDescription)")

        // If already connected, treat as disconnection → reconnect
        // Only set serverUnavailable if in connecting/reconnecting phase
        if connectionState == .connected {
            scheduleReconnect(generation: connectionGeneration)
        } else if connectionState == .connecting || connectionState.isReconnecting {
            connectionState = .serverUnavailable(reason: connectionTroubleshootingReason(for: error))
        }
        // If already disconnected/intentional, do nothing
    }
}

private extension ConnectionState {
    var isReconnecting: Bool {
        if case .reconnecting = self { return true }
        return false
    }
}
