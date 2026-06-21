package com.miwarp.mobile

import com.miwarp.mobile.model.BusEvent
import com.miwarp.mobile.model.MessageRole
import com.miwarp.mobile.model.RunStatus
import com.miwarp.mobile.reducer.MiWarpEventReducer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test

class ExampleUnitTest {

    @Test
    fun `reducer handles message delta`() {
        val reducer = MiWarpEventReducer()
        val event = BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Hello", role = "assistant")
        val result = reducer.reduce(event)

        assertTrue(result.changed)
        assertEquals(1, result.messages.size)
        assertEquals(MessageRole.Assistant, result.messages[0].role)
        assertEquals("Hello", result.messages[0].text)
        assertTrue(result.messages[0].isStreaming)
    }

    @Test
    fun `reducer accumulates message deltas`() {
        val reducer = MiWarpEventReducer()
        reducer.reduce(BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Hel", role = "assistant"))
        val result = reducer.reduce(BusEvent.MessageDelta(seq = 2, runId = "r1", text = "lo", role = "assistant"))

        assertTrue(result.changed)
        assertEquals(1, result.messages.size)
        assertEquals("Hello", result.messages[0].text)
    }

    @Test
    fun `reducer deduplicates by seq`() {
        val reducer = MiWarpEventReducer()
        reducer.reduce(BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Hello", role = "assistant"))
        val result = reducer.reduce(BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Hello", role = "assistant"))

        assertFalse(result.changed)
        assertEquals(1, result.messages.size)
    }

    @Test
    fun `reducer handles message complete`() {
        val reducer = MiWarpEventReducer()
        reducer.reduce(BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Hello", role = "assistant"))
        val result = reducer.reduce(
            BusEvent.MessageComplete(seq = 2, runId = "r1", messageId = null, text = null),
        )

        assertTrue(result.changed)
        assertFalse(result.messages[0].isStreaming)
    }

    @Test
    fun `reducer handles tool start and end`() {
        val reducer = MiWarpEventReducer()
        reducer.reduce(BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Working...", role = "assistant"))
        reducer.reduce(BusEvent.ToolStart(seq = 2, runId = "r1", toolName = "read_file", toolId = "t1", input = null))
        val result = reducer.reduce(BusEvent.ToolEnd(
            seq = 3, runId = "r1", toolName = "read_file", toolId = "t1",
            output = JsonPrimitive("file contents"), status = "success",
        ))

        assertTrue(result.changed)
        val tools = result.messages[0].toolCalls
        assertEquals(1, tools.size)
        assertEquals("read_file", tools[0].toolName)
        assertFalse(tools[0].isRunning)
        assertEquals("file contents", tools[0].output)
    }

    @Test
    fun `reducer handles permission prompt`() {
        val reducer = MiWarpEventReducer()
        val event = BusEvent.PermissionPrompt(
            seq = 1, runId = "r1", requestId = "req1",
            toolName = "bash", toolUseId = "tu1", description = "Run rm -rf?",
            options = listOf("allow", "deny"),
        )
        val result = reducer.reduce(event)

        assertTrue(result.changed)
        assertNotNull(result.pendingPermissions.firstOrNull())
        assertEquals("req1", result.pendingPermissions.first().requestId)
        assertEquals("bash", result.pendingPermissions.first().toolName)
    }

    @Test
    fun `reducer clears on full reload`() {
        val reducer = MiWarpEventReducer()
        reducer.reduce(BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Hello", role = "assistant"))
        val result = reducer.reduce(BusEvent.FullReload(seq = 2, runId = "r1"))

        assertTrue(result.changed)
        assertTrue(result.messages.isEmpty())
    }

    @Test
    fun `RunStatus enum parses correctly`() {
        assertEquals(RunStatus.Running, RunStatus.valueOf("Running"))
        assertEquals(RunStatus.Completed, RunStatus.valueOf("Completed"))
        assertEquals(RunStatus.Failed, RunStatus.valueOf("Failed"))
    }

    @Test
    fun `MiWarpConnection wsUrl is correct`() {
        val conn = com.miwarp.mobile.model.MiWarpConnection(
            id = "test", host = "192.168.1.1", port = 9876, token = "abc123",
        )
        assertEquals("ws://192.168.1.1:9876/ws", conn.wsUrl)
    }

    @Test
    fun `MiWarpConnection displayLabel uses label if set`() {
        val conn = com.miwarp.mobile.model.MiWarpConnection(
            id = "test", host = "192.168.1.1", port = 9876, label = "My Desktop",
        )
        assertEquals("My Desktop", conn.displayLabel)
    }

    @Test
    fun `MiWarpConnection displayLabel falls back to host`() {
        val conn = com.miwarp.mobile.model.MiWarpConnection(
            id = "test", host = "192.168.1.1", port = 9876,
        )
        assertEquals("192.168.1.1:9876", conn.displayLabel)
    }

    @Test
    fun `reducer handles permission denied clears pending`() {
        val reducer = MiWarpEventReducer()
        reducer.reduce(BusEvent.PermissionPrompt(
            seq = 1, runId = "r1", requestId = "req1",
            toolName = "bash", toolUseId = "tu1", description = "test", options = emptyList(),
        ))
        assertNotNull(reducer.getPendingPermissions().firstOrNull())

        reducer.reduce(BusEvent.PermissionDenied(seq = 2, runId = "r1", toolName = "bash", toolUseId = "tu1"))
        assertNull(reducer.getPendingPermissions().firstOrNull())
    }

    @Test
    fun `reducer clear resets state`() {
        val reducer = MiWarpEventReducer()
        reducer.reduce(BusEvent.MessageDelta(seq = 1, runId = "r1", text = "Hello", role = "assistant"))
        reducer.clear()

        assertTrue(reducer.getMessages().isEmpty())
        assertNull(reducer.getPendingPermissions().firstOrNull())
    }

    @Test
    fun `MWColorTokens has valid dark colors`() {
        val colors = com.miwarp.mobile.design.mwColors(isDark = true)
        assertNotNull(colors.bgDeepest)
        assertNotNull(colors.accentPrimary)
        assertNotNull(colors.textPrimary)
    }

    @Test
    fun `MWColorTokens has valid light colors`() {
        val colors = com.miwarp.mobile.design.mwColors(isDark = false)
        assertNotNull(colors.bgDeepest)
        assertNotNull(colors.accentPrimary)
        assertNotNull(colors.textPrimary)
    }
}
