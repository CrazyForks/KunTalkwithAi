package com.android.everytalk.ui.components.coordinator
import com.android.everytalk.ui.components.markdown.MarkdownRenderer

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import com.android.everytalk.ui.components.math.MathAwareText
import com.android.everytalk.ui.components.table.TableAwareText
import com.android.everytalk.ui.components.table.TableUtils

/**
 * 内容协调器（搬迁版）
 * 原文件位置：ui/components/ContentCoordinator.kt
 * 说明：统一调度表格/数学/代码块/纯文本渲染；提供递归深度保护。
 * 缓存机制：通过contentKey持久化解析结果，避免LazyColumn回收导致重复解析
 */
@Composable
fun ContentCoordinator(
    text: String,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = Color.Unspecified,
    isStreaming: Boolean = false,
    modifier: Modifier = Modifier,
    recursionDepth: Int = 0,
    contentKey: String = ""  // 🎯 新增：用于缓存key（通常为消息ID）
) {
    // 🛡️ 防止无限递归：超过3层直接渲染
    if (recursionDepth > 3) {
        android.util.Log.w(
            "ContentCoordinator",
            "递归深度超限($recursionDepth)，直接渲染以避免ANR"
        )
        MarkdownRenderer(
            markdown = text,
            style = style,
            color = color,
            modifier = modifier.fillMaxWidth(),
            isStreaming = isStreaming
        )
        return
    }
    
    // 🎯 轻量检测
    val hasCodeBlock = text.contains("```")
    val hasTable = text.contains("|") && text.lines().any { line -> TableUtils.isTableLine(line) }

    // ⚡ 流式阶段：使用轻量模式，避免频繁解析
    // 流式结束后：触发完整解析，将代码块转换为CodeBlock组件
    // 性能保护：
    //   - TableAwareText 延迟250ms解析大型内容（>8000字符）
    //   - 使用后台线程（Dispatchers.Default）避免阻塞UI
    if (hasCodeBlock || hasTable) {
        // 🎯 只根据流式状态判断是否使用轻量模式
        val shouldUseLightweight = isStreaming
        
        TableAwareText(
            text = text,
            style = style,
            color = color,
            isStreaming = shouldUseLightweight, // true=轻量；false=完整（仅纯表格）
            modifier = modifier.fillMaxWidth(),
            recursionDepth = recursionDepth,
            contentKey = contentKey  // 🎯 传递缓存key
        )
        return
    }
    
    // 🎯 优先级3：检测数学公式（粗略检测，以 $ 为信号）
    val hasMath = text.contains("$")
    if (hasMath) {
        MathAwareText(
            text = text,
            style = style,
            color = color,
            isStreaming = isStreaming,
            modifier = modifier,
            recursionDepth = recursionDepth,
            contentKey = contentKey  // 🎯 传递缓存key
        )
        return
    }
    
    // 🎯 优先级4：纯文本（无代码块、表格、数学）
    MarkdownRenderer(
        markdown = text,
        style = style,
        color = color,
        modifier = modifier.fillMaxWidth(),
        isStreaming = isStreaming
    )
}
