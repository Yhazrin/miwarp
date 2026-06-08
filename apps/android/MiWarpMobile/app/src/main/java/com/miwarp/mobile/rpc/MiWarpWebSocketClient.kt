package com.miwarp.mobile.rpc

import com.miwarp.mobile.model.ConnectionState
import com.miwarp.mobile.util.Logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class MiWarpWebSocketClient(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var currentUrl: String = ""

    private val pendingRequests = ConcurrentHashMap<String, CompletableDeferred<RpcResponse>>()

    private val _connectionState = MutableStateFlow(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _broadcastEvents = MutableSharedFlow<RpcBroadcast>(extraBufferCapacity = 256)
    val broadcastEvents: SharedFlow<RpcBroadcast> = _broadcastEvents.asSharedFlow()

    private var reconnectAttempt = 0
    private var shouldReconnect = false
    private var reconnectJob: kotlinx.coroutines.Job? = null

    // v1.0.6 / 3.5: chunk reassembly buffers (msg_id → ChunkBuffer)
    private data class ChunkBuffer(val total: Int, val parts: ConcurrentHashMap<Int, String> = ConcurrentHashMap())
    private val chunkBuffers = ConcurrentHashMap<String, ChunkBuffer>()

    private val baseDelayMs = 1000L
    private val maxDelayMs = 30_000L
    private val maxReconnectAttempts = 20

    /** RPC request timeout in milliseconds */
    private val rpcTimeoutMs = 30_000L

    private var currentToken: String = ""

    fun connect(url: String, token: String = "") {
        if (_connectionState.value == ConnectionState.Connected && currentUrl == url) return
        disconnect()
        currentUrl = url
        currentToken = token
        shouldReconnect = true
        reconnectAttempt = 0
        doConnect()
    }

    fun disconnect() {
        shouldReconnect = false
        reconnectJob?.cancel()
        reconnectJob = null
        webSocket?.close(1000, "Client disconnect")
        webSocket = null
        _connectionState.value = ConnectionState.Disconnected
        pendingRequests.values.forEach { it.completeExceptionally(DisconnectedException()) }
        pendingRequests.clear()
    }

    private fun doConnect() {
        _connectionState.value = if (reconnectAttempt == 0) ConnectionState.Connecting else ConnectionState.Reconnecting

        val redactedUrl = currentUrl

        // v1.0.6: pass token via Authorization header (not URL query) for security
        val requestBuilder = Request.Builder().url(currentUrl)
        if (currentToken.isNotBlank()) {
            requestBuilder.addHeader("Authorization", "Bearer $currentToken")
            requestBuilder.addHeader("X-MiWarp-Token", currentToken)
        }
        val request = requestBuilder.build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Logger.wsInfo("WebSocket connected to $redactedUrl")
                reconnectAttempt = 0
                _connectionState.value = ConnectionState.Connected
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    handleMessage(text)
                } catch (e: Exception) {
                    Logger.wsError("Error handling WebSocket message", e)
                }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(code, reason)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                // Ignore stale callbacks from previous connections
                if (ws !== webSocket) return
                Logger.wsInfo("WebSocket closed: $code $reason")

                // 4401 = token rotated / session expired / token version mismatch
                // Reconnecting won't help — surface auth error immediately
                if (code == 4401) {
                    _connectionState.value = ConnectionState.AuthFailed
                    return
                }

                _connectionState.value = ConnectionState.Disconnected
                scheduleReconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (ws !== webSocket) return
                Logger.wsError("WebSocket failure", t)
                _connectionState.value = ConnectionState.Error
                // Fail all pending requests immediately instead of waiting for timeout
                val error = RpcResponse(id = null, error = "Connection lost: ${t.message}")
                pendingRequests.values.forEach { it.complete(error) }
                pendingRequests.clear()
                scheduleReconnect()
            }
        })
    }

    private fun handleMessage(text: String) {
        val trimmed = text.trim()

        // v1.0.6 / 3.5: check for chunk protocol messages
        if (handleChunkMessage(trimmed)) return

        // Try parsing as RPC response first (has "id")
        if (trimmed.contains("\"id\"")) {
            try {
                val response = json.decodeFromString<RpcResponse>(trimmed)
                if (response.id != null) {
                    val deferred = pendingRequests.remove(response.id)
                    deferred?.complete(response) ?: run {
                        // Might be a broadcast with an id field we don't expect
                        scope.launch {
                            _broadcastEvents.emit(
                                RpcBroadcast(event = "raw", seq = 0L, runId = "")
                            )
                        }
                    }
                    return
                }
            } catch (_: Exception) {
                // Not an RPC response, try broadcast
            }
        }

        // Try parsing as broadcast
        try {
            val broadcast = json.decodeFromString<RpcBroadcast>(trimmed)
            scope.launch {
                _broadcastEvents.emit(broadcast)
            }
        } catch (e: Exception) {
            Logger.w("Failed to parse message: ${e.message}")
        }
    }

    /**
     * v1.0.6 / 3.5: Handle chunk protocol messages.
     * Returns true if the message was consumed as a chunk message.
     */
    private fun handleChunkMessage(text: String): Boolean {
        // Quick type extraction
        val typeMatch = Regex(""""type"\s*:\s*"([^"]+)"""").find(text) ?: return false
        val type = typeMatch.groupValues[1]

        return when (type) {
            "chunk_begin" -> {
                val msgId = Regex(""""msg_id"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1) ?: return true
                val total = Regex(""""total"\s*:\s*(\d+)""").find(text)?.groupValues?.get(1)?.toIntOrNull() ?: return true
                chunkBuffers[msgId] = ChunkBuffer(total)
                true
            }
            "chunk" -> {
                val msgId = Regex(""""msg_id"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1) ?: return true
                val idx = Regex(""""idx"\s*:\s*(\d+)""").find(text)?.groupValues?.get(1)?.toIntOrNull() ?: return true
                val data = Regex(""""data"\s*:\s*"((?:[^"\\]|\\.)*)"""").find(text)?.groupValues?.get(1) ?: return true
                val buffer = chunkBuffers[msgId] ?: return true
                buffer.parts[idx] = data

                // Check if all parts received
                if (buffer.parts.size == buffer.total) {
                    val combined = (0 until buffer.total).map { buffer.parts[it] ?: "" }.joinToString("")
                    chunkBuffers.remove(msgId)
                    Logger.wsInfo("Chunk reassembly complete: $msgId (${combined.length} chars)")
                    handleMessage(combined)
                }
                true
            }
            "chunk_end" -> {
                val msgId = Regex(""""msg_id"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1) ?: return true
                chunkBuffers.remove(msgId)
                true
            }
            else -> false
        }
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        if (reconnectAttempt >= maxReconnectAttempts) {
            Logger.wsError("Max reconnect attempts ($maxReconnectAttempts) reached")
            _connectionState.value = ConnectionState.Error
            return
        }
        reconnectJob = scope.launch {
            val delayMs = calculateBackoff(reconnectAttempt)
            Logger.wsInfo("Reconnecting in ${delayMs}ms (attempt ${reconnectAttempt + 1}/$maxReconnectAttempts)")
            delay(delayMs)
            reconnectAttempt++
            doConnect()
        }
    }

    private fun calculateBackoff(attempt: Int): Long {
        val delay = baseDelayMs * (1L shl minOf(attempt, 5))
        return minOf(delay, maxDelayMs)
    }

    suspend fun sendRequest(method: String, params: JsonElement? = null): RpcResponse {
        val ws = webSocket ?: throw DisconnectedException()
        if (_connectionState.value != ConnectionState.Connected) throw DisconnectedException()

        val id = UUID.randomUUID().toString()
        val request = RpcRequest(id = id, method = method, params = params)
        val jsonStr = json.encodeToString(request)

        val deferred = CompletableDeferred<RpcResponse>()
        pendingRequests[id] = deferred

        Logger.rpcDebug("RPC -> $method (id=$id)")

        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation {
                pendingRequests.remove(id)
            }

            if (!ws.send(jsonStr)) {
                pendingRequests.remove(id)
                continuation.resumeWithException(SendFailedException())
                return@suspendCancellableCoroutine
            }

            scope.launch {
                try {
                    val response = withTimeoutOrNull(rpcTimeoutMs) {
                        deferred.await()
                    }
                    if (response != null) {
                        Logger.rpcDebug("RPC <- $method (id=$id) ok")
                        continuation.resume(response)
                    } else {
                        pendingRequests.remove(id)
                        Logger.rpcError("RPC timeout: $method (id=$id)")
                        continuation.resumeWithException(RpcTimeoutException(method))
                    }
                } catch (e: Exception) {
                    if (continuation.isActive) {
                        continuation.resumeWithException(e)
                    }
                }
            }
        }
    }
}

class DisconnectedException : Exception("WebSocket is not connected")
class SendFailedException : Exception("Failed to send WebSocket message")
class RpcTimeoutException(method: String) : Exception("RPC timeout: $method")
