import Foundation

// MARK: - Chunk Assembler Result

enum ChunkAssemblerResult {
    /// Not a chunk protocol message — caller should handle normally
    case notChunk
    /// Chunk was consumed (buffered, duplicate, or orphaned)
    case consumed
    /// All chunks received and reassembled — payload is the complete JSON string
    case completed(String)
    /// Buffer discarded due to error (timeout, oversized, incomplete end, etc.)
    case discarded(reason: String)
}

// MARK: - Chunk Assembler

/// Bounded chunk assembly for fragmented WebSocket messages.
///
/// Invariants:
/// - max logical message bytes = 10 MiB (UTF-8)
/// - max chunks per message = 1000
/// - max active messages = 50
/// - max total buffered bytes = 10 MiB
/// - message timeout = 60s; cleaned on consume and reset on disconnect
/// - chunk_begin validates msg_id, total, optional size; rejects duplicate begin
/// - chunk validates idx range, duplicate part, UTF-8 bytes, per-message/global bytes
/// - completion requires indices 0..<total; validates declared size vs actual UTF-8
/// - chunk_end on incomplete buffer → discard with log; on completed → consumed
/// - malformed/oversized chunk discards only the affected message, not the connection
final class MiWarpChunkAssembler: @unchecked Sendable {

    // MARK: - Constants

    static let defaultMaxActiveMessages = 50
    static let defaultMaxChunksPerMessage = 1000
    static let defaultMaxBytesPerMessage = 10 * 1024 * 1024 // 10 MiB
    static let defaultMaxTotalBufferedBytes = 10 * 1024 * 1024 // 10 MiB
    static let defaultMessageTimeoutSeconds: TimeInterval = 60

    // MARK: - Types

    private struct ChunkBuffer {
        let total: Int
        let declaredBytes: Int?
        var parts: [Int: String]
        var actualBytes: Int
        let createdAt: Date
    }

    // MARK: - State

    private var buffers: [String: ChunkBuffer] = [:]
    private var totalBufferedBytes: Int = 0
    private let lock = NSLock()

    private let maxActiveMessages: Int
    private let maxChunksPerMessage: Int
    private let maxBytesPerMessage: Int
    private let maxTotalBufferedBytes: Int
    private let messageTimeout: TimeInterval
    private let now: () -> Date

    // MARK: - Init

    init(
        maxActiveMessages: Int = defaultMaxActiveMessages,
        maxChunksPerMessage: Int = defaultMaxChunksPerMessage,
        maxBytesPerMessage: Int = defaultMaxBytesPerMessage,
        maxTotalBufferedBytes: Int = defaultMaxTotalBufferedBytes,
        messageTimeout: TimeInterval = defaultMessageTimeoutSeconds,
        now: @escaping () -> Date = Date.init
    ) {
        self.maxActiveMessages = maxActiveMessages
        self.maxChunksPerMessage = maxChunksPerMessage
        self.maxBytesPerMessage = maxBytesPerMessage
        self.maxTotalBufferedBytes = maxTotalBufferedBytes
        self.messageTimeout = messageTimeout
        self.now = now
    }

    // MARK: - Public API

