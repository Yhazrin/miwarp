package com.miwarp.mobile.reducer

import com.miwarp.mobile.model.BusEvent
import com.miwarp.mobile.model.ChatMessage
import com.miwarp.mobile.model.MessageRole
import com.miwarp.mobile.model.PermissionRequest
import com.miwarp.mobile.model.RunStatus
import com.miwarp.mobile.model.ToolCallInfo
import com.miwarp.mobile.model.UsageSummary
import java.util.UUID
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Reduces a stream of BusEvents into ChatMessage list + derived state.
 * Mirrors the iOS event reducer logic.
 */
class MiWarpEventReducer {

    private val messages = mutableListOf<ChatMessage>()
    private val seenSeqs = mutableSetOf<Long>()
    private val pendingPermissions = mutableListOf<PermissionRequest>()
    private var usage = UsageSummary()
    private var currentStatus: RunStatus = RunStatus.Idle
    private var lastSeq: Long = 0L
    private var streamingMessageId: String? = null
    private val messageAccumulator = mutableMapOf<String, String>() // messageId -> accumulated text

    fun getMessages(): List<ChatMessage> = messages.toList()

    fun getPendingPermissions(): List<PermissionRequest> = pendingPermissions.toList()

    fun getUsage(): UsageSummary = usage.copy()

    fun getCurrentStatus(): RunStatus = currentStatus

    fun getLastSeq(): Long = lastSeq

    fun reduce(event: BusEvent): ReductionResult {
        if (event.seq > 0 && !seenSeqs.add(event.seq)) {
            return ReductionResult(
                messages = getMessages(),
                changed = false,
                pendingPermissions = getPendingPermissions(),
                usage = getUsage(),
                currentStatus = currentStatus,
            )
        }

        if (event.seq > lastSeq) lastSeq = event.seq

        // Cap seenSeqs to prevent unbounded growth (keep last 8192 entries)
        if (seenSeqs.size > 8192) {
            seenSeqs.retainAll { it > lastSeq - 8192 }
        }

        var changed = false

        when (event) {
            is BusEvent.MessageDelta -> {
                changed = handleMessageDelta(event)
            }
            is BusEvent.MessageComplete -> {
                changed = handleMessageComplete(event)
            }
            is BusEvent.UserMessage -> {
                changed = handleUserMessage(event)
            }
            is BusEvent.ToolStart -> {
                changed = handleToolStart(event)
            }
            is BusEvent.ToolEnd -> {
                changed = handleToolEnd(event)
            }
            is BusEvent.ToolInputDelta -> {
                changed = handleToolInputDelta(event)
            }
            is BusEvent.ToolProgress -> {
                changed = handleToolProgress(event)
            }
            is BusEvent.ThinkingDelta -> {
                changed = handleThinkingDelta(event)
            }
            is BusEvent.PermissionPrompt -> {
                pendingPermissions.add(
                    PermissionRequest(
                        requestId = event.requestId,
                        runId = event.runId,
                        toolName = event.toolName,
                        toolUseId = event.toolUseId,
                        description = event.description,
                        options = event.options,
                    )
                )
                currentStatus = RunStatus.WaitingApproval
                changed = true
            }
            is BusEvent.PermissionDenied -> {
                if (event.toolUseId.isNotEmpty()) {
                    pendingPermissions.removeAll { it.toolUseId == event.toolUseId }
                } else {
                    pendingPermissions.removeAll { it.toolName == event.toolName }
                }
                if (pendingPermissions.isEmpty()) currentStatus = RunStatus.Running
                changed = true
            }
            is BusEvent.RunState -> {
                currentStatus = event.status
                changed = true
            }
            is BusEvent.UsageUpdate -> {
                usage.inputTokens += event.inputTokens
                usage.outputTokens += event.outputTokens
                usage.cacheReadTokens += event.cacheReadTokens
                usage.cacheWriteTokens += event.cacheWriteTokens
                usage.costUsd += event.costUsd
                changed = true
            }
            is BusEvent.SystemStatus -> {
                val status = event.status
                if (!status.isNullOrEmpty()) {
                    messages.add(
                        ChatMessage(
                            id = "system-$lastSeq",
                            role = MessageRole.System,
                            text = status,
                        )
                    )
                    changed = true
                }
            }
            is BusEvent.FullReload -> {
                clear()
                changed = true
            }
            is BusEvent.CompactBoundary -> {
                // Mark the boundary; content continues after
            }
            is BusEvent.CommandOutput -> {
                if (!event.content.isNullOrEmpty()) {
                    messages.add(
                        ChatMessage(
                            id = "cmdout-$lastSeq",
                            role = MessageRole.System,
                            text = event.content,
                        )
                    )
                    changed = true
                }
            }
            else -> { /* Other events don't directly affect chat messages */ }
        }

        return ReductionResult(
            messages = getMessages(),
            changed = changed,
            pendingPermissions = getPendingPermissions(),
            usage = getUsage(),
            currentStatus = currentStatus,
        )
    }

    fun clear() {
        messages.clear()
        seenSeqs.clear()
        pendingPermissions.clear()
        usage = UsageSummary()
        currentStatus = RunStatus.Idle
        lastSeq = 0
        streamingMessageId = null
        messageAccumulator.clear()
    }

