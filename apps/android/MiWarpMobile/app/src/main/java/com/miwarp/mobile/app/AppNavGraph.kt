package com.miwarp.mobile.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.feature.artifacts.ArtifactsScreen
import com.miwarp.mobile.feature.artifacts.DiffPreviewScreen
import com.miwarp.mobile.feature.chat.ChatScreen
import com.miwarp.mobile.feature.chat.RawEventScreen
import com.miwarp.mobile.feature.pairing.ConnectionListScreen
import com.miwarp.mobile.feature.pairing.PairingScreen
import com.miwarp.mobile.feature.pairing.QRScannerScreen
import com.miwarp.mobile.feature.sessions.SessionHubScreen
import com.miwarp.mobile.feature.settings.SettingsScreen
import com.miwarp.mobile.model.ConnectionState
import com.miwarp.mobile.model.MiWarpConnection
import kotlinx.coroutines.launch

object Routes {
    const val PAIRING = "pairing"
    const val QR_SCANNER = "qr_scanner"
    const val CONNECTION_LIST = "connection_list"
    const val SESSIONS = "sessions"
    const val CHAT = "chat/{runId}"
    const val ARTIFACTS = "artifacts/{runId}"
    const val DIFF_PREVIEW = "diff_preview/{runId}/{filePath}"
    const val RAW_EVENTS = "raw_events/{runId}"
    const val SETTINGS = "settings"

    fun chat(runId: String) = "chat/$runId"
    fun artifacts(runId: String) = "artifacts/$runId"
    fun diffPreview(runId: String, filePath: String) = "diff_preview/$runId/${java.net.URLEncoder.encode(filePath, "UTF-8")}"
    fun rawEvents(runId: String) = "raw_events/$runId"
}

