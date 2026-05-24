package com.miwarp.mobile.feature.pairing

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWGlassCard
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.MiWarpConnection
import java.util.UUID

@Composable
fun PairingScreen(
    onConnect: (MiWarpConnection) -> Unit,
    onNavigateToConnectionList: () -> Unit,
    onNavigateToQRScanner: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val radius = MWTheme.radius
    val spacing = MWTheme.spacing

    var host by remember { mutableStateOf("") }
    var port by remember { mutableStateOf("9476") }
    var token by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }
    var isConnecting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(spacing.md),
    ) {
        Text(
            text = "Connect to MiWarp",
            style = MWTypography.heading,
            color = colors.textPrimary,
        )
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = "Enter your MiWarp Desktop connection details or scan a QR code.",
            style = MWTypography.body,
            color = colors.textSecondary,
        )

        Spacer(modifier = Modifier.height(spacing.xl))

        MWGlassCard {
            Text(
                text = "Manual Connection",
                style = MWTypography.subheading,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(spacing.md))

            val textFieldColors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = colors.textPrimary,
                unfocusedTextColor = colors.textPrimary,
                focusedBorderColor = colors.accentPrimary,
                unfocusedBorderColor = colors.divider,
                cursorColor = colors.accentPrimary,
                focusedLabelColor = colors.accentPrimary,
                unfocusedLabelColor = colors.textSecondary,
            )

            OutlinedTextField(
                value = host,
                onValueChange = { host = it; errorMessage = null },
                label = { Text("Host") },
                placeholder = { Text("192.168.1.100") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(radius.md),
                colors = textFieldColors,
            )
            Spacer(modifier = Modifier.height(spacing.sm))
            OutlinedTextField(
                value = port,
                onValueChange = { port = it.filter { c -> c.isDigit() }; errorMessage = null },
                label = { Text("Port") },
                placeholder = { Text("9476") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(radius.md),
                colors = textFieldColors,
            )
            Spacer(modifier = Modifier.height(spacing.sm))
            OutlinedTextField(
                value = token,
                onValueChange = { token = it; errorMessage = null },
                label = { Text("Token") },
                placeholder = { Text("Authentication token") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(radius.md),
                colors = textFieldColors,
            )
            Spacer(modifier = Modifier.height(spacing.sm))
            OutlinedTextField(
                value = label,
                onValueChange = { label = it },
                label = { Text("Label (optional)") },
                placeholder = { Text("My Desktop") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(radius.md),
                colors = textFieldColors,
            )

            if (errorMessage != null) {
                Spacer(modifier = Modifier.height(spacing.sm))
                Text(
                    text = errorMessage!!,
                    style = MWTypography.bodySmall,
                    color = colors.statusError,
                )
            }

            Spacer(modifier = Modifier.height(spacing.md))
            Button(
                onClick = {
                    val parsedPort = port.toIntOrNull()
                    when {
                        host.isBlank() -> errorMessage = "Host is required"
                        parsedPort == null || parsedPort !in 1..65535 -> errorMessage = "Invalid port"
                        token.isBlank() -> errorMessage = "Token is required"
                        else -> {
                            isConnecting = true
                            onConnect(
                                MiWarpConnection(
                                    id = UUID.randomUUID().toString(),
                                    host = host.trim(),
                                    port = parsedPort,
                                    token = token.trim(),
                                    label = label.trim(),
                                    lastConnectedAt = System.currentTimeMillis(),
                                )
                            )
                        }
                    }
                },
                enabled = !isConnecting,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = colors.accentPrimary),
                shape = RoundedCornerShape(radius.md),
            ) {
                Text(
                    text = if (isConnecting) "Connecting..." else "Connect",
                    style = MWTypography.buttonLabel,
                    color = Color.White,
                )
            }
        }

        Spacer(modifier = Modifier.height(spacing.lg))

        Button(
            onClick = onNavigateToQRScanner,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = colors.bgSurface),
            shape = RoundedCornerShape(radius.md),
        ) {
            Text(
                text = "Scan QR Code",
                style = MWTypography.buttonLabel,
                color = colors.accentCyan,
            )
        }

        Spacer(modifier = Modifier.height(spacing.sm))

        Button(
            onClick = onNavigateToConnectionList,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = colors.bgSurface),
            shape = RoundedCornerShape(radius.md),
        ) {
            Text(
                text = "Saved Connections",
                style = MWTypography.buttonLabel,
                color = colors.textSecondary,
            )
        }
    }
}