    fun removePermission(requestId: String) {
        pendingPermissions.removeAll { it.requestId == requestId }
    }

    private fun handleMessageDelta(event: BusEvent.MessageDelta): Boolean {
        val msgId = streamingMessageId ?: UUID.randomUUID().toString()
        val existing = messages.lastOrNull { it.role == MessageRole.Assistant && it.isStreaming }
        if (existing != null) {
            val index = messages.indexOf(existing)
            messages[index] = existing.copy(text = existing.text + event.text)
        } else {
            streamingMessageId = msgId
            messages.add(
                ChatMessage(
                    id = msgId,
                    role = MessageRole.Assistant,
                    text = event.text,
                    isStreaming = true,
                )
            )
        }
        messageAccumulator[msgId, default = ""] += event.text
        return true
    }

    private fun handleMessageComplete(event: BusEvent.MessageComplete): Boolean {
        val streaming = messages.lastOrNull { it.role == MessageRole.Assistant && it.isStreaming }
        if (streaming != null) {
            val index = messages.indexOf(streaming)
            val finalText = event.text ?: streaming.text
            messages[index] = streaming.copy(text = finalText, isStreaming = false)
            streamingMessageId = null
            messageAccumulator.remove(streaming.id)
            return true
        }
        return false
    }

    private fun handleUserMessage(event: BusEvent.UserMessage): Boolean {
        val text = try {
            event.payload?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull ?: ""
        } catch (_: Exception) { "" }
        messages.add(
            ChatMessage(
                id = "user-$lastSeq",
                role = MessageRole.User,
                text = text,
            )
        )
        return true
    }

    private fun handleToolStart(event: BusEvent.ToolStart): Boolean {
        val inputPreview = event.input?.toString()?.take(200) ?: ""
        val tool = ToolCallInfo(
            toolId = event.toolId,
            toolName = event.toolName,
            inputPreview = inputPreview,
            isRunning = true,
        )

        // Attach to the last assistant message
        val lastAssistant = messages.lastOrNull { it.role == MessageRole.Assistant }
        if (lastAssistant != null) {
            val index = messages.indexOf(lastAssistant)
            messages[index] = lastAssistant.copy(
                toolCalls = lastAssistant.toolCalls + tool,
            )
        }
        return true
    }

    private fun handleToolEnd(event: BusEvent.ToolEnd): Boolean {
        val outputStr = event.output?.toString()?.take(2000) ?: ""
        for (i in messages.indices.reversed()) {
            val msg = messages[i]
            if (msg.role == MessageRole.Assistant) {
                val toolIndex = msg.toolCalls.indexOfFirst { it.toolId == event.toolId }
                if (toolIndex >= 0) {
                    val updated = msg.toolCalls.toMutableList()
                    updated[toolIndex] = updated[toolIndex].copy(
                        output = outputStr,
                        isRunning = false,
                        isError = event.status != "success",
                        progress = -1.0,
                    )
                    messages[i] = msg.copy(toolCalls = updated)
                    return true
                }
            }
        }
        return false
    }

    private fun handleToolInputDelta(event: BusEvent.ToolInputDelta): Boolean {
        for (i in messages.indices.reversed()) {
            val msg = messages[i]
            if (msg.role == MessageRole.Assistant) {
                val toolIndex = msg.toolCalls.indexOfFirst { it.toolId == event.toolId }
                if (toolIndex >= 0) {
                    val updated = msg.toolCalls.toMutableList()
                    updated[toolIndex] = updated[toolIndex].copy(
                        inputPreview = updated[toolIndex].inputPreview + event.text,
                    )
                    messages[i] = msg.copy(toolCalls = updated)
                    return true
                }
            }
        }
        return false
    }

    private fun handleToolProgress(event: BusEvent.ToolProgress): Boolean {
        for (i in messages.indices.reversed()) {
            val msg = messages[i]
            if (msg.role == MessageRole.Assistant) {
                val toolIndex = msg.toolCalls.indexOfFirst { it.toolId == event.toolId }
                if (toolIndex >= 0) {
                    val updated = msg.toolCalls.toMutableList()
                    updated[toolIndex] = updated[toolIndex].copy(
                        progress = event.elapsedTimeSeconds,
                        progressMessage = "",
                    )
                    messages[i] = msg.copy(toolCalls = updated)
                    return true
                }
            }
        }
        return false
    }

    private fun handleThinkingDelta(event: BusEvent.ThinkingDelta): Boolean {
        val existing = messages.lastOrNull { it.role == MessageRole.Assistant && it.isStreaming }
        if (existing != null) {
            val index = messages.indexOf(existing)
            messages[index] = existing.copy(thinking = existing.thinking + event.text)
        } else {
            messages.add(
                ChatMessage(
                    id = UUID.randomUUID().toString(),
                    role = MessageRole.Assistant,
                    thinking = event.text,
                    isStreaming = true,
                )
            )
        }
        return true
    }
}

data class ReductionResult(
    val messages: List<ChatMessage>,
    val changed: Boolean,
    val pendingPermissions: List<PermissionRequest>,
    val usage: UsageSummary,
    val currentStatus: RunStatus,
)
