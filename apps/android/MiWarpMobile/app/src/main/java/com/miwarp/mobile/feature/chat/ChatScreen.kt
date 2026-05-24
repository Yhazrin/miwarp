package com.miwarp.mobile.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWErrorState
import com.miwarp.mobile.design.MWLoadingState
import com.miwarp.mobile.design.MWReconnectBanner
import com.miwarp.mobile.design.MWStatusPill
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.BusEvent
import com.miwarp.mobile.model.ChatMessage
import com.miwarp.mobile.model.ConnectionState
import com.miwarp.mobile.model.MiWarpRun
import com.miwarp.mobile.model.PermissionRequest
import com.miwarp.mobile.model.RunStatus
import com.miwarp.mobile.reducer.MiWarpEventReducer
import com.miwarp.mobile.reducer.ReductionResult
import com.miwarp.mobile.rpc.MiWarpRpcClient
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(
    runId: String,
    rpcClient: MiWarpRpcClient,
    onNavigateToArtifacts: (String) -> Unit,
    onNavigateToRawEvents: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val scope = rememberCoroutineScope()

    var run by remember { mutableStateOf<MiWarpRun?>(null) }
    var messages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var pendingPermission by remember { mutableStateOf<PermissionRequest?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var isSending by remember { mutableStateOf(false) }
    var inputText by remember { mutableStateOf("") }
    var lastSeq by remember { mutableLongStateOf(0L) }
    val reducer = remember { MiWarpEventReducer() }

    val connectionState by rpcClient.connectionState

    // Load initial data and subscribe
    LaunchedEffect(runId) {
        try {
            isLoading = true
            run = rpcClient.getRun(runId)

            val history = rpcClient.getBusEvents(runId)
            reducer.clear()
            for (event in history) {
                reducer.reduce(event)
                if (event.seq > lastSeq) lastSeq = event.seq
            }
            messages = reducer.getMessages()
            pendingPermission = reducer.getPendingPermission()

            rpcClient.subscribe(runId, lastSeq)
        } catch (e: Exception) {
            error = e.message ?: "Failed to load session"
        } finally {
            isLoading = false
        }
    }

    // Collect real-time events
    LaunchedEffect(runId) {
        rpcClient.broadcastBusEvents().collect { event ->
            if (event.runId != runId) return@collect
            if (event.seq > 0 && event.seq <= lastSeq) return@collect

            val result: ReductionResult = reducer.reduce(event)
            if (event.seq > lastSeq) lastSeq = event.seq

            if (result.changed) {
                messages = result.messages
                pendingPermission = result.pendingPermission
            }

            // Update run state from event
            if (event is BusEvent.RunState) {
                run = run?.copy(status = event.status)
            }
            if (event is BusEvent.UsageUpdate) {
                run = run?.copy(totalTokens = event.tokens, totalCost = event.cost)
            }
            if (event is BusEvent.FullReload) {
                try {
                    val freshRun = rpcClient.getRun(runId)
                    run = freshRun
                    val freshHistory = rpcClient.getBusEvents(runId)
                    reducer.clear()
                    lastSeq = 0L
                    for (evt in freshHistory) {
                        reducer.reduce(evt)
                        if (evt.seq > lastSeq) lastSeq = evt.seq
                    }
                    messages = reducer.getMessages()
                    pendingPermission = reducer.getPendingPermission()
                    rpcClient.subscribe(runId, lastSeq)
                } catch (_: Exception) { }
            }
        }
    }

    // Unsubscribe on leave
    DisposableEffect(runId) {
        onDispose {
            scope.launch {
                try { rpcClient.unsubscribe(runId) } catch (_: Exception) { }
            }
        }
    }

    val sendMessage: () -> Unit = {
        if (inputText.isNotBlank() && !isSending) {
            val text = inputText.trim()
            inputText = ""
            isSending = true
            scope.launch {
                try {
                    rpcClient.sendMessage(runId, text)
                } catch (e: Exception) {
                    error = e.message ?: "Failed to send message"
                } finally {
                    isSending = false
                }
            }
        }
    }

    val respondPermission: (String) -> Unit = label@{ behavior ->
        val perm = pendingPermission ?: return@label
        scope.launch {
            try {
                rpcClient.respondPermission(runId, perm.requestId, behavior)
                pendingPermission = null
            } catch (e: Exception) {
                error = e.message ?: "Failed to respond to permission"
            }
        }
    }

    val stopSession: () -> Unit = {
        scope.launch {
            try {
                rpcClient.stopSession(runId)
            } catch (_: Exception) { }
        }
    }

    Column(
        modifier = modifier.fillMaxSize(),
    ) {
        // Reconnect banner
        val isDisconnected = connectionState == ConnectionState.Reconnecting || connectionState == ConnectionState.Error
        val isReconnecting = connectionState == ConnectionState.Reconnecting
        if (isDisconnected) {
            MWReconnectBanner(
                isReconnecting = isReconnecting,
                onRetry = { /* reconnect handled by wsClient auto-reconnect */ },
            )
        }

        when {
            isLoading -> {
                MWLoadingState(message = "Loading chat...")
            }
            error != null && messages.isEmpty() -> {
                MWErrorState(message = error!!, onRetry = {
                    error = null
                    isLoading = true
                    scope.launch {
                        try {
                            run = rpcClient.getRun(runId)
                            val history = rpcClient.getBusEvents(runId)
                            reducer.clear()
                            lastSeq = 0L
                            for (event in history) {
                                reducer.reduce(event)
                                if (event.seq > lastSeq) lastSeq = event.seq
                            }
                            messages = reducer.getMessages()
                            rpcClient.subscribe(runId, lastSeq)
                        } catch (e: Exception) {
                            error = e.message
                        } finally {
                            isLoading = false
                        }
                    }
                })
            }
            else -> {
                // Chat header
                ChatHeader(
                    run = run,
                    onArtifactsClick = { onNavigateToArtifacts(runId) },
                    onRawEventsClick = { onNavigateToRawEvents(runId) },
                    onStopClick = stopSession,
                )

                // Message list
                MessageList(
                    messages = messages,
                    modifier = Modifier.weight(1f),
                )

                // Pending approval
                if (pendingPermission != null) {
                    ApprovalCard(
                        toolName = pendingPermission!!.toolName,
                        description = pendingPermission!!.description,
                        options = pendingPermission!!.options,
                        onApprove = respondPermission,
                        modifier = Modifier.padding(horizontal = spacing.md, vertical = spacing.xs),
                    )
                }

                // Input bar
                ChatInputBar(
                    value = inputText,
                    onValueChange = { inputText = it },
                    onSend = sendMessage,
                    isLoading = isSending,
                    enabled = run?.status == RunStatus.Running || run?.status == RunStatus.Idle || run?.status == null,
                    onStop = if (run?.status == RunStatus.Running) stopSession else null,
                    modifier = Modifier.padding(horizontal = spacing.md, vertical = spacing.sm),
                )
            }
        }
    }
}

@Composable
private fun ChatHeader(
    run: MiWarpRun?,
    onArtifactsClick: () -> Unit,
    onRawEventsClick: () -> Unit,
    onStopClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = colors.bgDeep,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = spacing.md, vertical = spacing.sm),
        ) {
            MWStatusPill(
                status = run?.status ?: RunStatus.Idle,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(spacing.sm),
            ) {
                Text(
                    text = "Artifacts",
                    style = MWTypography.label,
                    color = colors.accentCyan,
                    modifier = Modifier.clickable { onArtifactsClick() },
                )
                Text(
                    text = "Raw Events",
                    style = MWTypography.label,
                    color = colors.textTertiary,
                    modifier = Modifier.clickable { onRawEventsClick() },
                )
                if (run?.status == RunStatus.Running) {
                    Text(
                        text = "Stop",
                        style = MWTypography.label,
                        color = colors.statusError,
                        modifier = Modifier.clickable { onStopClick() },
                    )
                }
            }
        }
    }
}