@Composable
fun AppNavGraph(
    initialDeepLink: String? = null,
    isDarkMode: Boolean,
    onToggleTheme: () -> Unit,
) {
    val app = MiWarpMobileApp.instance
    val rpcClient = remember { app.rpcClient }
    val connectionStore = remember { app.connectionStore }
    val scope = rememberCoroutineScope()

    val navController = rememberNavController()
    val connections by connectionStore.connections.collectAsState(initial = emptyList())
    val activeConnectionId by connectionStore.activeConnectionId.collectAsState(initial = null)
    val activeConnection by connectionStore.activeConnection.collectAsState(initial = null)
    val connectionState by rpcClient.connectionState.collectAsState()

    val startDestination = if (activeConnection != null && connectionState == ConnectionState.Connected) {
        Routes.SESSIONS
    } else {
        Routes.PAIRING
    }

    // Handle deep links
    LaunchedEffect(initialDeepLink) {
        if (initialDeepLink != null && initialDeepLink.startsWith("miwarp://connect")) {
            val connection = parseDeepLink(initialDeepLink)
            if (connection != null) {
                connectToServer(rpcClient, connectionStore, connection, scope)
                navController.navigate(Routes.SESSIONS) {
                    popUpTo(Routes.PAIRING) { inclusive = true }
                }
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MWTheme.colors.bgDeepest),
    ) {
        NavHost(
            navController = navController,
            startDestination = startDestination,
        ) {
            composable(Routes.PAIRING) {
                PairingScreen(
                    onConnect = { connection ->
                        connectToServer(rpcClient, connectionStore, connection, scope)
                        navController.navigate(Routes.SESSIONS) {
                            popUpTo(Routes.PAIRING) { inclusive = true }
                        }
                    },
                    onNavigateToConnectionList = {
                        navController.navigate(Routes.CONNECTION_LIST)
                    },
                    onNavigateToQRScanner = {
                        navController.navigate(Routes.QR_SCANNER)
                    },
                )
            }

            composable(Routes.QR_SCANNER) {
                QRScannerScreen(
                    onConnectionScanned = { connection ->
                        connectToServer(rpcClient, connectionStore, connection, scope)
                        navController.navigate(Routes.SESSIONS) {
                            popUpTo(Routes.PAIRING) { inclusive = true }
                        }
                    },
                    onBack = { navController.popBackStack() },
                )
            }

            composable(Routes.CONNECTION_LIST) {
                ConnectionListScreen(
                    connections = connections,
                    activeConnectionId = activeConnectionId,
                    onSelect = { connection ->
                        connectToServer(rpcClient, connectionStore, connection, scope)
                        navController.navigate(Routes.SESSIONS) {
                            popUpTo(Routes.PAIRING) { inclusive = true }
                        }
                    },
                    onDelete = { id ->
                        scope.launch { connectionStore.removeConnection(id) }
                    },
                    onAddNew = {
                        navController.popBackStack()
                    },
                )
            }

            composable(Routes.SESSIONS) {
                val runsState = remember { kotlinx.coroutines.flow.MutableStateFlow<List<com.miwarp.mobile.model.MiWarpRun>>(emptyList()) }
                LaunchedEffect(connectionState) {
                    if (connectionState == ConnectionState.Connected) {
                        try {
                            runsState.value = rpcClient.listRuns()
                        } catch (_: Exception) { }
                    }
                }
                val runs by runsState.collectAsState()

                SessionHubScreen(
                    runs = runs,
                    isLoading = connectionState == ConnectionState.Connecting || connectionState == ConnectionState.Reconnecting,
                    error = if (connectionState == ConnectionState.Error) "Connection error" else null,
                    onRefresh = {
                        scope.launch {
                            try {
                                runsState.value = rpcClient.listRuns()
                            } catch (_: Exception) { }
                        }
                    },
                    onSessionClick = { runId ->
                        navController.navigate(Routes.chat(runId))
                    },
                )
            }

            composable(
                Routes.CHAT,
                arguments = listOf(navArgument("runId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val runId = backStackEntry.arguments?.getString("runId") ?: return@composable
                ChatScreen(
                    runId = runId,
                    rpcClient = rpcClient,
                    onNavigateToArtifacts = { navController.navigate(Routes.artifacts(it)) },
                    onNavigateToRawEvents = { navController.navigate(Routes.rawEvents(it)) },
                )
            }

            composable(
                Routes.ARTIFACTS,
                arguments = listOf(navArgument("runId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val runId = backStackEntry.arguments?.getString("runId") ?: return@composable
                ArtifactsScreen(
                    runId = runId,
                    rpcClient = rpcClient,
                    onFileClick = { filePath ->
                        navController.navigate(Routes.diffPreview(runId, filePath))
                    },
                )
            }

            composable(
                Routes.DIFF_PREVIEW,
                arguments = listOf(
                    navArgument("runId") { type = NavType.StringType },
                    navArgument("filePath") { type = NavType.StringType },
                ),
            ) { backStackEntry ->
                val runId = backStackEntry.arguments?.getString("runId") ?: return@composable
                val filePath = java.net.URLDecoder.decode(
                    backStackEntry.arguments?.getString("filePath") ?: return@composable,
                    "UTF-8",
                )
                val cwd = activeConnection?.let { "" } ?: ""
                DiffPreviewScreen(
                    runId = runId,
                    filePath = filePath,
                    cwd = cwd,
                    rpcClient = rpcClient,
                )
            }

            composable(
                Routes.RAW_EVENTS,
                arguments = listOf(navArgument("runId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val runId = backStackEntry.arguments?.getString("runId") ?: return@composable
                RawEventScreen(
                    runId = runId,
                    rpcClient = rpcClient,
                )
            }

            composable(Routes.SETTINGS) {
                SettingsScreen(
                    activeConnection = activeConnection,
                    connectionState = connectionState,
                    isDarkMode = isDarkMode,
                    onToggleTheme = onToggleTheme,
                    onDisconnect = {
                        rpcClient.disconnect()
                        navController.navigate(Routes.PAIRING) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                    onChangeConnection = {
                        navController.navigate(Routes.PAIRING) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                )
            }
        }
    }
}

private fun connectToServer(
    rpcClient: com.miwarp.mobile.rpc.MiWarpRpcClient,
    connectionStore: com.miwarp.mobile.storage.ConnectionStore,
    connection: MiWarpConnection,
    scope: kotlinx.coroutines.CoroutineScope,
) {
    rpcClient.connect(connection.wsUrl)
    scope.launch {
        connectionStore.saveConnection(connection)
        connectionStore.setActiveConnection(connection.id)
    }
}

private fun parseDeepLink(uri: String): MiWarpConnection? {
    return try {
        val parsed = android.net.Uri.parse(uri)
        val host = parsed.getQueryParameter("host") ?: return null
        val port = parsed.getQueryParameter("port")?.toIntOrNull() ?: return null
        val token = parsed.getQueryParameter("token") ?: ""
        val label = parsed.getQueryParameter("label") ?: ""
        MiWarpConnection(
            id = java.util.UUID.randomUUID().toString(),
            host = host,
            port = port,
            token = token,
            label = label,
            lastConnectedAt = System.currentTimeMillis(),
        )
    } catch (_: Exception) {
        null
    }
}
