package com.miwarp.mobile.rpc

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Bounded chunk assembly for fragmented WebSocket messages.
 *
 * Protocol invariants:
 * - max logical message bytes = 10 MiB (UTF-8)
 * - max chunks per message = 1000
 * - max active messages = 50
 * - max total buffered bytes = 10 MiB
 * - message timeout = 60s; cleaned on consume and reset on disconnect
 * - chunk_begin validates msg_id, total, optional size; rejects duplicate begin
 * - chunk validates idx range, duplicate part, UTF-8 bytes, per-message/global bytes
 * - completion requires indices 0..<total; validates declared size vs actual UTF-8
 * - chunk_end on incomplete buffer → discard with log; on completed → consumed
 * - malformed/oversized chunk discards only the affected message, not the connection
 */
class BoundedChunkAssembler(
    private val maxActiveMessages: Int = DEFAULT_MAX_ACTIVE_MESSAGES,
    private val maxChunksPerMessage: Int = DEFAULT_MAX_CHUNKS_PER_MESSAGE,
    private val maxBytesPerMessage: Int = DEFAULT_MAX_BYTES_PER_MESSAGE,
    private val maxTotalBufferedBytes: Int = DEFAULT_MAX_TOTAL_BUFFERED_BYTES,
    private val messageTimeoutMs: Long = DEFAULT_MESSAGE_TIMEOUT_MS,
    private val now: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val DEFAULT_MAX_ACTIVE_MESSAGES = 50
        const val DEFAULT_MAX_CHUNKS_PER_MESSAGE = 1000
        const val DEFAULT_MAX_BYTES_PER_MESSAGE = 10 * 1024 * 1024 // 10 MiB
        const val DEFAULT_MAX_TOTAL_BUFFERED_BYTES = 10 * 1024 * 1024 // 10 MiB
        const val DEFAULT_MESSAGE_TIMEOUT_MS = 60_000L
    }

    sealed class Result {
        /** Not a chunk protocol message — caller should handle normally. */
        data object NotChunk : Result()
        /** Chunk was consumed (buffered, duplicate, or orphaned). */
        data object Consumed : Result()
        /** All chunks received and reassembled. */
        data class Completed(val payload: String) : Result()
        /** Buffer discarded due to error. */
        data class Discarded(val reason: String) : Result()
    }

    private data class ChunkBuffer(
        val total: Int,
        val declaredBytes: Int?,
        val parts: MutableMap<Int, String> = mutableMapOf(),
        var actualBytes: Int = 0,
        val createdAt: Long,
    )

    private val lock = Any()
    private val buffers = mutableMapOf<String, ChunkBuffer>()
    private var totalBufferedBytes = 0

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    val activeCount: Int get() = synchronized(lock) { buffers.size }
    val bufferedByteCount: Int get() = synchronized(lock) { totalBufferedBytes }

    /**
     * Process a raw WebSocket text message.
     * Returns [Result.NotChunk] if the message is not a chunk protocol message.
     */
    fun handleMessage(text: String): Result {
        val trimmed = text.trim()
        val type = extractType(trimmed) ?: return Result.NotChunk

        cleanupExpired()

        return when (type) {
            "chunk_begin" -> handleChunkBegin(trimmed)
            "chunk" -> handleChunk(trimmed)
            "chunk_end" -> handleChunkEnd(trimmed)
            else -> Result.NotChunk
        }
    }

    /** Clear all buffers. Call on disconnect/cancel. */
    fun reset() {
        synchronized(lock) {
            buffers.clear()
            totalBufferedBytes = 0
        }
    }

    /** Remove stale incomplete messages. Call periodically or before consume. */
    fun cleanupExpired() {
        val currentTime = now()
        synchronized(lock) {
            val expired = buffers.filter { (_, buffer) ->
                currentTime - buffer.createdAt > messageTimeoutMs
            }
            for ((id, buffer) in expired) {
                buffers.remove(id)
                totalBufferedBytes -= buffer.actualBytes
            }
        }
    }

    // --- chunk_begin ---

    private fun handleChunkBegin(text: String): Result {
        val obj = parseJsonObject(text) ?: return Result.Discarded("chunk_begin: invalid JSON")
        val msgId = obj["msg_id"]?.jsonPrimitive?.contentOrNull
        if (msgId.isNullOrEmpty()) return Result.Discarded("chunk_begin: missing or empty msg_id")
        val total = obj["total"]?.jsonPrimitive?.intOrNull
        if (total == null || total <= 0) return Result.Discarded("chunk_begin: invalid total for msg_id=$msgId")
        val declaredBytes = obj["size"]?.jsonPrimitive?.intOrNull

        synchronized(lock) {
            if (total > maxChunksPerMessage) {
                return Result.Discarded("chunk_begin total=$total exceeds max=$maxChunksPerMessage for msg_id=$msgId")
            }
            if (declaredBytes != null && (declaredBytes < 0 || declaredBytes > maxBytesPerMessage)) {
                return Result.Discarded("chunk_begin size=$declaredBytes exceeds max=$maxBytesPerMessage for msg_id=$msgId")
            }
            if (buffers.containsKey(msgId)) {
                return Result.Discarded("chunk_begin duplicate for msg_id=$msgId")
            }
            if (buffers.size >= maxActiveMessages) {
                return Result.Discarded(
                    "chunk_begin active message limit reached: ${buffers.size}/$maxActiveMessages for msg_id=$msgId",
                )
            }
            buffers[msgId] = ChunkBuffer(
                total = total,
                declaredBytes = declaredBytes,
                createdAt = now(),
            )
        }
        return Result.Consumed
    }

    // --- chunk ---

    private fun handleChunk(text: String): Result {
        val obj = parseJsonObject(text) ?: return Result.Consumed
        val msgId = obj["msg_id"]?.jsonPrimitive?.contentOrNull
        if (msgId.isNullOrEmpty()) return Result.Consumed
        val idx = obj["idx"]?.jsonPrimitive?.intOrNull ?: return Result.Consumed
        val data = obj["data"]?.jsonPrimitive?.contentOrNull ?: return Result.Consumed

        synchronized(lock) {
            val buffer = buffers[msgId] ?: return Result.Consumed // orphan

            if (buffer.parts.containsKey(idx)) return Result.Consumed // duplicate
            if (idx < 0 || idx >= buffer.total) {
                buffers.remove(msgId)
                totalBufferedBytes -= buffer.actualBytes
                return Result.Discarded(
                    "chunk msg_id=$msgId index out of range: $idx not in 0..<${buffer.total}",
                )
            }

            val chunkBytes = data.toByteArray(Charsets.UTF_8).size
            val newMessageBytes = buffer.actualBytes + chunkBytes
            if (newMessageBytes > maxBytesPerMessage) {
                buffers.remove(msgId)
                totalBufferedBytes -= buffer.actualBytes
                return Result.Discarded("chunk msg_id=$msgId exceeds per-message byte limit: $newMessageBytes > $maxBytesPerMessage")
            }
            val newGlobalBytes = totalBufferedBytes + chunkBytes
            if (newGlobalBytes > maxTotalBufferedBytes) {
                buffers.remove(msgId)
                totalBufferedBytes -= buffer.actualBytes
                return Result.Discarded("chunk msg_id=$msgId exceeds global byte limit: $newGlobalBytes > $maxTotalBufferedBytes")
            }

            buffer.parts[idx] = data
            buffer.actualBytes = newMessageBytes
            totalBufferedBytes += chunkBytes

            if (buffer.parts.size == buffer.total) {
                return assembleAndDeliver(msgId, buffer)
            }
        }
        return Result.Consumed
    }

    // --- chunk_end ---

    private fun handleChunkEnd(text: String): Result {
        val obj = parseJsonObject(text) ?: return Result.Consumed
        val msgId = obj["msg_id"]?.jsonPrimitive?.contentOrNull
        if (msgId.isNullOrEmpty()) return Result.Consumed

        synchronized(lock) {
            val buffer = buffers[msgId] ?: return Result.Consumed

            if (buffer.parts.size == buffer.total) {
                return assembleAndDeliver(msgId, buffer)
            } else {
                buffers.remove(msgId)
                totalBufferedBytes -= buffer.actualBytes
                return Result.Discarded("chunk_end incomplete for msg_id=$msgId: ${buffer.parts.size}/${buffer.total} parts")
            }
        }
    }

    // --- assembly ---

    private fun assembleAndDeliver(msgId: String, buffer: ChunkBuffer): Result {
        // Must be called with lock held
        buffers.remove(msgId)
        totalBufferedBytes -= buffer.actualBytes

        val assembled = (0 until buffer.total)
            .map { buffer.parts[it] ?: "" }
            .joinToString("")

        // Verify all indices present
        val expectedIndices = (0 until buffer.total).toSet()
        val actualIndices = buffer.parts.keys.toSet()
        if (actualIndices != expectedIndices) {
            return Result.Discarded("chunk msg_id=$msgId missing indices")
        }

        // Validate declared size vs actual UTF-8 bytes
        val actualBytes = assembled.toByteArray(Charsets.UTF_8).size
        if (buffer.declaredBytes != null && actualBytes != buffer.declaredBytes) {
            return Result.Discarded("chunk msg_id=$msgId size mismatch: declared=${buffer.declaredBytes} actual=$actualBytes")
        }

        return Result.Completed(assembled)
    }

    // --- helpers ---

    private fun extractType(text: String): String? {
        return try {
            val obj = json.decodeFromString<JsonObject>(text)
            obj["type"]?.jsonPrimitive?.contentOrNull
        } catch (_: Exception) {
            null
        }
    }

    private fun parseJsonObject(text: String): JsonObject? {
        return try {
            json.decodeFromString<JsonObject>(text)
        } catch (_: Exception) {
            null
        }
    }
}
