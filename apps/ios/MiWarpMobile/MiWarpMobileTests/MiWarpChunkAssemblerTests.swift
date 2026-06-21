import XCTest
@testable import MiWarpMobile

final class MiWarpChunkAssemblerTests: XCTestCase {

    private var assembler: MiWarpChunkAssembler!

    override func setUp() {
        super.setUp()
        assembler = MiWarpChunkAssembler()
    }

    override func tearDown() {
        assembler = nil
        super.tearDown()
    }

    // MARK: - Helpers

    private func chunkBegin(msgId: String, total: Int, size: Int? = nil) -> Data {
        var dict: [String: Any] = ["type": "chunk_begin", "msg_id": msgId, "total": total]
        if let size { dict["size"] = size }
        return try! JSONSerialization.data(withJSONObject: dict)
    }

    private func chunk(msgId: String, idx: Int, data: String) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "type": "chunk", "msg_id": msgId, "idx": idx, "data": data
        ])
    }

    private func chunkEnd(msgId: String) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "type": "chunk_end", "msg_id": msgId
        ])
    }

    private func nonChunkMessage() -> Data {
        try! JSONSerialization.data(withJSONObject: ["event": "bus-event", "payload": "test"])
    }

    // MARK: - Normal assembly

    func testAssembles2ChunkMessage() {
        let r1 = assembler.handleMessage(chunkBegin(msgId: "m1", total: 2))
        XCTAssertEqual(r1, .consumed)

        let r2 = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "{\"hello\":"))
        XCTAssertEqual(r2, .consumed)

        let r3 = assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: "\"world\"}"))
        XCTAssertEqual(r3, .completed("{\"hello\":\"world\"}"))
        XCTAssertEqual(assembler.activeCount, 0)
    }

    func testAssembles3ChunkMessage() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 3))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: "b"))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 2, data: "c"))
        XCTAssertEqual(r, .completed("abc"))
    }

    // MARK: - Out of order

    func testHandlesOutOfOrderChunks() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 3))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 2, data: "c"))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: "b"))
        XCTAssertEqual(r, .completed("abc"))
    }

    // MARK: - Chinese / emoji UTF-8

    func testHandlesChineseCharacters() {
        let chinese = "你好世界"
        let utf8Bytes = chinese.utf8.count // 12 bytes
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1, size: utf8Bytes))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: chinese))
        XCTAssertEqual(r, .completed(chinese))
    }

    func testHandlesEmoji() {
        let emoji = "🚀🎉"
        let utf8Bytes = emoji.utf8.count // 8 bytes
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1, size: utf8Bytes))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: emoji))
        XCTAssertEqual(r, .completed(emoji))
    }

    func testHandlesMixedUtf8AcrossChunks() {
        let part1 = "Hello "
        let part2 = "世界"
        let part3 = " 🌍"
        let full = part1 + part2 + part3
        let utf8Bytes = full.utf8.count
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 3, size: utf8Bytes))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: part1))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: part2))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 2, data: part3))
        XCTAssertEqual(r, .completed(full))
    }

    // MARK: - Escaped quote / backslash

    func testHandlesEscapedQuoteInData() {
        let data = "he said \\\"hello\\\""
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: data))
        XCTAssertEqual(r, .completed(data))
    }

    func testHandlesEscapedBackslashInData() {
        let data = "path\\\\to\\\\file"
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: data))
        XCTAssertEqual(r, .completed(data))
    }

    func testHandlesEscapedNewlineInData() {
        let data = "line1\\nline2\\nline3"
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: data))
        XCTAssertEqual(r, .completed(data))
    }

    // MARK: - Duplicate begin

    func testDuplicateBeginDiscardsSecond() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))
        let dup = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1))
        // Should be discarded (duplicate), not overwrite in-flight
        XCTAssertEqual(dup, .discarded(reason: "chunk_begin duplicate for msg_id=m1"))

        // Original assembly still works
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: "b"))
        XCTAssertEqual(r, .completed("ab"))
    }

    // MARK: - Duplicate part

    func testDuplicatePartIgnored() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))
        let dup = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "X"))
        XCTAssertEqual(dup, .consumed) // silently ignored

        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: "b"))
        XCTAssertEqual(r, .completed("ab")) // not "Xb"
    }

    // MARK: - Out-of-range index

    func testOutOfRangeIndexDiscardsAffectedMessage() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))

        let result = assembler.handleMessage(chunk(msgId: "m1", idx: 5, data: "x"))
        guard case .discarded(let reason) = result else {
            return XCTFail("Expected out-of-range chunk to discard its message")
        }
        XCTAssertTrue(reason.contains("index out of range"))
        XCTAssertEqual(assembler.activeCount, 0)
        XCTAssertEqual(assembler.bufferedByteCount, 0)
        XCTAssertEqual(assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: "b")), .consumed)
    }

    // MARK: - Orphan chunk

    func testOrphanChunkIgnored() {
        let r = assembler.handleMessage(chunk(msgId: "unknown", idx: 0, data: "x"))
        XCTAssertEqual(r, .consumed)
    }

    // MARK: - Max chunks per message

    func testMaxChunksPerMessageRejects() {
        let small = MiWarpChunkAssembler(maxChunksPerMessage: 2)
        let r = small.handleMessage(chunkBegin(msgId: "m1", total: 5))
        if case .discarded(let reason) = r {
            XCTAssertTrue(reason.contains("exceeds max"))
        } else {
            XCTFail("Expected discarded")
        }
        XCTAssertEqual(small.activeCount, 0)
    }

    // MARK: - Max active messages

    func testMaxActiveMessagesRejectsNewBeginWithoutEviction() {
        let small = MiWarpChunkAssembler(maxActiveMessages: 2)
        _ = small.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = small.handleMessage(chunkBegin(msgId: "m2", total: 2))

        let result = small.handleMessage(chunkBegin(msgId: "m3", total: 1))
        guard case .discarded(let reason) = result else {
            return XCTFail("Expected capacity rejection")
        }
        XCTAssertTrue(reason.contains("active message limit"))
        XCTAssertEqual(small.activeCount, 2)

        _ = small.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))
        XCTAssertEqual(
            small.handleMessage(chunk(msgId: "m1", idx: 1, data: "b")),
            .completed("ab")
        )
    }

    // MARK: - Per-message bytes

    func testPerMessageBytesLimit() {
        let small = MiWarpChunkAssembler(maxBytesPerMessage: 10)
        _ = small.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = small.handleMessage(chunk(msgId: "m1", idx: 0, data: "1234567890")) // 10 bytes
        let r = small.handleMessage(chunk(msgId: "m1", idx: 1, data: "x")) // 11 total
        if case .discarded(let reason) = r {
            XCTAssertTrue(reason.contains("per-message byte limit"))
        } else {
            XCTFail("Expected discarded")
        }
        XCTAssertEqual(small.activeCount, 0)
    }

    // MARK: - Global bytes

    func testGlobalBytesLimit() {
        let small = MiWarpChunkAssembler(maxBytesPerMessage: 100, maxTotalBufferedBytes: 15)
        _ = small.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = small.handleMessage(chunkBegin(msgId: "m2", total: 2))
        _ = small.handleMessage(chunk(msgId: "m1", idx: 0, data: "12345678")) // 8 bytes buffered
        let r = small.handleMessage(chunk(msgId: "m2", idx: 0, data: "12345678")) // 16 total exceeds 15
        if case .discarded(let reason) = r {
            XCTAssertTrue(reason.contains("global byte limit"))
        } else {
            XCTFail("Expected discarded")
        }
    }

    // MARK: - UTF-8 bytes (not code units)

    func testUtf8ByteCounting() {
        let small = MiWarpChunkAssembler(maxBytesPerMessage: 5)
        _ = small.handleMessage(chunkBegin(msgId: "m1", total: 1))
        // "你好" = 6 UTF-8 bytes, exceeds 5
        let r = small.handleMessage(chunk(msgId: "m1", idx: 0, data: "你好"))
        if case .discarded = r {
            // expected
        } else {
            XCTFail("Expected discarded for UTF-8 overflow")
        }
        XCTAssertEqual(small.activeCount, 0)
    }

    // MARK: - Declared size mismatch

    func testDeclaredSizeMismatchDiscards() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1, size: 4))
        let r = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "abc")) // 3 != 4
        if case .discarded(let reason) = r {
            XCTAssertTrue(reason.contains("size mismatch"))
        } else {
            XCTFail("Expected discarded for size mismatch")
        }
    }

    func testDeclaredSizeOversizedRejectsBegin() {
        let r = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1, size: 11 * 1024 * 1024))
        if case .discarded(let reason) = r {
            XCTAssertTrue(reason.contains("exceeds max"))
        } else {
            XCTFail("Expected discarded for oversized declared size")
        }
        XCTAssertEqual(assembler.activeCount, 0)
    }

    // MARK: - Timeout

    func testHandleMessageCleansExpiredBuffersBeforeConsume() {
        var currentTime: TimeInterval = 1000
        let clock: () -> Date = { Date(timeIntervalSince1970: currentTime) }
        let small = MiWarpChunkAssembler(messageTimeout: 5, now: clock)

        _ = small.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = small.handleMessage(chunk(msgId: "m1", idx: 0, data: "stale"))
        XCTAssertEqual(small.activeCount, 1)
        XCTAssertEqual(small.bufferedByteCount, 5)

        currentTime += 6
        _ = small.handleMessage(chunkBegin(msgId: "m2", total: 1))
        XCTAssertEqual(small.activeCount, 1)
        XCTAssertEqual(small.bufferedByteCount, 0)
        XCTAssertEqual(small.handleMessage(chunk(msgId: "m2", idx: 0, data: "fresh")), .completed("fresh"))
    }

    func testTimeoutDoesNotAffectFreshBuffers() {
        var currentTime: TimeInterval = 1000
        let clock: () -> Date = { Date(timeIntervalSince1970: currentTime) }
        let small = MiWarpChunkAssembler(messageTimeout: 60, now: clock)

        _ = small.handleMessage(chunkBegin(msgId: "m1", total: 1))
        currentTime += 30
        small.cleanupExpired()
        XCTAssertEqual(small.activeCount, 1)
    }

    // MARK: - chunk_end

    func testChunkEndWithAllPartsDelivers() {
        // When all parts arrive via chunk, auto-completes on the last chunk.
        // chunk_end on an already-consumed buffer returns .consumed.
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 1))
        let r1 = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "x"))
        XCTAssertEqual(r1, .completed("x"))
        let r2 = assembler.handleMessage(chunkEnd(msgId: "m1"))
        XCTAssertEqual(r2, .consumed)
    }

    func testChunkEndIncompleteDiscards() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))
        let r = assembler.handleMessage(chunkEnd(msgId: "m1"))
        if case .discarded(let reason) = r {
            XCTAssertTrue(reason.contains("incomplete"))
        } else {
            XCTFail("Expected discarded for incomplete")
        }
        XCTAssertEqual(assembler.activeCount, 0)
    }

    func testChunkEndUnknownMsgIdConsumed() {
        let r = assembler.handleMessage(chunkEnd(msgId: "unknown"))
        XCTAssertEqual(r, .consumed)
    }

    // MARK: - Reset

    func testResetClearsAllBuffers() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = assembler.handleMessage(chunkBegin(msgId: "m2", total: 3))
        XCTAssertEqual(assembler.activeCount, 2)

        assembler.reset()
        XCTAssertEqual(assembler.activeCount, 0)
        XCTAssertEqual(assembler.bufferedByteCount, 0)
    }

    // MARK: - Non-chunk passthrough

    func testNonChunkMessageReturnsNotChunk() {
        let r = assembler.handleMessage(nonChunkMessage())
        XCTAssertEqual(r, .notChunk)
    }

    func testInvalidJsonReturnsNotChunk() {
        let r = assembler.handleMessage(Data("not json".utf8))
        XCTAssertEqual(r, .notChunk)
    }

    // MARK: - Multiple concurrent messages

    func testMultipleConcurrentMessages() {
        _ = assembler.handleMessage(chunkBegin(msgId: "m1", total: 2))
        _ = assembler.handleMessage(chunkBegin(msgId: "m2", total: 2))
        XCTAssertEqual(assembler.activeCount, 2)

        _ = assembler.handleMessage(chunk(msgId: "m1", idx: 0, data: "a"))
        _ = assembler.handleMessage(chunk(msgId: "m2", idx: 0, data: "x"))
        // m2 auto-completes on last chunk
        let r2 = assembler.handleMessage(chunk(msgId: "m2", idx: 1, data: "y"))
        XCTAssertEqual(r2, .completed("xy"))

        // m1 auto-completes on last chunk
        let r1 = assembler.handleMessage(chunk(msgId: "m1", idx: 1, data: "b"))
        XCTAssertEqual(r1, .completed("ab"))
        XCTAssertEqual(assembler.activeCount, 0)
    }

    // MARK: - Malformed chunk_begin

    func testMissingMsgIdInBegin() {
        let data = try! JSONSerialization.data(withJSONObject: ["type": "chunk_begin", "total": 1])
        let r = assembler.handleMessage(data)
        if case .discarded = r {} else { XCTFail("Expected discarded") }
    }

    func testMissingTotalInBegin() {
        let data = try! JSONSerialization.data(withJSONObject: ["type": "chunk_begin", "msg_id": "m1"])
        let r = assembler.handleMessage(data)
        if case .discarded = r {} else { XCTFail("Expected discarded") }
    }

    func testZeroTotalInBegin() {
        let r = assembler.handleMessage(chunkBegin(msgId: "m1", total: 0))
        if case .discarded = r {} else { XCTFail("Expected discarded") }
    }

    func testNegativeTotalInBegin() {
        let data = try! JSONSerialization.data(withJSONObject: ["type": "chunk_begin", "msg_id": "m1", "total": -1])
        let r = assembler.handleMessage(data)
        if case .discarded = r {} else { XCTFail("Expected discarded") }
    }
}

// Equatable conformance for test assertions
extension ChunkAssemblerResult: Equatable {
    public static func == (lhs: ChunkAssemblerResult, rhs: ChunkAssemblerResult) -> Bool {
        switch (lhs, rhs) {
        case (.notChunk, .notChunk): return true
        case (.consumed, .consumed): return true
        case (.completed(let a), .completed(let b)): return a == b
        case (.discarded, .discarded): return true // ignore reason for equality
        default: return false
        }
    }
}
