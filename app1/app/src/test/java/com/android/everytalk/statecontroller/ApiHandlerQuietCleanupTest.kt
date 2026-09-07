package com.android.everytalk.statecontroller

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import io.mockk.mockk
import io.mockk.spyk
import io.mockk.verify
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 实际调用公共取消入口：没有任务时的初始化清理不能产生 Toast，也不能遗漏原有状态清理。 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ApiHandlerQuietCleanupTest {
    private val holder = spyk(ViewModelStateHolder())
    // 本测试只验证同步清理，不启动无关的应用级 Agent 事件收集器。
    private val scope = CoroutineScope(Job().apply { cancel() } + Dispatchers.Unconfined)
    private val handler = ApiHandler(
        context = ApplicationProvider.getApplicationContext<Application>(),
        stateHolder = holder,
        viewModelScope = scope,
        historyManager = mockk(relaxed = true),
        onAiMessageFullTextChanged = { _, _ -> },
        triggerScrollToBottom = {},
    )

    @Test
    fun `启动新聊天切换配置加载历史的空清理不弹提示`() {
        listOf("开始新聊天", "Switching selected config to ID test", "加载文本模式历史索引 0").forEach {
            handler.cancelCurrentApiJob(it)
        }
        verify(exactly = 0) { holder.showSnackbar(any()) }
        assertFalse(holder._isTextApiCalling.value)
        assertNull(holder._currentTextStreamingAiMessageId.value)
    }

    @Test
    fun `静默清理仍然取消遗留Job并重置状态`() {
        val job = Job()
        holder.textApiJob = job
        holder._isTextApiCalling.value = true
        handler.cancelCurrentApiJob("开始新聊天")
        assertTrue(job.isCancelled)
        assertNull(holder.textApiJob)
        assertFalse(holder._isTextApiCalling.value)
        verify(exactly = 0) { holder.showSnackbar(any()) }
    }

    @Test
    fun `任务恰好结束后的停止点击也不弹没有任务的无用提示`() {
        handler.cancelCurrentApiJob("用户取消操作", showFeedback = true)
        verify(exactly = 0) { holder.showSnackbar(any()) }
    }
}
