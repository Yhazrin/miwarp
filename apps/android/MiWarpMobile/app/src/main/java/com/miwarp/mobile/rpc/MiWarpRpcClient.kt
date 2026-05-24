package com.miwarp.mobile.rpc

import com.miwarp.mobile.model.BusEvent
import com.miwarp.mobile.model.BusEventEnvelope
import com.miwarp.mobile.model.ConnectionState
import com.miwarp.mobile.model.GitDiff
import com.miwarp.mobile.model.GitStatus
import com.miwarp.mobile.model.MiWarpRun
import com.miwarp.mobile.model.RunArtifacts
import com.miwarp.mobile.model.RunSource
import com.miwarp.mobile.model.RunStatus
import com.miwarp.mobile.model.WebServerStatus
import com.miwarp.mobile.util.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

class MiWarpRpcClient(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    val wsClient = MiWarpWebSocketClient(scope)

    val connectionState: StateFlow<ConnectionState> = wsClient.connectionState

    val rawBroadcastEvents: SharedFlow<RpcBroadcast> = wsClient.broadcastEvents

    fun connect(url: String) = wsClient.connect(url)

    fun disconnect() = wsClient.disconnect()

    fun broadcastBusEvents(): Flow<BusEvent> = rawBroadcastEvents.mapNotNull { envelope ->
        parseBusEvent(envelope)
    }

    // ── Dispatch methods ────────────────────────────────────────────────────

    suspend fun listRuns(): List<MiWarpRun> {
        val response = wsClient.sendRequest("list_runs")
        checkError(response)
        return response.result?.jsonArray?.map { element ->
            parseRun(element)
        } ?: emptyList()
    }

    suspend fun getRun(id: String): MiWarpRun {
        val params = json.encodeToJsonElement(GetRunParams.serializer(), GetRunParams(id))
        val response = wsClient.sendRequest("get_run", params)
        checkError(response)
        return parseRun(response.result!!)
    }

    suspend fun getBusEvents(id: String, sinceSeq: Long? = null): List<BusEvent> {
        val params = json.encodeToJsonElement(
            GetBusEventsParams.serializer(), GetBusEventsParams(id, sinceSeq)
        )
        val response = wsClient.sendRequest("get_bus_events", params)
        checkError(response)
        return response.result?.jsonArray?.mapNotNull { parseBusEventFromElement(it) } ?: emptyList()
    }

    suspend fun sendMessage(runId: String, message: String, attachments: List<Map<String, String>>? = null) {
        val params = json.encodeToJsonElement(
            SendMessageParams.serializer(), SendMessageParams(runId, message, attachments)
        )
        val response = wsClient.sendRequest("send_session_message", params)
        checkError(response)
    }

    suspend fun startSession(runId: String, mode: String? = null, initialMessage: String? = null) {
        val params = json.encodeToJsonElement(
            StartSessionParams.serializer(), StartSessionParams(runId, mode, initialMessage)
        )
        val response = wsClient.sendRequest("start_session", params)
        checkError(response)
    }

    suspend fun stopSession(runId: String) {
        val params = json.encodeToJsonElement(
            StopSessionParams.serializer(), StopSessionParams(runId)
        )
        val response = wsClient.sendRequest("stop_session", params)
        checkError(response)
    }

    suspend fun forkSession(runId: String): String {
        val params = json.encodeToJsonElement(
            ForkSessionParams.serializer(), ForkSessionParams(runId)
        )
        val response = wsClient.sendRequest("fork_session", params)
        checkError(response)
        return response.result?.jsonPrimitive?.content ?: ""
    }

    suspend fun respondPermission(
        runId: String,
        requestId: String,
        behavior: String,
        updatedPermissions: JsonElement? = null,
        denyMessage: String? = null,
        interrupt: Boolean? = null,
    ) {
        val params = json.encodeToJsonElement(
            RespondPermissionParams.serializer(),
            RespondPermissionParams(runId, requestId, behavior, updatedPermissions, denyMessage, interrupt),
        )
        val response = wsClient.sendRequest("respond_permission", params)
        checkError(response)
    }

    suspend fun approveTool(runId: String, toolName: String) {
        val params = json.encodeToJsonElement(
            ApproveToolParams.serializer(), ApproveToolParams(runId, toolName)
        )
        val response = wsClient.sendRequest("approve_session_tool", params)
        checkError(response)
    }

    suspend fun getRunArtifacts(id: String): RunArtifacts {
        val params = json.encodeToJsonElement(
            GetArtifactsParams.serializer(), GetArtifactsParams(id)
        )
        val response = wsClient.sendRequest("get_run_artifacts", params)
        checkError(response)
        return try {
            json.decodeFromJsonElement(RunArtifacts.serializer(), response.result!!)
        } catch (_: Exception) {
            RunArtifacts()
        }
    }

    suspend fun getGitStatus(cwd: String): GitStatus {
        val params = json.encodeToJsonElement(
            GetGitStatusParams.serializer(), GetGitStatusParams(cwd)
        )
        val response = wsClient.sendRequest("get_git_status", params)
        checkError(response)
        return try {
            json.decodeFromJsonElement(GitStatus.serializer(), response.result!!)
        } catch (_: Exception) {
            GitStatus()
        }
    }

    suspend fun getGitDiff(cwd: String, staged: Boolean? = null, file: String? = null): GitDiff {
        val params = json.encodeToJsonElement(
            GetGitDiffParams.serializer(), GetGitDiffParams(cwd, staged, file)
        )
        val response = wsClient.sendRequest("get_git_diff", params)
        checkError(response)
        return try {
            json.decodeFromJsonElement(GitDiff.serializer(), response.result!!)
        } catch (_: Exception) {
            GitDiff()
        }
    }

    suspend fun subscribe(runId: String, lastSeq: Long = 0L) {
        val params = json.encodeToJsonElement(
            SubscribeParams.serializer(), SubscribeParams(runId, lastSeq)
        )
        val response = wsClient.sendRequest("_subscribe", params)
        checkError(response)
    }

    suspend fun unsubscribe(runId: String) {
        val params = json.encodeToJsonElement(
            UnsubscribeParams.serializer(), UnsubscribeParams(runId)
        )
        val response = wsClient.sendRequest("_unsubscribe", params)
        checkError(response)
    }

    suspend fun getWebServerStatus(): WebServerStatus {
        val response = wsClient.sendRequest("get_web_server_status")
        checkError(response)
        return try {
            json.decodeFromJsonElement(WebServerStatus.serializer(), response.result!!)
        } catch (_: Exception) {
            WebServerStatus()
        }
    }

    // ── Parsing helpers ─────────────────────────────────────────────────────

    private fun checkError(response: RpcResponse) {
        if (response.error != null) {
            throw RpcException(response.error)
        }
    }

    private fun parseRun(element: JsonElement): MiWarpRun {
        return try {
            json.decodeFromJsonElement(MiWarpRun.serializer(), element)
        } catch (_: Exception) {
            // Fallback manual parsing for resilience
            val obj = element.jsonObject
            val statusStr = obj["status"]?.jsonPrimitive?.content ?: "idle"
            val status = try {
                RunStatus.valueOf(statusStr.replaceFirstChar { it.uppercase() })
            } catch (_: Exception) { RunStatus.Idle }

            val sourceStr = obj["source"]?.jsonPrimitive?.content
            val source = RunSource.fromString(sourceStr)

            MiWarpRun(
                id = obj["id"]?.jsonPrimitive?.content ?: "",
                name = obj["name"]?.jsonPrimitive?.content,
                prompt = obj["prompt"]?.jsonPrimitive?.content,
                cwd = obj["cwd"]?.jsonPrimitive?.content ?: "",
                agent = obj["agent"]?.jsonPrimitive?.content ?: "",
                model = obj["model"]?.jsonPrimitive?.content ?: "",
                status = status,
                source = source,
                messageCount = obj["message_count"]?.jsonPrimitive?.intOrNull ?: 0,
                lastActivity = obj["last_activity_at"]?.jsonPrimitive?.content,
                createdAt = obj["started_at"]?.jsonPrimitive?.content,
            )
        }
    }

    private fun parseBusEvent(envelope: RpcBroadcast): BusEvent? {
        return parseBusEventFromEnvelope(envelope.event, envelope.seq, envelope.runId, envelope.payload)
    }

    private fun parseBusEventFromElement(element: JsonElement): BusEvent? {
        // Try broadcast envelope format first (has "event" and "payload" keys)
        val obj = element.jsonObject
        if (obj.containsKey("event") && obj.containsKey("payload")) {
            return try {
                val envelope = json.decodeFromJsonElement(BusEventEnvelope.serializer(), element)
                parseBusEventFromEnvelope(envelope.event, envelope.seq, envelope.runId, envelope.payload)
            } catch (_: Exception) { null }
        }
        // Flat RPC format: event fields spread at top level, _seq with underscore
        val eventType = obj["type"]?.jsonPrimitive?.content ?: return null
        val seq = obj["_seq"]?.jsonPrimitive?.longOrNull ?: 0L
        val runId = obj["run_id"]?.jsonPrimitive?.content ?: ""
        return parseBusEventFromEnvelope(eventType, seq, runId, element)
    }

    private fun parseBusEventFromEnvelope(
        event: String, seq: Long, runId: String, payload: JsonElement?,
    ): BusEvent? {
        if (event == "_full_reload") return BusEvent.FullReload(seq, runId)

        return when (event) {
            "session_init" -> BusEvent.SessionInit(seq, runId, payload)
            "message_delta" -> BusEvent.MessageDelta(
                seq, runId,
                text = payload?.jsonObject?.get("text")?.jsonPrimitive?.content ?: "",
                role = payload?.jsonObject?.get("role")?.jsonPrimitive?.content ?: "assistant",
            )
            "message_complete" -> BusEvent.MessageComplete(seq, runId, payload)
            "tool_start" -> BusEvent.ToolStart(
                seq, runId,
                toolName = payload?.jsonObject?.get("tool_name")?.jsonPrimitive?.content ?: "",
                toolId = payload?.jsonObject?.get("tool_use_id")?.jsonPrimitive?.content
                    ?: payload?.jsonObject?.get("tool_id")?.jsonPrimitive?.content ?: "",
                input = payload?.jsonObject?.get("input"),
            )
            "tool_end" -> BusEvent.ToolEnd(
                seq, runId,
                toolName = payload?.jsonObject?.get("tool_name")?.jsonPrimitive?.content ?: "",
                toolId = payload?.jsonObject?.get("tool_use_id")?.jsonPrimitive?.content
                    ?: payload?.jsonObject?.get("tool_id")?.jsonPrimitive?.content ?: "",
                output = payload?.jsonObject?.get("output"),
                status = payload?.jsonObject?.get("status")?.jsonPrimitive?.content ?: "",
            )
            "user_message" -> BusEvent.UserMessage(seq, runId, payload)
            "run_state" -> {
                val statusStr = payload?.jsonObject?.get("state")?.jsonPrimitive?.content
                    ?: payload?.jsonObject?.get("status")?.jsonPrimitive?.content ?: "idle"
                val status = try {
                    RunStatus.valueOf(statusStr.replaceFirstChar { it.uppercase() })
                } catch (_: Exception) { RunStatus.Idle }
                BusEvent.RunState(seq, runId, status)
            }
            "usage_update" -> {
                val obj = payload?.jsonObject
                BusEvent.UsageUpdate(
                    seq, runId,
                    inputTokens = obj?.get("input_tokens")?.jsonPrimitive?.longOrNull ?: 0L,
                    outputTokens = obj?.get("output_tokens")?.jsonPrimitive?.longOrNull ?: 0L,
                    cacheReadTokens = obj?.get("cache_read_tokens")?.jsonPrimitive?.longOrNull ?: 0L,
                    cacheWriteTokens = obj?.get("cache_write_tokens")?.jsonPrimitive?.longOrNull ?: 0L,
                    costUsd = obj?.get("total_cost_usd")?.jsonPrimitive?.doubleOrNull
                        ?: obj?.get("cost_usd")?.jsonPrimitive?.doubleOrNull ?: 0.0,
                )
            }
            "thinking_delta" -> BusEvent.ThinkingDelta(
                seq, runId,
                text = payload?.jsonObject?.get("text")?.jsonPrimitive?.content ?: "",
            )
            "tool_input_delta" -> BusEvent.ToolInputDelta(
                seq, runId,
                toolId = payload?.jsonObject?.get("tool_use_id")?.jsonPrimitive?.content
                    ?: payload?.jsonObject?.get("tool_id")?.jsonPrimitive?.content ?: "",
                text = payload?.jsonObject?.get("partial_json")?.jsonPrimitive?.content
                    ?: payload?.jsonObject?.get("text")?.jsonPrimitive?.content ?: "",
            )
            "permission_prompt" -> BusEvent.PermissionPrompt(
                seq, runId,
                requestId = payload?.jsonObject?.get("request_id")?.jsonPrimitive?.content ?: "",
                toolName = payload?.jsonObject?.get("tool_name")?.jsonPrimitive?.content ?: "",
                toolUseId = payload?.jsonObject?.get("tool_use_id")?.jsonPrimitive?.content ?: "",
                description = payload?.jsonObject?.get("decision_reason")?.jsonPrimitive?.content
                    ?: payload?.jsonObject?.get("description")?.jsonPrimitive?.content ?: "",
                options = parsePermissionOptions(payload),
            )
            "permission_denied" -> BusEvent.PermissionDenied(
                seq, runId,
                toolName = payload?.jsonObject?.get("tool_name")?.jsonPrimitive?.content ?: "",
                toolUseId = payload?.jsonObject?.get("tool_use_id")?.jsonPrimitive?.content ?: "",
            )
            "compact_boundary" -> BusEvent.CompactBoundary(seq, runId, payload)
            "system_status" -> {
                val obj = payload?.jsonObject
                BusEvent.SystemStatus(
                    seq, runId,
                    status = obj?.get("status")?.jsonPrimitive?.content,
                    data = obj?.get("data"),
                )
            }
            "hook_started" -> BusEvent.HookStarted(seq, runId, payload)
            "hook_progress" -> BusEvent.HookProgress(seq, runId, payload)
            "hook_response" -> BusEvent.HookResponse(seq, runId, payload)
            "hook_callback" -> BusEvent.HookCallback(seq, runId, payload)
            "task_notification" -> BusEvent.TaskNotification(seq, runId, payload)
            "tool_progress" -> BusEvent.ToolProgress(
                seq, runId,
                toolId = payload?.jsonObject?.get("tool_use_id")?.jsonPrimitive?.content
                    ?: payload?.jsonObject?.get("tool_id")?.jsonPrimitive?.content ?: "",
                elapsedTimeSeconds = payload?.jsonObject?.get("elapsed_time_seconds")?.jsonPrimitive?.doubleOrNull ?: 0.0,
                data = payload?.jsonObject?.get("data"),
            )
            "tool_use_summary" -> BusEvent.ToolUseSummary(seq, runId, payload)
            "files_persisted" -> BusEvent.FilesPersisted(seq, runId, payload)
            "control_cancelled" -> BusEvent.ControlCancelled(seq, runId, payload)
            "command_output" -> BusEvent.CommandOutput(seq, runId, payload)
            "elicitation_prompt" -> BusEvent.ElicitationPrompt(seq, runId, payload)
            "rate_limit_event" -> BusEvent.RateLimitEvent(seq, runId, payload)
            "auth_status" -> BusEvent.AuthStatus(seq, runId, payload)
            "ralph_started" -> BusEvent.RalphStarted(seq, runId, payload)
            "ralph_iteration" -> BusEvent.RalphIteration(seq, runId, payload)
            "ralph_complete" -> BusEvent.RalphComplete(seq, runId, payload)
            "raw" -> BusEvent.Raw(seq, runId, payload)
            else -> BusEvent.Unknown(seq, runId, event, payload)
        }
    }
}

