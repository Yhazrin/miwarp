package com.miwarp.mobile.feature.pairing

import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.miwarp.mobile.design.MWGlassCard
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.MiWarpConnection
import java.util.UUID
import java.util.concurrent.Executors

@Composable
fun QRScannerScreen(
    onConnectionScanned: (MiWarpConnection) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }
    var scanResult by remember { mutableStateOf<String?>(null) }
    var scanError by remember { mutableStateOf<String?>(null) }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasCameraPermission = granted
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(spacing.md),
    ) {
        Text(
            text = "Scan QR Code",
            style = MWTypography.heading,
            color = colors.textPrimary,
        )
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = "Point your camera at the MiWarp QR code to connect.",
            style = MWTypography.body,
            color = colors.textSecondary,
        )
        Spacer(modifier = Modifier.height(spacing.md))

        if (!hasCameraPermission) {
            MWGlassCard {
                Text(
                    text = "Camera permission is required to scan QR codes.",
                    style = MWTypography.body,
                    color = colors.textSecondary,
                )
            }
            return@Column
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            val lifecycleOwner = LocalLifecycleOwner.current
            AndroidView(
                factory = { ctx ->
                    val previewView = PreviewView(ctx)
                    val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                    cameraProviderFuture.addListener({
                        val cameraProvider = cameraProviderFuture.get()
                        val preview = Preview.Builder().build().also {
                            it.surfaceProvider = previewView.surfaceProvider
                        }

                        val options = BarcodeScannerOptions.Builder()
                            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                            .build()
                        val scanner = BarcodeScanning.getClient(options)
                        val analysis = ImageAnalysis.Builder()
                            .setTargetResolution(Size(1280, 720))
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()

                        analysis.setAnalyzer(Executors.newSingleThreadExecutor()) { imageProxy ->
                            val mediaImage = imageProxy.image
                            if (mediaImage != null) {
                                val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                                scanner.process(image)
                                    .addOnSuccessListener { barcodes ->
                                        for (barcode in barcodes) {
                                            val raw = barcode.rawValue ?: continue
                                            if (scanResult == null) {
                                                scanResult = raw
                                            }
                                        }
                                    }
                                    .addOnCompleteListener {
                                        imageProxy.close()
                                    }
                            } else {
                                imageProxy.close()
                            }
                        }

                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                CameraSelector.DEFAULT_BACK_CAMERA,
                                preview,
                                analysis,
                            )
                        } catch (_: Exception) { }
                    }, ContextCompat.getMainExecutor(ctx))
                    previewView
                },
                modifier = Modifier.fillMaxSize(),
            )
        }

        if (scanResult != null) {
            Spacer(modifier = Modifier.height(spacing.md))
            val connection = parseQrCode(scanResult!!)
            if (connection != null) {
                MWGlassCard {
                    Text(
                        text = "Connection Found",
                        style = MWTypography.subheading,
                        color = colors.statusSuccess,
                    )
                    Spacer(modifier = Modifier.height(spacing.xs))
                    Text(
                        text = "${connection.host}:${connection.port}",
                        style = MWTypography.mono,
                        color = colors.textPrimary,
                    )
                    Spacer(modifier = Modifier.height(spacing.md))
                    androidx.compose.material3.Button(
                        onClick = { onConnectionScanned(connection) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(text = "Connect", style = MWTypography.buttonLabel)
                    }
                }
            } else {
                scanError = "Invalid QR code. Expected miwarp://connect format."
                scanResult = null
            }
        }

        if (scanError != null) {
            Spacer(modifier = Modifier.height(spacing.sm))
            Text(
                text = scanError!!,
                style = MWTypography.bodySmall,
                color = colors.statusError,
            )
        }
    }
}

private fun parseQrCode(raw: String): MiWarpConnection? {
    // Expected formats:
    // miwarp://connect?host=X&port=Y&token=Z&label=L
    // or JSON: {"host":"X","port":Y,"token":"Z","label":"L"}
    return try {
        if (raw.startsWith("miwarp://")) {
            val uri = android.net.Uri.parse(raw)
            val host = uri.getQueryParameter("host") ?: return null
            val port = uri.getQueryParameter("port")?.toIntOrNull() ?: return null
            val token = uri.getQueryParameter("token") ?: ""
            val label = uri.getQueryParameter("label") ?: ""
            MiWarpConnection(
                id = UUID.randomUUID().toString(),
                host = host,
                port = port,
                token = token,
                label = label,
                lastConnectedAt = System.currentTimeMillis(),
            )
        } else if (raw.startsWith("{")) {
            val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
            json.decodeFromString<MiWarpConnection>(raw).copy(
                id = UUID.randomUUID().toString(),
                lastConnectedAt = System.currentTimeMillis(),
            )
        } else {
            null
        }
    } catch (_: Exception) {
        null
    }
}
