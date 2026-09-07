package com.android.everytalk.statecontroller

import com.android.everytalk.data.agent.AgentRunControlSnapshot
import com.android.everytalk.data.agent.AgentRunControlState
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Test

/** 直接调用 ViewModel 按钮入口，验证重组延迟和切换会话不会绕过真实状态检查。 */
class ComposerForceStopTest {
    private val visibleId = MutableStateFlow<String?>("ai-1")
    private val stopping = MutableStateFlow(false)
    private val snapshots = MutableStateFlow(mapOf(
        "ai-1" to AgentRunControlSnapshot("run-1", "ai-1", AgentRunControlState.PAUSE_REQUESTED),
    ))
    private val holder = mockk<ViewModelStateHolder> {
        every { _currentTextStreamingAiMessageId } returns visibleId
        every { _isRemoteCancellationPending } returns stopping
    }
    private val handler = mockk<ApiHandler>(relaxed = true) {
        every { agentRunControlSnapshots } returns snapshots
    }
    private val viewModel = mockk<AppViewModel> {
        every { stateHolder } returns holder
        every { apiHandler } returns handler
    }

    @Test
    fun `等待暂停第二次点击只取消一次第三次被同步状态挡住`() {
        every { handler.cancelCurrentApiJob(any(), any(), any(), any()) } answers { stopping.value = true }
        viewModel.forceStopPendingPause("ai-1")
        viewModel.forceStopPendingPause("ai-1")
        verify(exactly = 1) { handler.cancelCurrentApiJob(any(), false, false, true) }
    }

    @Test
    fun `已经安全暂停运行中或完成时旧加载按钮不能强停`() {
        listOf(AgentRunControlState.PAUSED, AgentRunControlState.RUNNING).forEach { state ->
            snapshots.value = mapOf("ai-1" to AgentRunControlSnapshot("run-1", "ai-1", state))
            viewModel.forceStopPendingPause("ai-1")
        }
        snapshots.value = emptyMap()
        viewModel.forceStopPendingPause("ai-1")
        verify(exactly = 0) { handler.cancelCurrentApiJob(any(), any(), any(), any()) }
    }

    @Test
    fun `切换会话后旧页面点击不能取消新的Run`() {
        visibleId.value = "ai-2"
        snapshots.value = mapOf("ai-2" to AgentRunControlSnapshot("run-2", "ai-2", AgentRunControlState.PAUSE_REQUESTED))
        viewModel.forceStopPendingPause("ai-1")
        viewModel.forceStopPendingPause(null)
        verify(exactly = 0) { handler.cancelCurrentApiJob(any(), any(), any(), any()) }
    }
}