    var activeCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return buffers.count
    }

    var bufferedByteCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return totalBufferedBytes
    }

    /// Process a raw WebSocket message data.
    /// Returns `.notChunk` if the message is not a chunk protocol message.
    func handleMessage(_ data: Data) -> ChunkAssemblerResult {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else {
            return .notChunk
        }

        cleanupExpired()

        switch type {
        case "chunk_begin":
            return handleChunkBegin(json)
        case "chunk":
            return handleChunk(json)
        case "chunk_end":
            return handleChunkEnd(json)
        default:
            return .notChunk
        }
    }

    /// Clear all buffers. Call on disconnect/cancel.
    func reset() {
        lock.lock()
        buffers.removeAll()
        totalBufferedBytes = 0
        lock.unlock()
    }

    // MARK: - chunk_begin

    private func handleChunkBegin(_ json: [String: Any]) -> ChunkAssemblerResult {
        guard let msgId = json["msg_id"] as? String, !msgId.isEmpty else {
            return .discarded(reason: "chunk_begin missing or empty msg_id")
        }
        guard let total = json["total"] as? Int, total > 0 else {
            return .discarded(reason: "chunk_begin missing or invalid total for msg_id=\(msgId)")
        }

        let declaredBytes = json["size"] as? Int

        lock.lock()
        defer { lock.unlock() }

        // Validate total chunks
        if total > maxChunksPerMessage {
            return .discarded(reason: "chunk_begin total=\(total) exceeds max=\(maxChunksPerMessage) for msg_id=\(msgId)")
        }

        // Validate declared size
        if let declaredBytes, (declaredBytes < 0 || declaredBytes > maxBytesPerMessage) {
            return .discarded(reason: "chunk_begin size=\(declaredBytes) exceeds max=\(maxBytesPerMessage) for msg_id=\(msgId)")
        }

        // Reject duplicate begin — do not overwrite in-flight buffer
        if buffers[msgId] != nil {
            return .discarded(reason: "chunk_begin duplicate for msg_id=\(msgId)")
        }

        // Preserve valid in-flight buffers; reject new work instead of evicting arbitrarily.
        if buffers.count >= maxActiveMessages {
            return .discarded(
                reason: "chunk_begin active message limit reached: \(buffers.count)/\(maxActiveMessages) for msg_id=\(msgId)"
            )
        }

        buffers[msgId] = ChunkBuffer(
            total: total,
            declaredBytes: declaredBytes,
            parts: [:],
            actualBytes: 0,
            createdAt: now()
        )
        return .consumed
    }

    // MARK: - chunk

    private func handleChunk(_ json: [String: Any]) -> ChunkAssemblerResult {
        guard let msgId = json["msg_id"] as? String, !msgId.isEmpty else {
            return .consumed // ignore malformed silently
        }
        guard let idx = json["idx"] as? Int else {
            return .consumed
        }
        guard let data = json["data"] as? String else {
            return .consumed
        }

        lock.lock()
        defer { lock.unlock() }

        guard var buffer = buffers[msgId] else {
            return .consumed // orphan part — ignore
        }

        // Duplicate index — skip
        if buffer.parts[idx] != nil {
            return .consumed
        }

        // A protocol-desynchronized message cannot complete safely. Drop only that message.
        if idx < 0 || idx >= buffer.total {
            buffers.removeValue(forKey: msgId)
            totalBufferedBytes -= buffer.actualBytes
            return .discarded(
                reason: "chunk msg_id=\(msgId) index out of range: \(idx) not in 0..<\(buffer.total)"
            )
        }

        // UTF-8 byte size check (per-message)
        let chunkBytes = data.utf8.count
        let newMessageBytes = buffer.actualBytes + chunkBytes
        if newMessageBytes > maxBytesPerMessage {
            buffers.removeValue(forKey: msgId)
            totalBufferedBytes -= buffer.actualBytes
            return .discarded(reason: "chunk msg_id=\(msgId) exceeds per-message byte limit: \(newMessageBytes) > \(maxBytesPerMessage)")
        }

        // Global byte size check
        let newGlobalBytes = totalBufferedBytes + chunkBytes
        if newGlobalBytes > maxTotalBufferedBytes {
            buffers.removeValue(forKey: msgId)
            totalBufferedBytes -= buffer.actualBytes
            return .discarded(reason: "chunk msg_id=\(msgId) exceeds global byte limit: \(newGlobalBytes) > \(maxTotalBufferedBytes)")
        }

        buffer.parts[idx] = data
        buffer.actualBytes = newMessageBytes
        buffers[msgId] = buffer
        totalBufferedBytes += chunkBytes

        // Check if complete
        if buffer.parts.count == buffer.total {
            return assembleAndDeliver(msgId: msgId, buffer: buffer)
        }

        return .consumed
    }

    // MARK: - chunk_end

    private func handleChunkEnd(_ json: [String: Any]) -> ChunkAssemblerResult {
        guard let msgId = json["msg_id"] as? String, !msgId.isEmpty else {
            return .consumed
        }

        lock.lock()
        defer { lock.unlock() }

        guard let buffer = buffers[msgId] else {
            return .consumed // no buffer — already consumed or unknown
        }

        if buffer.parts.count == buffer.total {
            return assembleAndDeliver(msgId: msgId, buffer: buffer)
        } else {
            // Incomplete — discard
            buffers.removeValue(forKey: msgId)
            totalBufferedBytes -= buffer.actualBytes
            return .discarded(reason: "chunk_end incomplete for msg_id=\(msgId): \(buffer.parts.count)/\(buffer.total) parts")
        }
    }

    // MARK: - Assembly

    private func assembleAndDeliver(msgId: String, buffer: ChunkBuffer) -> ChunkAssemblerResult {
        // Must be called with lock held
        buffers.removeValue(forKey: msgId)
        totalBufferedBytes -= buffer.actualBytes

        let assembled = (0..<buffer.total)
            .compactMap { buffer.parts[$0] }
            .joined()

        // Verify all indices present
        let expectedIndices = Set(0..<buffer.total)
        let actualIndices = Set(buffer.parts.keys)
        if actualIndices != expectedIndices {
            return .discarded(reason: "chunk msg_id=\(msgId) missing indices: expected \(expectedIndices), got \(actualIndices)")
        }

        // Validate declared size vs actual UTF-8 bytes
        let actualBytes = assembled.utf8.count
        if let declaredBytes = buffer.declaredBytes, actualBytes != declaredBytes {
            return .discarded(reason: "chunk msg_id=\(msgId) size mismatch: declared=\(declaredBytes) actual=\(actualBytes)")
        }

        return .completed(assembled)
    }

    // MARK: - Timeout cleanup

    /// Remove stale incomplete messages. Call periodically or before consume.
    func cleanupExpired() {
        let currentTime = now()
        lock.lock()
        defer { lock.unlock() }

        let expiredIds = buffers.compactMap { id, buffer in
            currentTime.timeIntervalSince(buffer.createdAt) > messageTimeout ? id : nil
        }
        for id in expiredIds {
            if let removed = buffers.removeValue(forKey: id) {
                totalBufferedBytes -= removed.actualBytes
            }
        }
    }
}
