package com.miwarp.mobile.reducer

import com.miwarp.mobile.model.BusEvent
import com.miwarp.mobile.model.ChatMessage
import com.miwarp.mobile.model.MessageRole
import com.miwarp.mobile.model.PermissionRequest
import com.miwarp.mobile.model.RunStatus
import com.miwarp.mobile.model.ToolCallInfo
import java.util.UUID

/**
 * Reduces a stream of BusEvents into ChatMessage list + derived state.
 * Mirrors the iOS event reducer logic.
 */
class MiWarpEventReducer {

    private val messages = mutableListOf<ChatMessage>()
    private val seenSeqs = mutableSetOf<Long>()
    private var pendingPermission: PermissionRequest? = null

    fun getMessages(): List<ChatMessage> = messages.toList()

    fun getPendingPermission(): PermissionRequest? = pendingPermission

    fun reduce(event: BusEvent): ReductionResult {
        if (event.seq > 0 && !seenSeqs.add(event.seq)) {
            return ReductionResult(messages = getMessages(), changed = false, pendingPermission = pendingPermission)
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
                pendingPermission = PermissionRequest(
                    requestId = event.requestId,
                    runId = event.runId,
                    toolName = event.toolName,
                    description = event.description,
                    options = event.options,
                )
                changed = true
            }
            is BusEvent.PermissionDenied -> {
                pendingPermission = null
                changed = true
            }
            is BusEvent.FullReload -> {
                clear()
                changed = true
            }
            is BusEvent.CompactBoundary -> {
                // Mark the boundary; content continues after
            }
            else -> { /* Other events don't directly affect chat messages */ }
        }

        return ReductionResult(
            messages = getMessages(),
            changed = changed,
            pendingPermission = pendingPermission,
        )
    }

    fun clear() {
        messages.clear()
        seenSeqs.clear()
        pendingPermission = null
    }

    private fun handleMessageDelta(event: BusEvent.MessageDelta): Boolean {
        val existing = messages.lastOrNull { it.role == MessageRole.Assistant && it.isStreaming }
        if (existing != null) {
            val index = messages.indexOf(existing)
            messages[index] = existing.copy(text = existing.text + event.text)
        } else {
            messages.add(
                ChatMessage(
                    id = UUID.randomUUID().toString(),
                    role = MessageRole.Assistant,
                    text = event.text,
                    isStreaming = true,
                )
            )
        }
        return true
    }

    private fun handleMessageComplete(event: BusEvent.MessageComplete): Boolean {
        val streaming = messages.lastOrNull { it.role == MessageRole.Assistant && it.isStreaming }
        if (streaming != null) {
            val index = messages.indexOf(streaming)
            messages[index] = streaming.copy(isStreaming = false)
            return true
        }
        return false
    }

    private fun handleUserMessage(event: BusEvent.UserMessage): Boolean {
        val text = event.payload?.toString() ?: ""
        messages.add(
            ChatMessage(
                id = UUID.randomUUID().toString(),
                role = MessageRole.User,
                text = text,
            )
        )
        return true
    }

    private fun handleToolStart(event: BusEvent.ToolStart): Boolean {
        val tool = ToolCallInfo(
            toolId = event.toolId,
            toolName = event.toolName,
            input = event.input?.toString() ?: "",
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
        for (i in messages.indices.reversed()) {
            val msg = messages[i]
            if (msg.role == MessageRole.Assistant) {
                val toolIndex = msg.toolCalls.indexOfFirst { it.toolId == event.toolId }
                if (toolIndex >= 0) {
                    val updated = msg.toolCalls.toMutableList()
                    updated[toolIndex] = updated[toolIndex].copy(
                        output = event.output,
                        isRunning = false,
                        isError = event.isError,
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
                        input = updated[toolIndex].input + event.text,
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
                        progress = event.progress,
                        progressMessage = event.message,
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
    val pendingPermission: PermissionRequest?,
)
