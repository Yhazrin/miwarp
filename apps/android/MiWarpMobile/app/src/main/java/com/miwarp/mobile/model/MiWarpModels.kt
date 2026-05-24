package com.miwarp.mobile.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// ── Connection ──────────────────────────────────────────────────────────────

@Serializable
data class MiWarpConnection(
    val id: String,
    val host: String,
    val port: Int,
    val label: String = "",
    val token: String = "",
    val isDefault: Boolean = false,
    val lastConnectedAt: Long = 0L,
) {
    val wsUrl: String get() = "ws://$host:$port/ws?token=$token"
    val displayLabel: String get() = label.ifBlank { "$host:$port" }
}

enum class ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

// ── Runs / Sessions ─────────────────────────────────────────────────────────

@Serializable
data class MiWarpRun(
    val id: String,
    val cwd: String = "",
    val mode: String = "",
    val status: RunStatus = RunStatus.Idle,
    val title: String = "",
    val model: String = "",
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
    val totalTokens: Long = 0L,
    val totalCost: Double = 0.0,
    val messageCount: Int = 0,
    val turnCount: Int = 0,
)

@Serializable
enum class RunStatus {
    @SerialName("idle") Idle,
    @SerialName("pending") Pending,
    @SerialName("running") Running,
    @SerialName("done") Done,
    @SerialName("failed") Failed,
    @SerialName("cancelled") Cancelled,
    @SerialName("waiting_approval") WaitingApproval,
    @SerialName("stopped") Stopped,
    @SerialName("timeout") Timeout,
}

// ── Bus Events ──────────────────────────────────────────────────────────────

@Serializable
data class BusEventEnvelope(
    @SerialName("event") val event: String = "",
    val seq: Long = 0L,
    @SerialName("run_id") val runId: String = "",
    val payload: JsonElement? = null,
)

sealed class BusEvent {
    abstract val seq: Long
    abstract val runId: String

    data class SessionInit(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class MessageDelta(override val seq: Long, override val runId: String, val text: String, val role: String) : BusEvent()
    data class MessageComplete(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class ToolStart(override val seq: Long, override val runId: String, val toolName: String, val toolId: String, val input: JsonElement?) : BusEvent()
    data class ToolEnd(override val seq: Long, override val runId: String, val toolName: String, val toolId: String, val output: String, val isError: Boolean) : BusEvent()
    data class UserMessage(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class RunState(override val seq: Long, override val runId: String, val status: RunStatus) : BusEvent()
    data class UsageUpdate(override val seq: Long, override val runId: String, val tokens: Long, val cost: Double) : BusEvent()
    data class ThinkingDelta(override val seq: Long, override val runId: String, val text: String) : BusEvent()
    data class ToolInputDelta(override val seq: Long, override val runId: String, val toolId: String, val text: String) : BusEvent()
    data class PermissionPrompt(override val seq: Long, override val runId: String, val requestId: String, val toolName: String, val description: String, val options: List<String>) : BusEvent()
    data class PermissionDenied(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class CompactBoundary(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class SystemStatus(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class HookStarted(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class HookProgress(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class HookResponse(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class HookCallback(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class TaskNotification(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class ToolProgress(override val seq: Long, override val runId: String, val toolId: String, val progress: Double, val message: String) : BusEvent()
    data class ToolUseSummary(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class FilesPersisted(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class ControlCancelled(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class CommandOutput(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class ElicitationPrompt(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class RateLimitEvent(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class AuthStatus(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class RalphStarted(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class RalphIteration(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class RalphComplete(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class Raw(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class FullReload(override val seq: Long, override val runId: String) : BusEvent()
    data class Unknown(override val seq: Long, override val runId: String, val event: String, val payload: JsonElement?) : BusEvent()
}

// ── Artifacts ───────────────────────────────────────────────────────────────

@Serializable
data class RunArtifacts(
    val files: List<ArtifactFile> = emptyList(),
)

@Serializable
data class ArtifactFile(
    val path: String = "",
    val content: String = "",
    val language: String = "",
)

// ── Git ─────────────────────────────────────────────────────────────────────

@Serializable
data class GitStatus(
    val branch: String = "",
    val dirty: Boolean = false,
    val ahead: Int = 0,
    val behind: Int = 0,
    val staged: List<String> = emptyList(),
    val modified: List<String> = emptyList(),
    val untracked: List<String> = emptyList(),
    val deleted: List<String> = emptyList(),
)

@Serializable
data class GitDiff(
    val file: String = "",
    val diff: String = "",
    val staged: Boolean = false,
)

// ── Chat message model (derived from events) ────────────────────────────────

data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val text: String = "",
    val thinking: String = "",
    val toolCalls: List<ToolCallInfo> = emptyList(),
    val timestamp: Long = System.currentTimeMillis(),
    val isStreaming: Boolean = false,
)

enum class MessageRole { User, Assistant, System }

data class ToolCallInfo(
    val toolId: String,
    val toolName: String,
    val input: String = "",
    val output: String = "",
    val isRunning: Boolean = false,
    val isError: Boolean = false,
    val progress: Double = -1.0,
    val progressMessage: String = "",
)

data class PermissionRequest(
    val requestId: String,
    val runId: String,
    val toolName: String,
    val description: String,
    val options: List<String> = emptyList(),
)

// ── Web server status ───────────────────────────────────────────────────────

@Serializable
data class WebServerStatus(
    val enabled: Boolean = false,
    val running: Boolean = false,
    val port: Int = 0,
    val bind: String = "",
)
