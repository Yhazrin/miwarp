package com.miwarp.mobile.rpc

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class RpcRequest(
    val id: String,
    val method: String,
    val params: JsonElement? = null,
)

@Serializable
data class RpcResponse(
    val id: String? = null,
    val result: JsonElement? = null,
    val error: String? = null,
)

@Serializable
data class RpcBroadcast(
    val event: String = "",
    val seq: Long = 0L,
    @SerialName("run_id") val runId: String = "",
    val payload: JsonElement? = null,
)

@Serializable
data class SubscribeParams(
    @SerialName("run_id") val runId: String,
    @SerialName("last_seq") val lastSeq: Long = 0L,
)

@Serializable
data class UnsubscribeParams(
    @SerialName("run_id") val runId: String,
)

@Serializable
data class SendMessageParams(
    @SerialName("run_id") val runId: String,
    val message: String,
    val attachments: List<Map<String, String>>? = null,
)

@Serializable
data class StartSessionParams(
    @SerialName("run_id") val runId: String,
    val mode: String? = null,
    @SerialName("initial_message") val initialMessage: String? = null,
)

@Serializable
data class StopSessionParams(
    @SerialName("run_id") val runId: String,
)

@Serializable
data class ForkSessionParams(
    @SerialName("run_id") val runId: String,
)

@Serializable
data class RespondPermissionParams(
    @SerialName("run_id") val runId: String,
    @SerialName("request_id") val requestId: String,
    val behavior: String,
    @SerialName("updated_permissions") val updatedPermissions: JsonElement? = null,
    @SerialName("deny_message") val denyMessage: String? = null,
    val interrupt: Boolean? = null,
)

@Serializable
data class ApproveToolParams(
    @SerialName("run_id") val runId: String,
    @SerialName("tool_name") val toolName: String,
)

@Serializable
data class GetBusEventsParams(
    val id: String,
    @SerialName("since_seq") val sinceSeq: Long? = null,
)

@Serializable
data class GetRunParams(
    val id: String,
)

@Serializable
data class GetArtifactsParams(
    val id: String,
)

@Serializable
data class GetGitStatusParams(
    val cwd: String,
)

@Serializable
data class GetGitDiffParams(
    val cwd: String,
    val staged: Boolean? = null,
    val file: String? = null,
)
