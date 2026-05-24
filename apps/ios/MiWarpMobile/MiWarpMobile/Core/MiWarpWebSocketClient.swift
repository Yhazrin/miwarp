import Foundation

// MARK: - WebSocket Client

final class MiWarpWebSocketClient: NSObject, @unchecked Sendable {
    // MARK: - Properties

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private let logger = MiWarpLogger.shared

    private var pendingRequests: [String: CheckedContinuation<AnyCodable, Error>] = [:]
    private let requestLock = NSLock()

    private var eventContinuation: AsyncStream<BusEvent>.Continuation?
    private var connectionContinuation: AsyncStream<ConnectionState>.Continuation?

    private var seqTracker: [String: Int] = [:] // runId -> last seen seq
    private let seqLock = NSLock()

    private var reconnectAttempt = 0
    private var maxReconnectAttempt = 20
    private var reconnectTimer: Timer?
    private var isIntentionalClose = false
    private var currentURL: URL?
    private var currentToken: String?

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
        components.queryItems = [URLQueryItem(name: "token", value: token)]

        guard let url = components.url else {
            connectionState = .serverUnavailable(reason: "Invalid URL")
            return
        }

        currentURL = url
        currentToken = token
        isIntentionalClose = false
        reconnectAttempt = 0
        createStreams()
        performConnect(url: url)
    }

    private func performConnect(url: URL) {
        connectionState = reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        urlSession = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        webSocketTask = urlSession?.webSocketTask(with: url)
        webSocketTask?.resume()

        startReceiving()
        startHeartbeat()
    }

    // MARK: - Disconnect

    func disconnect() {
        isIntentionalClose = true
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
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
            requestLock.lock()
            pendingRequests[id] = continuation
            requestLock.unlock()

            webSocketTask?.send(.string(jsonString)) { [weak self] error in
                if let error {
                    self?.logger.wsError("Send failed: \(error.localizedDescription)")
                    self?.requestLock.lock()
                    let cont = self?.pendingRequests.removeValue(forKey: id)
                    self?.requestLock.unlock()
                    cont?.resume(throwing: error)
                }
            }

            // Timeout after 30 seconds
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                self?.requestLock.lock()
                let cont = self?.pendingRequests.removeValue(forKey: id)
                self?.requestLock.unlock()
                cont?.resume(throwing: WSError.timeout)
            }
        }
    }

    // MARK: - Receive Loop

    private func startReceiving() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }

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
                self.startReceiving() // Continue receiving

            case .failure(let error):
                self.logger.wsError("Receive error: \(error.localizedDescription)")
                if !self.isIntentionalClose {
                    self.scheduleReconnect()
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
                let continuation = pendingRequests.removeValue(forKey: id)
                requestLock.unlock()

                if let error = response.error {
                    continuation?.resume(throwing: WSError.serverError(error))
                } else if let result = response.result {
                    continuation?.resume(returning: result)
                } else {
                    continuation?.resume(returning: AnyCodable([:]))
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

    private func startHeartbeat() {
        // URLSessionWebSocketTask handles ping/pong automatically
        // We send periodic pings to keep the connection alive
        Task { [weak self] in
            while let self, !self.isIntentionalClose {
                try? await Task.sleep(for: .seconds(30))
                guard !self.isIntentionalClose else { break }
                self.webSocketTask?.sendPing { [weak self] error in
                    if let error {
                        self?.logger.wsDebug("Ping failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    // MARK: - Reconnect

    private func scheduleReconnect() {
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
            guard let self, let url = self.currentURL else { return }
            self.webSocketTask?.cancel(with: .goingAway, reason: nil)
            self.webSocketTask = nil
            self.performConnect(url: url)
        }
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
        let continuations = pendingRequests
        pendingRequests.removeAll()
        requestLock.unlock()
        for (_, cont) in continuations {
            cont.resume(throwing: WSError.notConnected)
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
        logger.wsInfo("WebSocket connected")
        reconnectAttempt = 0
        connectionState = .connected
    }

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                    reason: Data?) {
        logger.wsInfo("WebSocket closed: \(closeCode.rawValue)")
        if !isIntentionalClose {
            scheduleReconnect()
        }
    }
}
