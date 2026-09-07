package com.android.everytalk.data.agent

import com.android.everytalk.data.database.entities.AgentRunEntity
import android.util.Log
import java.util.UUID

/** 恢复日志只记录关联 ID 和决策，禁止写入 Prompt、密钥、工具参数或 continuation 内容。 */
object AgentRecoveryDiagnostics {
    val processInstanceId: String = UUID.randomUUID().toString()

    /** Release 只记录固定阶段和消息 ID，不记录模型内容、工具参数或认证信息。 */
    fun runtime(phase: String, messageId: String) {
        Log.println(Log.INFO, "AgentRuntime", "phase=$phase messageId=$messageId")
    }

    fun record(
        run: AgentRunEntity,
        recoveryDecision: String,
        serviceStartReason: String,
        requestId: String? = null,
        providerProtocol: String? = null,
        networkState: String? = null,
    ) {
        // println 不受 release 的 d/i/w 裁剪规则影响；只保留状态关联信息用于真机排障。
        Log.println(
            Log.INFO,
            "AgentRecovery",
            "processInstanceId=$processInstanceId runId=${run.id} requestId=${requestId.orEmpty()} " +
                "requestOrdinal=${run.currentRequestOrdinal} serviceStartReason=$serviceStartReason " +
                "previousRunStatus=${run.status} recoveryDecision=$recoveryDecision " +
                "providerProtocol=${providerProtocol.orEmpty()} networkState=${networkState.orEmpty()}",
        )
    }
}
