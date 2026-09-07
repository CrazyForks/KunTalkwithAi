package com.android.everytalk.data.database

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.android.everytalk.data.computer.*
import com.android.everytalk.data.database.entities.toEntity
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** 使用真实 Room 事务，验证旧启动快照不会抹掉停止意图，查询也不跨 Run。 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], application = Application::class)
class ComputerCancellationPersistenceTest {
    private lateinit var database: AppDatabase

    @Before
    fun setUp() = runBlocking {
        database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        val dao = database.computerDao()
        dao.upsertComputer(Computer(
            id = "computer", displayName = "测试", host = "example.test", port = 22, username = "root",
            authKind = ComputerAuthKind.PASSWORD, runMode = ComputerRunMode.DIRECT, status = ComputerStatus.READY,
        ).toEntity(Json))
        dao.upsertWorkspace(ComputerWorkspace(
            id = "workspace", computerId = "computer", conversationId = "session",
            runMode = ComputerRunMode.DIRECT, hostPath = "/test/workspace",
        ).toEntity())
    }

    @After fun tearDown() = database.close()

    private fun execution(id: String, run: String = "run-1") = ComputerExecution(
        id = id, toolCallId = "tool_$id", computerId = "computer", workspaceId = "workspace",
        toolName = "exec", requestHash = "a".repeat(64), status = ComputerExecutionStatus.RUNNING,
        runId = run, remoteStatus = ComputerRemoteStatus.RUNNING,
        completionMode = ComputerExecutionCompletionMode.WAIT_FOR_RESULT,
    ).toEntity()

    @Test
    fun `停止登记后写回旧快照仍保留取消意图`() = runBlocking {
        val dao = database.computerDao()
        val stale = execution("execution_current")
        dao.upsertExecution(stale)
        dao.markRemoteExecutionCancellationRequested(stale.id, 123L)
        dao.upsertExecution(stale.copy(lastObservedAt = 456L))
        assertEquals(123L, dao.getExecutionById(stale.id)?.cancelRequestedAt)
        assertTrue(requireNotNull(dao.getExecutionById(stale.id)).shouldRetryRemoteCancellation())
    }

    @Test
    fun `断网未知任务仍可登记停止但不选其他Run`() = runBlocking {
        val dao = database.computerDao()
        val unknown = execution("execution_unknown").copy(
            status = "UNKNOWN", remoteStatus = "UNKNOWN", errorCode = ComputerErrorCodes.EXECUTION_CANCEL_FAILED,
        )
        dao.upsertExecution(unknown)
        dao.upsertExecution(execution("execution_other", "run-2"))
        dao.upsertExecution(execution("execution_completed").copy(status = "SUCCEEDED", remoteStatus = "SUCCEEDED"))
        assertEquals(listOf(unknown.id), dao.getCancellableRemoteExecutionsForRun("run-1").map { it.id })
        dao.markRemoteExecutionCancellationRequested(unknown.id, 123L)
        assertEquals(123L, dao.getExecutionById(unknown.id)?.cancelRequestedAt)
        assertNull(dao.getExecutionById("execution_other")?.cancelRequestedAt)
    }
}
