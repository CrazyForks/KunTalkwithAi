package com.android.everytalk.ui.components.dialogs

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.android.everytalk.data.repository.AuthRepository
import com.android.everytalk.data.repository.SyncRepository
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun SyncSettingsDialog(
    onDismissRequest: () -> Unit,
    authRepository: AuthRepository,
    syncRepository: SyncRepository
) {
    val isSignedIn by authRepository.isSignedIn.collectAsState()
    val scope = rememberCoroutineScope()
    var isSyncing by remember { mutableStateOf(false) }
    var syncMessage by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismissRequest,
        title = { Text("账号与同步") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                if (isSignedIn) {
                    Text("已登录 Google 账号")
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    if (isSyncing) {
                        CircularProgressIndicator()
                        Text("正在同步...", style = MaterialTheme.typography.bodySmall)
                    } else {
                        Button(
                            onClick = {
                                isSyncing = true
                                syncMessage = ""
                                scope.launch {
                                    try {
                                        syncRepository.sync()
                                        syncMessage = "同步完成"
                                    } catch (e: Exception) {
                                        syncMessage = "同步失败: ${e.message}"
                                    } finally {
                                        isSyncing = false
                                    }
                                }
                            }
                        ) {
                            Text("立即同步")
                        }
                    }
                    
                    if (syncMessage.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(syncMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                    }

                    Spacer(modifier = Modifier.height(24.dp))
                    TextButton(onClick = { 
                        authRepository.signOut() 
                        syncMessage = ""
                    }) {
                        Text("退出登录", color = MaterialTheme.colorScheme.error)
                    }
                } else {
                    Text("登录以同步您的会话和设置")
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = {
                            scope.launch {
                                val success = authRepository.signInWithGoogle()
                                if (success) {
                                    // Auto sync after login
                                    isSyncing = true
                                    try {
                                        syncRepository.sync()
                                        syncMessage = "同步完成"
                                    } catch (e: Exception) {
                                        syncMessage = "登录成功，但同步失败"
                                    } finally {
                                        isSyncing = false
                                    }
                                } else {
                                    syncMessage = "登录失败"
                                }
                            }
                        }
                    ) {
                        Text("使用 Google 登录")
                    }
                    if (syncMessage.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(syncMessage, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismissRequest) {
                Text("关闭")
            }
        }
    )
}