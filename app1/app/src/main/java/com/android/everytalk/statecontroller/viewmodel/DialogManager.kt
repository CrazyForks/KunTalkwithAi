package com.android.everytalk.statecontroller.viewmodel

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 管理所有对话框状态
 */
class DialogManager {
    // 系统提示对话框
    private val _showSystemPromptDialog = MutableStateFlow(false)
    val showSystemPromptDialog: StateFlow<Boolean> = _showSystemPromptDialog.asStateFlow()
    
    var originalSystemPrompt: String? = null
        private set
    
    // 关于对话框
    private val _showAboutDialog = MutableStateFlow(false)
    val showAboutDialog: StateFlow<Boolean> = _showAboutDialog.asStateFlow()
    
    // 清除图像历史对话框
    private val _showClearImageHistoryDialog = MutableStateFlow(false)
    val showClearImageHistoryDialog: StateFlow<Boolean> = _showClearImageHistoryDialog.asStateFlow()
    
    // 系统提示对话框方法
    fun showSystemPromptDialog(currentPrompt: String) {
        originalSystemPrompt = currentPrompt
        _showSystemPromptDialog.value = true
    }
    
    fun dismissSystemPromptDialog() {
        _showSystemPromptDialog.value = false
        originalSystemPrompt = null
    }
    
    // 关于对话框方法
    fun showAboutDialog() {
        _showAboutDialog.value = true
    }
    
    fun dismissAboutDialog() {
        _showAboutDialog.value = false
    }
    
    // 清除图像历史对话框方法
    fun showClearImageHistoryDialog() {
        _showClearImageHistoryDialog.value = true
    }
    
    fun dismissClearImageHistoryDialog() {
        _showClearImageHistoryDialog.value = false
    }
}