/**
 * Parse permission options from a permission_prompt payload.
 * Server may send suggestions as objects [{type, behavior, rules}] or as simple strings.
 * Falls back to ["allow", "deny"] if parsing fails.
 */
private fun parsePermissionOptions(payload: JsonElement?): List<String> {
    // Try "suggestions" first (server's canonical field)
    payload?.jsonObject?.get("suggestions")?.jsonArray?.let { arr ->
        val options = mutableListOf<String>()
        for (item in arr) {
            // Try as string first
            val str = item.jsonPrimitiveOrNull?.content
            if (str != null) {
                options.add(str)
            } else {
                // Object: extract behavior, skip complex suggestion types
                val behavior = item.jsonObject?.get("behavior")?.jsonPrimitiveOrNull?.content
                if (behavior != null) {
                    options.add(behavior)
                }
            }
        }
        if (options.isNotEmpty()) return options
    }
    // Try "options" fallback
    payload?.jsonObject?.get("options")?.jsonArray?.let { arr ->
        val options = arr.mapNotNull { it.jsonPrimitiveOrNull?.content }
        if (options.isNotEmpty()) return options
    }
    return listOf("allow", "deny")
}

/** Safe accessor that returns null instead of throwing for non-primitive elements */
private val JsonElement.jsonPrimitiveOrNull: JsonPrimitive?
    get() = this as? JsonPrimitive

class RpcException(message: String) : Exception(message)
