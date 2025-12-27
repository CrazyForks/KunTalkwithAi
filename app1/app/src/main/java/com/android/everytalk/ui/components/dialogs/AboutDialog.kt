package com.android.everytalk.ui.components.dialogs

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.android.everytalk.statecontroller.AppViewModel

@Composable
fun AboutDialog(
    viewModel: AppViewModel,
    onDismiss: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val packageInfo = remember { context.packageManager.getPackageInfo(context.packageName, 0) }
    val versionName = packageInfo.versionName

    val isDarkTheme = isSystemInDarkTheme()
    val cancelButtonColor = if (isDarkTheme) Color(0xFFFF5252) else Color(0xFFD32F2F)
    val confirmButtonColor = if (isDarkTheme) Color.White else Color(0xFF212121)
    val confirmButtonTextColor = if (isDarkTheme) Color.Black else Color.White

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(32.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        titleContentColor = MaterialTheme.colorScheme.onSurface,
        textContentColor = MaterialTheme.colorScheme.onSurface,
        title = { Text("关于 EveryTalk") },
        text = {
            val uriHandler = LocalUriHandler.current
            val annotatedString = buildAnnotatedString {
                append("版本: $versionName\n\n一个开源的、可高度定制的 AI 聊天客户端。\n\nGitHub: ")
                pushStringAnnotation(tag = "URL", annotation = "https://github.com/roseforljh/KunTalkwithAi")
                withStyle(style = SpanStyle(color = Color(0xFF007eff))) {
                    append("EveryTalk")
                }
                pop()
            }

            ClickableText(
                text = annotatedString,
                style = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                onClick = { offset ->
                    annotatedString.getStringAnnotations(tag = "URL", start = offset, end = offset)
                        .firstOrNull()?.let { annotation ->
                            uriHandler.openUri(annotation.item)
                        }
                }
            )
        },
        confirmButton = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 关闭按钮：统一取消样式（红色描边）
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    shape = RoundedCornerShape(24.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                        contentColor = cancelButtonColor
                    ),
                    border = androidx.compose.foundation.BorderStroke(1.dp, cancelButtonColor)
                ) {
                    Text(
                        text = "关闭",
                        style = MaterialTheme.typography.labelLarge.copy(
                            fontWeight = FontWeight.SemiBold
                        )
                    )
                }

                // 检查更新按钮：统一确认样式
                Button(
                    onClick = {
                        viewModel.checkForUpdates()
                        onDismiss()
                    },
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    shape = RoundedCornerShape(24.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = confirmButtonColor,
                        contentColor = confirmButtonTextColor,
                        disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                    )
                ) {
                    Text(
                        text = "检查更新",
                        style = MaterialTheme.typography.labelLarge.copy(
                            fontWeight = FontWeight.SemiBold
                        )
                    )
                }
            }
        },
        dismissButton = {}
    )
}