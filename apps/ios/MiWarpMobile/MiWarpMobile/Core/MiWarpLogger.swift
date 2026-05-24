import Foundation
import os

// MARK: - Logger

final class MiWarpLogger: @unchecked Sendable {
    static let shared = MiWarpLogger()

    private let logger = Logger(subsystem: "com.miwarp.mobile", category: "general")
    private let wsLogger = Logger(subsystem: "com.miwarp.mobile", category: "websocket")
    private let rpcLogger = Logger(subsystem: "com.miwarp.mobile", category: "rpc")
    private let eventLogger = Logger(subsystem: "com.miwarp.mobile", category: "events")

    private var logBuffer: [LogEntry] = []
    private let bufferLock = NSLock()
    private let maxBuffer = 500

    struct LogEntry: Identifiable {
        let id = UUID()
        let timestamp: Date
        let level: LogLevel
        let category: String
        let message: String
    }

    enum LogLevel: String {
        case debug, info, warning, error
    }

    // MARK: - General

    func debug(_ message: String, category: String = "general") {
        logger.debug("\(message)")
        append(.debug, category: category, message: message)
    }

    func info(_ message: String, category: String = "general") {
        logger.info("\(message)")
        append(.info, category: category, message: message)
    }

    func warning(_ message: String, category: String = "general") {
        logger.warning("\(message)")
        append(.warning, category: category, message: message)
    }

    func error(_ message: String, category: String = "general") {
        logger.error("\(message)")
        append(.error, category: category, message: message)
    }

    // MARK: - WebSocket

    func wsDebug(_ message: String) {
        wsLogger.debug("[WS] \(message)")
        append(.debug, category: "websocket", message: message)
    }

    func wsInfo(_ message: String) {
        wsLogger.info("[WS] \(message)")
        append(.info, category: "websocket", message: message)
    }

    func wsError(_ message: String) {
        wsLogger.error("[WS] \(message)")
        append(.error, category: "websocket", message: message)
    }

    // MARK: - RPC

    func rpcDebug(_ message: String) {
        rpcLogger.debug("[RPC] \(message)")
        append(.debug, category: "rpc", message: message)
    }

    func rpcInfo(_ message: String) {
        rpcLogger.info("[RPC] \(message)")
        append(.info, category: "rpc", message: message)
    }

    func rpcError(_ message: String) {
        rpcLogger.error("[RPC] \(message)")
        append(.error, category: "rpc", message: message)
    }

    // MARK: - Events

    func eventDebug(_ message: String) {
        eventLogger.debug("[EVT] \(message)")
        append(.debug, category: "events", message: message)
    }

    func eventInfo(_ message: String) {
        eventLogger.info("[EVT] \(message)")
        append(.info, category: "events", message: message)
    }

    // MARK: - Buffer

    var recentLogs: [LogEntry] {
        bufferLock.lock()
        defer { bufferLock.unlock() }
        return logBuffer
    }

    func clearLogs() {
        bufferLock.lock()
        defer { bufferLock.unlock() }
        logBuffer.removeAll()
    }

    private func append(_ level: LogLevel, category: String, message: String) {
        bufferLock.lock()
        defer { bufferLock.unlock() }
        logBuffer.append(LogEntry(timestamp: Date(), level: level, category: category, message: message))
        if logBuffer.count > maxBuffer {
            logBuffer.removeFirst(logBuffer.count - maxBuffer)
        }
    }
}
