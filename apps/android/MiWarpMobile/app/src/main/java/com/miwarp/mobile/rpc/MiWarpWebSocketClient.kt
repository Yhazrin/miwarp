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

    private val baseDelayMs = 1000L
    private val maxDelayMs = 30_000L
    private val maxReconnectAttempts = 20

    /** RPC request timeout in milliseconds */
    private val rpcTimeoutMs = 30_000L

    fun connect(url: String) {
        if (_connectionState.value == ConnectionState.Connected && currentUrl == url) return
        disconnect()
        currentUrl = url
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

        // Build URL with token redacted for logging
        val redactedUrl = currentUrl.replace(Regex("token=[^&]+"), "token=[REDACTED]")

        val request = Request.Builder().url(currentUrl).build()
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
