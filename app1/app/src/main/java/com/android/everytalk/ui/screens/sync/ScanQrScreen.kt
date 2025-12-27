package com.android.everytalk.ui.screens.sync

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import com.android.everytalk.util.SyncManager
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanQrScreen(
    onNavigateBack: () -> Unit,
    onQrCodeDetected: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { granted ->
            hasCameraPermission = granted
            if (!granted) {
                Toast.makeText(context, "需要相机权限才能扫码配对", Toast.LENGTH_SHORT).show()
            }
        }
    )

    // State for sync strategy dialog
    var showStrategyDialog by remember { mutableStateOf(false) }
    var scannedSid by remember { mutableStateOf("") }
    var scannedRelay by remember { mutableStateOf("") }

    if (showStrategyDialog) {
        AlertDialog(
            onDismissRequest = { showStrategyDialog = false },
            title = { Text("选择同步策略") },
            text = { Text("请选择 Web 端数据的处理方式：\n\n• 增量更新：保留 Web 端现有数据，合并新数据。\n• 覆盖更新：清除 Web 端所有数据，完全使用手机端数据覆盖。") },
            confirmButton = {
                TextButton(onClick = {
                    showStrategyDialog = false
                    SyncManager.connect(scannedRelay, scannedSid, overwrite = true)
                    onQrCodeDetected(scannedSid)
                }) {
                    Text("覆盖更新 (Web)")
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showStrategyDialog = false
                    SyncManager.connect(scannedRelay, scannedSid, overwrite = false)
                    onQrCodeDetected(scannedSid)
                }) {
                    Text("增量更新")
                }
            }
        )
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            launcher.launch(Manifest.permission.CAMERA)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("扫描Web端二维码") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        },
        containerColor = Color.Black
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            if (hasCameraPermission) {
                AndroidView(
                    factory = { ctx ->
                        val previewView = PreviewView(ctx)
                        val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

                        cameraProviderFuture.addListener({
                            val cameraProvider = cameraProviderFuture.get()
                            
                            val preview = Preview.Builder().build().also {
                                it.setSurfaceProvider(previewView.surfaceProvider)
                            }

                            val imageAnalyzer = ImageAnalysis.Builder()
                                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                .build()
                                .also {
                                    it.setAnalyzer(
                                        Executors.newSingleThreadExecutor(),
                                        QrCodeAnalyzer { qrContent ->
                                            // 避免重复回调，实际使用中可能需要更复杂的防抖
                                            Log.d("ScanQrScreen", "Detected QR: $qrContent")
                                            
                                            try {
                                                val json = JSONObject(qrContent)
                                                val sid = json.optString("sid")
                                                val relay = json.optString("relay")
                                                
                                                if (sid.isNotEmpty() && relay.isNotEmpty()) {
                                                    scannedSid = sid
                                                    scannedRelay = relay
                                                    showStrategyDialog = true
                                                }
                                            } catch (e: Exception) {
                                                // Not a valid JSON or sync QR
                                            }
                                        }
                                    )
                                }

                            try {
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(
                                    lifecycleOwner,
                                    CameraSelector.DEFAULT_BACK_CAMERA,
                                    preview,
                                    imageAnalyzer
                                )
                            } catch (exc: Exception) {
                                Log.e("ScanQrScreen", "Use case binding failed", exc)
                            }
                        }, ContextCompat.getMainExecutor(ctx))

                        previewView
                    },
                    modifier = Modifier.fillMaxSize()
                )
                
                // 绘制扫描框遮罩
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val scanBoxSize = 280.dp.toPx()
                    val left = (size.width - scanBoxSize) / 2
                    val top = (size.height - scanBoxSize) / 2
                    
                    // 半透明背景
                    drawRect(
                        color = Color.Black.copy(alpha = 0.5f),
                        size = size
                    )
                    
                    // 挖空中间
                    drawRoundRect(
                        color = Color.Transparent,
                        topLeft = Offset(left, top),
                        size = Size(scanBoxSize, scanBoxSize),
                        cornerRadius = CornerRadius(16.dp.toPx()),
                        blendMode = BlendMode.Clear
                    )
                    
                    // 边框
                    drawRoundRect(
                        color = Color.Green,
                        topLeft = Offset(left, top),
                        size = Size(scanBoxSize, scanBoxSize),
                        cornerRadius = CornerRadius(16.dp.toPx()),
                        style = Stroke(width = 4.dp.toPx())
                    )
                }
                
                Text(
                    text = "请将二维码放入框内",
                    color = Color.White,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 80.dp)
                )
            } else {
                Text(
                    text = "需要相机权限",
                    color = Color.White,
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }
    }
}