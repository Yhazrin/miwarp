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
    ;

    /** Whether the connection is actively usable */
    val isActive: Boolean get() = this == Connected

    /** Human-readable label for UI */
    val displayLabel: String
        get() = when (this) {
            Disconnected -> "Disconnected"
            Connecting -> "Connecting..."
            Connected -> "Connected"
            Reconnecting -> "Reconnecting..."
            Error -> "Error"
        }
}

// ── Runs / Sessions ─────────────────────────────────────────────────────────

@Serializable
data class MiWarpRun(
    val id: String,
    val name: String? = null,
    val prompt: String? = null,
    val cwd: String = "",
    val agent: String = "",
    val model: String = "",
    val status: RunStatus = RunStatus.Idle,
    val source: RunSource = RunSource.Unknown,
    @SerialName("message_count") val messageCount: Int = 0,
    @SerialName("last_activity") val lastActivity: String? = null,
    @SerialName("has_approval_pending") val hasApprovalPending: Boolean = false,
    @SerialName("has_files_changed") val hasFilesChanged: Boolean = false,
    @SerialName("has_artifacts") val hasArtifacts: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
) {
    /** Display title: name, or first 80 chars of prompt, or fallback */
    val displayTitle: String
        get() = name?.takeIf { it.isNotBlank() }
            ?: prompt?.take(80)
            ?: "Session ${id.take(8)}"

    /** Short cwd: last 2 path components */
    val shortCwd: String
        get() {
            val parts = cwd.trimEnd('/').split('/')
            return if (parts.size >= 2) parts.takeLast(2).joinToString("/") else cwd
        }
}

@Serializable
enum class RunStatus {
    @SerialName("idle") Idle,
    @SerialName("running") Running,
    @SerialName("waiting_input") WaitingInput,
    @SerialName("waiting_approval") WaitingApproval,
    @SerialName("completed") Completed,
    @SerialName("failed") Failed,
    @SerialName("stopped") Stopped,
    ;

    val displayLabel: String
        get() = when (this) {
            Idle -> "Idle"
            Running -> "Running"
            WaitingInput -> "Waiting"
            WaitingApproval -> "Approval"
            Completed -> "Done"
            Failed -> "Failed"
            Stopped -> "Stopped"
        }
}

@Serializable
enum class RunSource {
    @SerialName("cli") CLI,
    @SerialName("web") Web,
    @SerialName("mobile") Mobile,
    @SerialName("api") API,
    Unknown,
    ;

    companion object {
        fun fromString(value: String?): RunSource = when (value) {
            "cli" -> CLI
            "web" -> Web
            "mobile" -> Mobile
            "api" -> API
            else -> Unknown
        }
    }
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
    data class UsageUpdate(override val seq: Long, override val runId: String, val inputTokens: Long, val outputTokens: Long, val cacheReadTokens: Long, val cacheWriteTokens: Long, val costUsd: Double) : BusEvent()
    data class ThinkingDelta(override val seq: Long, override val runId: String, val text: String) : BusEvent()
    data class ToolInputDelta(override val seq: Long, override val runId: String, val toolId: String, val text: String) : BusEvent()
    data class PermissionPrompt(override val seq: Long, override val runId: String, val requestId: String, val toolName: String, val toolUseId: String, val description: String, val options: List<String>) : BusEvent()
    data class PermissionDenied(override val seq: Long, override val runId: String, val toolName: String, val toolUseId: String) : BusEvent()
    data class CompactBoundary(override val seq: Long, override val runId: String, val payload: JsonElement?) : BusEvent()
    data class SystemStatus(override val seq: Long, override val runId: String, val message: String, val level: String) : BusEvent()
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

// ── Artifacts (matches server API) ──────────────────────────────────────────

@Serializable
data class RunArtifacts(
    @SerialName("files_changed") val filesChanged: List<ArtifactFile>? = null,
    @SerialName("diff_summary") val diffSummary: String? = null,
    val commands: List<String>? = null,
    @SerialName("cost_estimate") val costEstimate: Double? = null,
)

@Serializable
data class ArtifactFile(
    val path: String = "",
    val status: FileChangeStatus = FileChangeStatus.Modified,
    val additions: Int? = null,
    val deletions: Int? = null,
)

@Serializable
enum class FileChangeStatus {
    @SerialName("added") Added,
    @SerialName("modified") Modified,
    @SerialName("deleted") Deleted,
    @SerialName("renamed") Renamed,
}

// ── Git ─────────────────────────────────────────────────────────────────────

@Serializable
data class GitStatus(
    val branch: String = "",
    val dirty: Boolean = false,
    val ahead: Int = 0,
    val behind: Int = 0,
    val files: List<GitFileStatus>? = null,
)

@Serializable
data class GitFileStatus(
    val path: String = "",
    val status: String = "",
)

@Serializable
data class GitDiff(
    val diff: String = "",
    val files: List<String>? = null,
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
    val inputPreview: String = "",
    val output: String = "",
    val isRunning: Boolean = false,
    val isError: Boolean = false,
    val isExpanded: Boolean = false,
    val progress: Double = -1.0,
    val progressMessage: String = "",
)

data class PermissionRequest(
    val requestId: String,
    val runId: String,
    val toolName: String,
    val toolUseId: String = "",
    val description: String,
    val options: List<String> = emptyList(),
)

// ── Usage tracking ──────────────────────────────────────────────────────────

data class UsageSummary(
    var inputTokens: Long = 0,
    var outputTokens: Long = 0,
    var cacheReadTokens: Long = 0,
    var cacheWriteTokens: Long = 0,
    var costUsd: Double = 0.0,
)

// ── Web server status ───────────────────────────────────────────────────────

@Serializable
data class WebServerStatus(
    val enabled: Boolean = false,
    val running: Boolean = false,
    val port: Int = 0,
    val bind: String = "",
    val warning: String? = null,
)
