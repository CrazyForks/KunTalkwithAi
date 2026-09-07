package com.android.everytalk.ui.screens.settings

import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.android.everytalk.R
import com.android.everytalk.statecontroller.*
import com.android.everytalk.util.storage.readAtMost
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MAX_SETTINGS_IMPORT_BYTES = 50L * 1024L * 1024L

private fun readSettingsImportText(
    inputStream: java.io.InputStream,
    tooLargeMessage: String,
): String {
    return try {
        readAtMost(inputStream, MAX_SETTINGS_IMPORT_BYTES).toString(Charsets.UTF_8)
    } catch (e: IllegalArgumentException) {
        throw IllegalStateException(tooLargeMessage, e)
    }
}

/**
 * 在导航容器外常驻的导入/导出宿主。
 * 所有菜单只改变 visible，不返回其他页面；文件选择器和导出请求也始终只有一个接收者。
 * 弹窗关闭后仍保留宿主，确保系统文件选择器返回时能收到成功或取消结果。
 */
@Composable
internal fun SettingsImportExportHost(
    viewModel: AppViewModel,
    visible: Boolean,
    onDismissRequest: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val importTooLargeMessage = stringResource(R.string.settings_import_too_large)
    val exportContentExpiredMessage = stringResource(R.string.settings_export_content_expired)
    val exportSuccessMessage = stringResource(R.string.settings_export_success)
    val importUnreadableMessage = stringResource(R.string.settings_import_unreadable)

    val exportSettingsLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json"),
        onResult = { uri ->
            val exportData = viewModel.consumeSettingsExport()
            if (uri == null) {
                // 取消系统选择器时只清理待导出的临时文件，不触发导航。
                exportData?.file?.delete()
                return@rememberLauncherForActivityResult
            }
            val sourceFile = exportData?.file?.takeIf { it.isFile }
            if (sourceFile == null) {
                viewModel.showToast(exportContentExpiredMessage)
                return@rememberLauncherForActivityResult
            }
            scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        // 目标提供者无法打开文件时必须报错，不能把空结果当成导出成功。
                        val descriptor = requireNotNull(context.contentResolver.openFileDescriptor(uri, "w")) {
                            "无法打开导出目标文件"
                        }
                        descriptor.use { pfd ->
                            java.io.FileOutputStream(pfd.fileDescriptor).use { outputStream ->
                                outputStream.channel.truncate(0)
                                sourceFile.inputStream().buffered().use { input ->
                                    input.copyTo(outputStream)
                                }
                            }
                        }
                    }
                    viewModel.showToast(exportSuccessMessage)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e("SettingsImportExport", "导出失败", e)
                    viewModel.showToast(
                        context.getString(
                            R.string.settings_export_failed_detail,
                            e.message ?: context.getString(R.string.unknown_error),
                        )
                    )
                } finally {
                    sourceFile.delete()
                }
            }
        }
    )

    val importSettingsLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent(),
        onResult = { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch {
                try {
                    val jsonContent = withContext(Dispatchers.IO) {
                        context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { descriptor ->
                            if (descriptor.length > MAX_SETTINGS_IMPORT_BYTES) {
                                throw IllegalStateException(importTooLargeMessage)
                            }
                        }
                        context.contentResolver.openInputStream(uri)?.use { inputStream ->
                            readSettingsImportText(inputStream, importTooLargeMessage)
                        }
                    }
                    if (jsonContent == null) {
                        viewModel.showToast(importUnreadableMessage)
                    } else {
                        viewModel.importSettings(jsonContent)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    viewModel.showToast(
                        context.getString(
                            R.string.settings_import_failed_detail,
                            e.message ?: context.getString(R.string.unknown_error),
                        )
                    )
                }
            }
        }
    )

    LaunchedEffect(viewModel) {
        viewModel.settingsExportRequest.collect { data ->
            viewModel.stageSettingsExport(data)
            exportSettingsLauncher.launch(data.fileName)
        }
    }

    if (visible) {
        val textConfigs by viewModel.apiConfigs.collectAsState()
        val imageConfigs by viewModel.imageGenApiConfigs.collectAsState()
        // 获取聊天历史数量
        val chatHistory by viewModel.historicalConversations.collectAsState()
        val imageHistory by viewModel.imageGenerationHistoricalConversations.collectAsState()

        ImportExportDialog(
            onDismissRequest = onDismissRequest,
            onExport = { includeHistory ->
                viewModel.exportSettings(includeHistory)
                onDismissRequest()
            },
            onImport = {
                importSettingsLauncher.launch("application/json")
                onDismissRequest()
            },
            isExportEnabled = (textConfigs + imageConfigs).isNotEmpty() || chatHistory.isNotEmpty() || imageHistory.isNotEmpty(),
            chatHistoryCount = chatHistory.size,
            imageHistoryCount = imageHistory.size
        )
    }

}
