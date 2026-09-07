package com.android.everytalk.data.agent

import com.android.everytalk.data.network.AppStreamEvent
import com.android.everytalk.data.network.TOOL_CALL_WRITING_STATUS
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentFirstEventTimeoutTest {
    @Test
    fun `工具编写开始后不会因等待完整参数触发首响应超时`() = runTest {
        val events = flow {
            emit(AppStreamEvent.ExecutionStatusUpdate(TOOL_CALL_WRITING_STATUS))
            delay(20)
            emit(AppStreamEvent.Finish("stop"))
        }.withFirstMeaningfulEventTimeout(timeoutMillis = 10).toList()

        assertEquals(2, events.size)
        assertTrue(events.last() is AppStreamEvent.Finish)
    }

    @Test
    fun `首个有效事件超时会终止僵死模型流`() = runTest {
        val error = runCatching {
            flow<AppStreamEvent> { delay(100) }
                .withFirstMeaningfulEventTimeout(timeoutMillis = 10)
                .toList()
        }.exceptionOrNull()

        assertTrue(error is IllegalStateException)
        assertTrue(error?.message.orEmpty().contains("没有返回有效事件"))
    }

    @Test
    fun `首个有效事件到达后继续消费同一条流`() = runTest {
        val events = flow {
            emit(AppStreamEvent.StatusUpdate("连接完成"))
            emit(AppStreamEvent.Text("第一段"))
            delay(20)
            emit(AppStreamEvent.Text("第二段"))
        }.withFirstMeaningfulEventTimeout(timeoutMillis = 10).toList()

        assertEquals(listOf("第一段", "第二段"), events.filterIsInstance<AppStreamEvent.Text>().map { it.text })
    }
}
