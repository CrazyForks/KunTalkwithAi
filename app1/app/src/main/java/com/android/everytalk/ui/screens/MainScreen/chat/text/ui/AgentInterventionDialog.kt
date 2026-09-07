package com.android.everytalk.ui.screens.MainScreen.chat.text.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.android.everytalk.data.agent.AgentInterventionPolicyRegistry
import com.android.everytalk.data.agent.PendingIntervention
import com.android.everytalk.data.agent.ResolutionMaterialKind
import com.android.everytalk.data.agent.SuspensionState
import com.android.everytalk.ui.components.dialog.AppDialogButtonShape
import com.android.everytalk.ui.components.dialog.AppDialogShape
import com.android.everytalk.ui.components.dialog.AppDialogTextFieldShape
import com.android.everytalk.ui.components.dialog.appDialogBorderColor
import com.android.everytalk.ui.components.dialog.appDialogContainerColor
import com.android.everytalk.ui.components.dialog.appDialogContentColor
import com.android.everytalk.ui.components.dialog.appDialogSubtextColor
import com.android.everytalk.ui.components.dialog.appDialogTextFieldColors

/**
 * 本地 Policy Registry 驱动的统一接力卡片。
 * 模型提供的 reason 只作为说明文字；字段类型和提交方式来自可信本地投影。
 */
@Composable
internal fun AgentInterventionDialog(
    intervention: PendingIntervention,
    onResolveNone: (PendingIntervention) -> Unit,
    onResolveEphemeral: (PendingIntervention, CharArray) -> Unit,
    onCreateAuthorization: (PendingIntervention, CharArray) -> Unit,
    onReject: (PendingIntervention) -> Unit,
    onConfirmUnknownDelivered: (PendingIntervention) -> Unit,
    onContinueUnknown: (PendingIntervention) -> Unit,
) {
    val dialogBg = appDialogContainerColor()
    val dialogContent = appDialogContentColor()
    val dialogBorder = appDialogBorderColor()
    var sensitiveInput by remember(intervention.suspensionId, intervention.rowVersion) { mutableStateOf("") }
    val field = intervention.fields.firstOrNull()
    val fieldKind = field?.kind
    val requiresUserDecision = intervention.state == SuspensionState.USER_DECISION_REQUIRED
    val canSubmit = if (requiresUserDecision) true else when (intervention.materialKind) {
        ResolutionMaterialKind.NONE -> true
        ResolutionMaterialKind.EPHEMERAL -> sensitiveInput.isNotEmpty()
        ResolutionMaterialKind.DURABLE_REFERENCE -> sensitiveInput.isNotEmpty()
    }

    AlertDialog(
        onDismissRequest = {},
        modifier = Modifier.border(1.dp, dialogBorder, AppDialogShape),
        shape = AppDialogShape,
        containerColor = dialogBg,
        titleContentColor = dialogContent,
        textContentColor = dialogContent,
        title = { Text("需要你接力", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = capabilityTitle(intervention.capabilityId),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = intervention.reasonSafe,
                    style = MaterialTheme.typography.bodySmall,
                    color = appDialogSubtextColor(0.76f),
                )
                intervention.userVisibleContext?.takeIf(String::isNotBlank)?.let { context ->
                    Text(
                        text = context,
                        style = MaterialTheme.typography.bodySmall,
                        color = appDialogSubtextColor(0.64f),
                    )
                }
                if (requiresUserDecision) {
                    Text(
                        text = "外部动作是否完成无法自动确认。旧密码或 OTP 已丢弃，禁止重新输入。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                } else when (intervention.materialKind) {
                    ResolutionMaterialKind.NONE -> Text(
                        text = field?.label ?: "确认当前操作",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    ResolutionMaterialKind.EPHEMERAL -> OutlinedTextField(
                        value = sensitiveInput,
                        onValueChange = { sensitiveInput = it },
                        label = { Text(field?.label ?: "敏感输入") },
                        singleLine = true,
                        shape = AppDialogTextFieldShape,
                        colors = appDialogTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    ResolutionMaterialKind.DURABLE_REFERENCE -> OutlinedTextField(
                        value = sensitiveInput,
                        onValueChange = { sensitiveInput = it },
                        label = { Text(field?.label ?: "授权凭据") },
                        singleLine = true,
                        shape = AppDialogTextFieldShape,
                        colors = appDialogTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = PasswordVisualTransformation(),
                    )
                }
                if (fieldKind in setOf(
                        AgentInterventionPolicyRegistry.FieldKind.SENSITIVE_TEXT,
                        AgentInterventionPolicyRegistry.FieldKind.AUTHORIZATION_SECRET,
                    )
                ) {
                    Text(
                        text = if (fieldKind == AgentInterventionPolicyRegistry.FieldKind.AUTHORIZATION_SECRET) {
                            "凭据会由 Android Keystore 加密保存，模型只能使用当前操作的受限能力。"
                        } else {
                            "内容只交给本地可信 Adapter，不会发送给模型或写入聊天记录。"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = appDialogSubtextColor(0.64f),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                enabled = canSubmit,
                onClick = {
                    if (requiresUserDecision) {
                        onConfirmUnknownDelivered(intervention)
                    } else when (intervention.materialKind) {
                        ResolutionMaterialKind.NONE -> onResolveNone(intervention)
                        ResolutionMaterialKind.EPHEMERAL -> {
                            val chars = sensitiveInput.toCharArray()
                            sensitiveInput = ""
                            onResolveEphemeral(intervention, chars)
                        }
                        ResolutionMaterialKind.DURABLE_REFERENCE -> {
                            val chars = sensitiveInput.toCharArray()
                            sensitiveInput = ""
                            onCreateAuthorization(intervention, chars)
                        }
                    }
                },
                shape = AppDialogButtonShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = dialogContent,
                    contentColor = dialogBg,
                ),
            ) {
                Text(
                    if (requiresUserDecision) "确认已完成" else "继续",
                    fontWeight = FontWeight.SemiBold,
                )
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = {
                    sensitiveInput = ""
                    if (requiresUserDecision) onContinueUnknown(intervention) else onReject(intervention)
                },
                shape = AppDialogButtonShape,
                colors = ButtonDefaults.outlinedButtonColors(
                    containerColor = Color.Transparent,
                    contentColor = dialogContent,
                ),
                border = BorderStroke(1.dp, dialogBorder),
            ) {
                Text(
                    if (requiresUserDecision) "保持未知并重规划" else "拒绝",
                    fontWeight = FontWeight.SemiBold,
                )
            }
        },
    )
}

private fun capabilityTitle(capability: String): String = when (capability) {
    "git.push" -> "提供 Git 仓库授权"
    "ssh.connect" -> "提供 SSH 登录能力"
    "privilege.sudo.execute" -> "输入 sudo 密码"
    "terminal.interaction" -> "接管终端输入"
    "server.restart.confirm" -> "确认服务器操作"
    "skill.openai_api_access" -> "提供 API 授权"
    else -> "提供执行能力"
}
