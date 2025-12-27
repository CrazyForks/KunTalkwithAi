package com.android.everytalk.ui.screens.account

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.android.everytalk.statecontroller.AppViewModel
import com.android.everytalk.ui.screens.settings.dialogs.GoogleSignInDialog
import android.app.Activity

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    viewModel: AppViewModel,
    navController: NavController
) {
    val userInfo by viewModel.userInfo.collectAsState()
    var showGoogleSignInDialog by remember { mutableStateOf(false) }
    
    // Google 登录对话框
    if (showGoogleSignInDialog) {
        val activity = LocalContext.current as? Activity
        GoogleSignInDialog(
            showDialog = true,
            onDismiss = { showGoogleSignInDialog = false },
            onSignIn = {
                if (activity != null) {
                    viewModel.signInWithGoogle(
                        activity = activity,
                        onSuccess = {
                            viewModel.showToast("登录成功")
                            showGoogleSignInDialog = false
                        },
                        onError = { error ->
                            viewModel.showToast("登录失败: $error")
                        }
                    )
                } else {
                    viewModel.showToast("无法获取 Activity Context")
                }
            }
        )
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
        topBar = {
            TopAppBar(
                title = { Text("账号管理", color = MaterialTheme.colorScheme.onSurface) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            "返回",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            
            // 账号卡片
            AccountInfoCard(
                userInfo = userInfo,
                onSignInClick = { showGoogleSignInDialog = true },
                onSignOutClick = { viewModel.signOut() }
            )
            
            // 未来可扩展更多账号相关设置
        }
    }
}

@Composable
private fun AccountInfoCard(
    userInfo: com.android.everytalk.data.DataClass.UserInfo?,
    onSignInClick: () -> Unit,
    onSignOutClick: () -> Unit
) {
    val isDark = isSystemInDarkTheme()
    val containerColor = MaterialTheme.colorScheme.surface
    val borderColor = if (isDark) Color.White.copy(alpha = 0.2f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)

    OutlinedCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.outlinedCardColors(containerColor = containerColor),
        elevation = CardDefaults.outlinedCardElevation(defaultElevation = 2.dp),
        border = androidx.compose.foundation.BorderStroke(2.dp, borderColor)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (userInfo != null) {
                // 已登录状态
                coil3.compose.AsyncImage(
                    model = userInfo.photoUrl,
                    contentDescription = "用户头像",
                    modifier = Modifier
                        .size(80.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop
                )
                
                Spacer(Modifier.height(16.dp))
                
                Text(
                    text = userInfo.displayName ?: "用户",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                
                if (!userInfo.email.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = userInfo.email,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                
                Spacer(Modifier.height(24.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                Spacer(Modifier.height(24.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = onSignOutClick,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        ),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error)
                    ) {
                         Text("退出登录")
                    }
                    
                    // 预留功能：切换账号
                    OutlinedButton(
                        onClick = { /* TODO: 切换账号逻辑 */ },
                        enabled = false, // 暂时禁用
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("切换账号")
                    }
                }
                 // 预留功能：添加账号
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = { /* TODO: 添加账号逻辑 */ },
                    enabled = false, // 暂时禁用
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Filled.Add, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("添加其他账号")
                }


            } else {
                // 未登录状态
                Icon(
                    imageVector = Icons.Filled.AccountCircle, 
                    contentDescription = null,
                    modifier = Modifier.size(80.dp),
                    tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "尚未登录",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "登录以同步您的数据和设置",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                
                Spacer(Modifier.height(24.dp))
                
                Button(
                    onClick = onSignInClick,
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Google 登录", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
}