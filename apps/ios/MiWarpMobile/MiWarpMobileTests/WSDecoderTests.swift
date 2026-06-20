import XCTest
@testable import MiWarpMobile

final class WSDecoderTests: XCTestCase {

    // MARK: - WSChunkReassembler

    func testReassemblerIgnoresNonChunkFrames() {
        let reassembler = WSChunkReassembler()
        let normalFrame = #"{"event":"bus-event","seq":1}"#.data(using: .utf8)!
        XCTAssertNil(reassembler.accept(normalFrame))
    }

    func testReassemblerIgnoresMalformedJSON() {
        let reassembler = WSChunkReassembler()
        XCTAssertNil(reassembler.accept(Data("not json".utf8)))
    }

    func testReassemblerStoresBeginFrameAndYieldsChunkHandled() {
        let reassembler = WSChunkReassembler()
        let begin = #"{"type":"chunk_begin","msg_id":"m1","total":2}"#.data(using: .utf8)!
        guard let result = reassembler.accept(begin) else {
            return XCTFail("Expected accept() to return a result for chunk_begin")
        }
        if case .reassembled = result {
            return XCTFail("chunk_begin should not reassemble")
        }
    }

    func testReassemblerYieldsReassembledDataWhenAllChunksArrive() {
        let reassembler = WSChunkReassembler()
        let begin = #"{"type":"chunk_begin","msg_id":"m1","total":3}"#.data(using: .utf8)!
        let chunk0 = #"{"type":"chunk","msg_id":"m1","idx":0,"data":"Hel"}"#.data(using: .utf8)!
        let chunk2 = #"{"type":"chunk","msg_id":"m1","idx":2,"data":"rld"}"#.data(using: .utf8)!
        let chunk1 = #"{"type":"chunk","msg_id":"m1","idx":1,"data":"lo wo"}"#.data(using: .utf8)!

        _ = reassembler.accept(begin)
        guard case .chunkHandled = reassembler.accept(chunk0) else {
            return XCTFail("First chunk should not reassemble")
        }
        guard case .chunkHandled = reassembler.accept(chunk2) else {
            return XCTFail("Out-of-order chunk should not reassemble yet")
        }
        // Final chunk must be the one that triggers reassembly.
        let result = reassembler.accept(chunk1)
        guard case .reassembled(let data) = result else {
            return XCTFail("Expected reassembled data after final chunk")
        }
        XCTAssertEqual(String(data: data, encoding: .utf8), "Hello world")
    }

    func testReassemblerChunkEndClearsBuffer() {
        let reassembler = WSChunkReassembler()
        let begin = #"{"type":"chunk_begin","msg_id":"m1","total":2}"#.data(using: .utf8)!
        let end = #"{"type":"chunk_end","msg_id":"m1"}"#.data(using: .utf8)!

        _ = reassembler.accept(begin)
        if case .chunkHandled = reassembler.accept(end) {
            // expected
        } else {
            return XCTFail("chunk_end should return chunkHandled")
        }

        // After chunk_end, an incoming chunk for the same msg_id must not
        // reassemble (buffer should be gone).
        let lateChunk = #"{"type":"chunk","msg_id":"m1","idx":0,"data":"x"}"#.data(using: .utf8)!
        guard case .chunkHandled = reassembler.accept(lateChunk) else {
            return XCTFail("Late chunk should be accepted as chunkHandled")
        }
    }

    func testReassemblerHandlesChunkWithMissingFields() {
        let reassembler = WSChunkReassembler()
        let badChunk = #"{"type":"chunk","msg_id":"m1"}"#.data(using: .utf8)!
        guard case .chunkHandled = reassembler.accept(badChunk) else {
            return XCTFail("Malformed chunk should be tolerated")
        }
    }

    func testReassemblerConcurrentAccessIsSafe() async {
        let reassembler = WSChunkReassembler()
        let begin = #"{"type":"chunk_begin","msg_id":"m2","total":1}"#.data(using: .utf8)!
        let chunk = #"{"type":"chunk","msg_id":"m2","idx":0,"data":"x"}"#.data(using: .utf8)!

        // Drive the same reassembler from multiple tasks to confirm
        // NSLock protects the internal buffer (no crashes / data races).
        _ = reassembler.accept(begin)
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<32 {
                group.addTask { _ = reassembler.accept(chunk) }
            }
        }
    }
}
