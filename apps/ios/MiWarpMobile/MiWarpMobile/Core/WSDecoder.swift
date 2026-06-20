import Foundation

// MARK: - WS Chunk Reassembler
//
// v1.0.6 / 3.5: Server may split large payloads into `chunk_begin` / `chunk` /
// `chunk_end` messages. Feed each inbound frame via `accept(_:)`; when a buffer
// is complete, the reassembled Data is yielded through the completion handler.

final class WSChunkReassembler: @unchecked Sendable {
    private struct Buffer {
        let total: Int
        var parts: [Int: String]
    }

    private let lock = NSLock()
    private var buffers: [String: Buffer] = [:]

    /// Result of feeding one inbound frame.
    enum AcceptResult: Sendable {
        case chunkHandled
        case reassembled(Data)
    }

    /// Inspect a frame and either:
    /// - store its chunk piece and return `.chunkHandled`, or
    /// - return `.reassembled(Data)` once all parts for a `msg_id` are present, or
    /// - return `.chunkHandled` for `chunk_end` cleanup.
    ///
    /// Non-chunk frames fall through; the caller should decode them as a normal
    /// `WSResponse`.
    func accept(_ data: Data) -> AcceptResult? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json[WSField.type] as? String
        else {
            return nil
        }

        switch type {
        case WSEventName.chunkBegin:
            guard let msgId = json[WSField.msgId] as? String,
                  let total = json[WSField.total] as? Int
            else { return .chunkHandled }
            lock.lock()
            buffers[msgId] = Buffer(total: total, parts: [:])
            lock.unlock()
            return .chunkHandled

        case WSEventName.chunk:
            guard let msgId = json[WSField.msgId] as? String,
                  let idx = json[WSField.idx] as? Int,
                  let chunkData = json[WSField.data] as? String
            else { return .chunkHandled }

            lock.lock()
            buffers[msgId]?.parts[idx] = chunkData
            let snapshot = buffers[msgId]
            lock.unlock()

            guard let snapshot, snapshot.parts.count == snapshot.total else {
                return .chunkHandled
            }

            let sorted = snapshot.parts.sorted { $0.key < $1.key }
            let combined = sorted.map(\.value).joined()
            lock.lock()
            buffers.removeValue(forKey: msgId)
            lock.unlock()
            return .reassembled(Data(combined.utf8))

        case WSEventName.chunkEnd:
            if let msgId = json[WSField.msgId] as? String {
                lock.lock()
                buffers.removeValue(forKey: msgId)
                lock.unlock()
            }
            return .chunkHandled

        default:
            return nil
        }
    }
}

// MARK: - WS Request Registry
//
// Owns the in-flight request/continuation map. Replaces the ad-hoc
// `requestLock + [String: PendingRequest]` pair so callers can `await` safe
// accessors instead of touching `NSLock` from async contexts (Swift 6).

struct WSPendingRequest: Sendable {
    let continuation: CheckedContinuation<AnyCodable, Error>
    let timeoutTask: Task<Void, Never>
}

actor WSRequestRegistry {
    private var pending: [String: WSPendingRequest] = [:]

    func register(id: String, request: WSPendingRequest) {
        pending[id] = request
    }

    /// Returns the registered request if any. Caller resumes the continuation
    /// and cancels the timeout task.
    func take(id: String) -> WSPendingRequest? {
        defer { pending[id] = nil }
        return pending[id]
    }

    /// Drop and fail every pending request with the supplied error.
    func failAll(with error: WSError) {
        let snapshot = pending
        pending.removeAll()
        for (_, req) in snapshot {
            req.timeoutTask.cancel()
            req.continuation.resume(throwing: error)
        }
    }
}
