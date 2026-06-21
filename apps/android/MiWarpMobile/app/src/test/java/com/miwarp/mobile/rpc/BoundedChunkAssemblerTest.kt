package com.miwarp.mobile.rpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BoundedChunkAssemblerTest {

    private val assembler = BoundedChunkAssembler()

    // --- helpers ---

    private fun chunkBegin(msgId: String, total: Int, size: Int? = null): String {
        val sizePart = if (size != null) ",\"size\":$size" else ""
        return """{"type":"chunk_begin","msg_id":"$msgId","total":$total$sizePart}"""
    }

    private fun chunk(msgId: String, idx: Int, data: String): String {
        // Properly escape the data string for JSON
        val escaped = data.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
        return """{"type":"chunk","msg_id":"$msgId","idx":$idx,"data":"$escaped"}"""
    }

    private fun chunkEnd(msgId: String): String {
        return """{"type":"chunk_end","msg_id":"$msgId"}"""
    }

    private fun nonChunkMessage(): String {
        return """{"event":"bus-event","payload":"test"}"""
    }

    // --- normal assembly ---

    @Test
    fun `assembles 2-chunk message`() {
        assertTrue(assembler.handleMessage(chunkBegin("m1", 2)) is BoundedChunkAssembler.Result.Consumed)
        assertTrue(assembler.handleMessage(chunk("m1", 0, "{\"hello\":")) is BoundedChunkAssembler.Result.Consumed)
        val r = assembler.handleMessage(chunk("m1", 1, "\"world\"}"))
        assertTrue(r is BoundedChunkAssembler.Result.Completed)
        assertEquals("""{"hello":"world"}""", (r as BoundedChunkAssembler.Result.Completed).payload)
        assertEquals(0, assembler.activeCount)
    }

    @Test
    fun `assembles 3-chunk message`() {
        assembler.handleMessage(chunkBegin("m1", 3))
        assembler.handleMessage(chunk("m1", 0, "a"))
        assembler.handleMessage(chunk("m1", 1, "b"))
        val r = assembler.handleMessage(chunk("m1", 2, "c"))
        assertTrue(r is BoundedChunkAssembler.Result.Completed)
        assertEquals("abc", (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    // --- out of order ---

    @Test
    fun `handles out-of-order chunks`() {
        assembler.handleMessage(chunkBegin("m1", 3))
        assembler.handleMessage(chunk("m1", 2, "c"))
        assembler.handleMessage(chunk("m1", 0, "a"))
        val r = assembler.handleMessage(chunk("m1", 1, "b"))
        assertEquals("abc", (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    // --- Chinese / emoji UTF-8 ---

    @Test
    fun `handles Chinese characters`() {
        val chinese = "你好世界"
        val utf8Bytes = chinese.toByteArray(Charsets.UTF_8).size
        assembler.handleMessage(chunkBegin("m1", 1, utf8Bytes))
        val r = assembler.handleMessage(chunk("m1", 0, chinese))
        assertEquals(chinese, (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    @Test
    fun `handles emoji`() {
        val emoji = "🚀🎉"
        val utf8Bytes = emoji.toByteArray(Charsets.UTF_8).size
        assembler.handleMessage(chunkBegin("m1", 1, utf8Bytes))
        val r = assembler.handleMessage(chunk("m1", 0, emoji))
        assertEquals(emoji, (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    @Test
    fun `handles mixed UTF-8 across chunks`() {
        val part1 = "Hello "
        val part2 = "世界"
        val part3 = " 🌍"
        val full = part1 + part2 + part3
        val utf8Bytes = full.toByteArray(Charsets.UTF_8).size
        assembler.handleMessage(chunkBegin("m1", 3, utf8Bytes))
        assembler.handleMessage(chunk("m1", 0, part1))
        assembler.handleMessage(chunk("m1", 1, part2))
        val r = assembler.handleMessage(chunk("m1", 2, part3))
        assertEquals(full, (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    // --- escaped quote / backslash ---

    @Test
    fun `handles escaped quote in data`() {
        val data = """he said \"hello\""""
        assembler.handleMessage(chunkBegin("m1", 1))
        val r = assembler.handleMessage(chunk("m1", 0, data))
        assertEquals(data, (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    @Test
    fun `handles escaped backslash in data`() {
        val data = """path\\to\\file"""
        assembler.handleMessage(chunkBegin("m1", 1))
        val r = assembler.handleMessage(chunk("m1", 0, data))
        assertEquals(data, (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    @Test
    fun `handles escaped newline in data`() {
        val data = "line1\\nline2\\nline3"
        assembler.handleMessage(chunkBegin("m1", 1))
        val r = assembler.handleMessage(chunk("m1", 0, data))
        assertEquals(data, (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    // --- duplicate begin ---

    @Test
    fun `duplicate begin discards second`() {
        assembler.handleMessage(chunkBegin("m1", 2))
        assembler.handleMessage(chunk("m1", 0, "a"))
        val dup = assembler.handleMessage(chunkBegin("m1", 1))
        assertTrue(dup is BoundedChunkAssembler.Result.Discarded)
        assertTrue((dup as BoundedChunkAssembler.Result.Discarded).reason.contains("duplicate"))

        val r = assembler.handleMessage(chunk("m1", 1, "b"))
        assertEquals("ab", (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    // --- duplicate part ---

    @Test
    fun `duplicate part ignored`() {
        assembler.handleMessage(chunkBegin("m1", 2))
        assembler.handleMessage(chunk("m1", 0, "a"))
        val dup = assembler.handleMessage(chunk("m1", 0, "X"))
        assertTrue(dup is BoundedChunkAssembler.Result.Consumed)

        val r = assembler.handleMessage(chunk("m1", 1, "b"))
        assertEquals("ab", (r as BoundedChunkAssembler.Result.Completed).payload)
    }

    // --- out-of-range index ---

    @Test
    fun `out-of-range index discards affected message`() {
        assembler.handleMessage(chunkBegin("m1", 2))
        assembler.handleMessage(chunk("m1", 0, "a"))

        val result = assembler.handleMessage(chunk("m1", 5, "x"))
        assertTrue(result is BoundedChunkAssembler.Result.Discarded)
        assertTrue((result as BoundedChunkAssembler.Result.Discarded).reason.contains("index out of range"))
        assertEquals(0, assembler.activeCount)
        assertEquals(0, assembler.bufferedByteCount)
        assertTrue(assembler.handleMessage(chunk("m1", 1, "b")) is BoundedChunkAssembler.Result.Consumed)
    }

    // --- orphan chunk ---

    @Test
    fun `orphan chunk ignored`() {
        val r = assembler.handleMessage(chunk("unknown", 0, "x"))
        assertTrue(r is BoundedChunkAssembler.Result.Consumed)
    }

    // --- max chunks per message ---

    @Test
    fun `max chunks per message rejects`() {
        val small = BoundedChunkAssembler(maxChunksPerMessage = 2)
        val r = small.handleMessage(chunkBegin("m1", 5))
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
        assertTrue((r as BoundedChunkAssembler.Result.Discarded).reason.contains("exceeds max"))
        assertEquals(0, small.activeCount)
    }

    // --- max active messages ---

    @Test
    fun `max active messages rejects new begin without eviction`() {
        val small = BoundedChunkAssembler(maxActiveMessages = 2)
        small.handleMessage(chunkBegin("m1", 2))
        small.handleMessage(chunkBegin("m2", 2))

        val result = small.handleMessage(chunkBegin("m3", 1))
        assertTrue(result is BoundedChunkAssembler.Result.Discarded)
        assertTrue((result as BoundedChunkAssembler.Result.Discarded).reason.contains("active message limit"))
        assertEquals(2, small.activeCount)

        small.handleMessage(chunk("m1", 0, "a"))
        val completed = small.handleMessage(chunk("m1", 1, "b"))
        assertEquals("ab", (completed as BoundedChunkAssembler.Result.Completed).payload)
    }

    // --- per-message bytes ---

    @Test
    fun `per-message bytes limit`() {
        val small = BoundedChunkAssembler(maxBytesPerMessage = 10)
        small.handleMessage(chunkBegin("m1", 2))
        small.handleMessage(chunk("m1", 0, "1234567890")) // 10 bytes
        val r = small.handleMessage(chunk("m1", 1, "x")) // 11 total
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
        assertTrue((r as BoundedChunkAssembler.Result.Discarded).reason.contains("per-message byte limit"))
        assertEquals(0, small.activeCount)
    }

    // --- global bytes ---

    @Test
    fun `global bytes limit`() {
        val small = BoundedChunkAssembler(maxBytesPerMessage = 100, maxTotalBufferedBytes = 15)
        small.handleMessage(chunkBegin("m1", 2))
        small.handleMessage(chunkBegin("m2", 2))
        small.handleMessage(chunk("m1", 0, "12345678")) // 8 bytes buffered
        val r = small.handleMessage(chunk("m2", 0, "12345678")) // 16 total exceeds 15
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
        assertTrue((r as BoundedChunkAssembler.Result.Discarded).reason.contains("global byte limit"))
    }

    // --- UTF-8 bytes (not code units) ---

    @Test
    fun `UTF-8 byte counting`() {
        val small = BoundedChunkAssembler(maxBytesPerMessage = 5)
        small.handleMessage(chunkBegin("m1", 1))
        // "你好" = 6 UTF-8 bytes, exceeds 5
        val r = small.handleMessage(chunk("m1", 0, "你好"))
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
        assertEquals(0, small.activeCount)
    }

    // --- declared size mismatch ---

    @Test
    fun `declared size mismatch discards`() {
        assembler.handleMessage(chunkBegin("m1", 1, 4))
        val r = assembler.handleMessage(chunk("m1", 0, "abc")) // 3 != 4
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
        assertTrue((r as BoundedChunkAssembler.Result.Discarded).reason.contains("size mismatch"))
    }

    @Test
    fun `declared size oversized rejects begin`() {
        val r = assembler.handleMessage(chunkBegin("m1", 1, 11 * 1024 * 1024))
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
        assertTrue((r as BoundedChunkAssembler.Result.Discarded).reason.contains("exceeds max"))
        assertEquals(0, assembler.activeCount)
    }

    // --- timeout ---

    @Test
    fun `handle message cleans expired buffers before consume`() {
        var currentTime = 1000L
        val small = BoundedChunkAssembler(messageTimeoutMs = 5000, now = { currentTime })

        small.handleMessage(chunkBegin("m1", 2))
        small.handleMessage(chunk("m1", 0, "stale"))
        assertEquals(1, small.activeCount)
        assertEquals(5, small.bufferedByteCount)

        currentTime += 6000
        small.handleMessage(chunkBegin("m2", 1))
        assertEquals(1, small.activeCount)
        assertEquals(0, small.bufferedByteCount)
        val completed = small.handleMessage(chunk("m2", 0, "fresh"))
        assertEquals("fresh", (completed as BoundedChunkAssembler.Result.Completed).payload)
    }

    @Test
    fun `timeout does not affect fresh buffers`() {
        var currentTime = 1000L
        val small = BoundedChunkAssembler(messageTimeoutMs = 60_000, now = { currentTime })

        small.handleMessage(chunkBegin("m1", 1))
        currentTime += 30_000
        small.cleanupExpired()
        assertEquals(1, small.activeCount)
    }

    // --- chunk_end ---

    @Test
    fun `chunk_end with all parts delivers`() {
        // Auto-completes on last chunk; chunk_end on consumed buffer returns Consumed
        assembler.handleMessage(chunkBegin("m1", 1))
        val r1 = assembler.handleMessage(chunk("m1", 0, "x"))
        assertEquals("x", (r1 as BoundedChunkAssembler.Result.Completed).payload)
        val r2 = assembler.handleMessage(chunkEnd("m1"))
        assertTrue(r2 is BoundedChunkAssembler.Result.Consumed)
    }

    @Test
    fun `chunk_end incomplete discards`() {
        assembler.handleMessage(chunkBegin("m1", 2))
        assembler.handleMessage(chunk("m1", 0, "a"))
        val r = assembler.handleMessage(chunkEnd("m1"))
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
        assertTrue((r as BoundedChunkAssembler.Result.Discarded).reason.contains("incomplete"))
        assertEquals(0, assembler.activeCount)
    }

    @Test
    fun `chunk_end unknown msg_id consumed`() {
        val r = assembler.handleMessage(chunkEnd("unknown"))
        assertTrue(r is BoundedChunkAssembler.Result.Consumed)
    }

    // --- reset ---

    @Test
    fun `reset clears all buffers`() {
        assembler.handleMessage(chunkBegin("m1", 2))
        assembler.handleMessage(chunkBegin("m2", 3))
        assertEquals(2, assembler.activeCount)

        assembler.reset()
        assertEquals(0, assembler.activeCount)
        assertEquals(0, assembler.bufferedByteCount)
    }

    // --- non-chunk passthrough ---

    @Test
    fun `non-chunk message returns NotChunk`() {
        val r = assembler.handleMessage(nonChunkMessage())
        assertTrue(r is BoundedChunkAssembler.Result.NotChunk)
    }

    @Test
    fun `invalid JSON returns NotChunk`() {
        val r = assembler.handleMessage("not json")
        assertTrue(r is BoundedChunkAssembler.Result.NotChunk)
    }

    // --- multiple concurrent messages ---

    @Test
    fun `multiple concurrent messages`() {
        assembler.handleMessage(chunkBegin("m1", 2))
        assembler.handleMessage(chunkBegin("m2", 2))
        assertEquals(2, assembler.activeCount)

        assembler.handleMessage(chunk("m1", 0, "a"))
        assembler.handleMessage(chunk("m2", 0, "x"))
        // m2 auto-completes on last chunk
        val r2 = assembler.handleMessage(chunk("m2", 1, "y"))
        assertEquals("xy", (r2 as BoundedChunkAssembler.Result.Completed).payload)

        // m1 auto-completes on last chunk
        val r1 = assembler.handleMessage(chunk("m1", 1, "b"))
        assertEquals("ab", (r1 as BoundedChunkAssembler.Result.Completed).payload)
        assertEquals(0, assembler.activeCount)
    }

    // --- malformed chunk_begin ---

    @Test
    fun `missing msg_id in begin`() {
        val r = assembler.handleMessage("""{"type":"chunk_begin","total":1}""")
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
    }

    @Test
    fun `missing total in begin`() {
        val r = assembler.handleMessage("""{"type":"chunk_begin","msg_id":"m1"}""")
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
    }

    @Test
    fun `zero total in begin`() {
        val r = assembler.handleMessage(chunkBegin("m1", 0))
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
    }

    @Test
    fun `negative total in begin`() {
        val r = assembler.handleMessage("""{"type":"chunk_begin","msg_id":"m1","total":-1}""")
        assertTrue(r is BoundedChunkAssembler.Result.Discarded)
    }
}
