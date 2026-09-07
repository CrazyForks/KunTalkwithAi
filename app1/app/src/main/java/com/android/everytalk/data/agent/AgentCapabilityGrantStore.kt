package com.android.everytalk.data.agent

import com.android.everytalk.data.database.daos.AgentDao
import com.android.everytalk.data.database.entities.AgentCapabilityGrantEntity

/** CapabilityGrant 的持久原子消费入口。UNKNOWN 后保持 RESERVED，禁止自动恢复 AVAILABLE。 */
class AgentCapabilityGrantStore(private val dao: AgentDao) {
    class ClaimedGrant internal constructor(
        internal val grantId: String,
        internal val attemptId: String,
    )
    suspend fun create(grant: AgentCapabilityGrantEntity) {
        check(createIfAbsent(grant)) {
            "CapabilityGrant 已存在，或 AgentRun 已终止、generation 已变化"
        }
    }

    /** DELIVERED 崩溃恢复会重复派生同一个确定性 Grant；完全相同的记录视为幂等成功。 */
    suspend fun createIfAbsent(grant: AgentCapabilityGrantEntity): Boolean {
        require(grant.capability.isNotBlank()) { "CapabilityGrant capability 不能为空" }
        require(grant.operation.isNotBlank() && grant.targetBinding.isNotBlank() && grant.audience.isNotBlank()) {
            "CapabilityGrant 的 operation、target 和 audience 必须明确绑定"
        }
        require(grant.maxUses > 0 && grant.usageCount == 0) { "CapabilityGrant 初始使用次数无效" }
        require(grant.expiresAt > grant.issuedAt) { "CapabilityGrant TTL 无效" }
        if (dao.insertCapabilityGrantForActiveRun(grant)) return true
        val existing = dao.getCapabilityGrant(grant.grantId) ?: return false
        return existing.capability == grant.capability &&
            existing.runId == grant.runId &&
            existing.runGeneration == grant.runGeneration &&
            existing.toolCallId == grant.toolCallId &&
            existing.executionSlot == grant.executionSlot &&
            existing.operation == grant.operation &&
            existing.targetBinding == grant.targetBinding &&
            existing.audience == grant.audience &&
            existing.scope == grant.scope &&
            existing.generation == grant.generation &&
            existing.status == "AVAILABLE" &&
            existing.usageCount < existing.maxUses &&
            existing.expiresAt > System.currentTimeMillis() &&
            !existing.revoked
    }

    suspend fun claimUse(
        grantId: String,
        runId: String,
        runGeneration: Long,
        toolCallId: String,
        executionSlot: String,
        operation: String,
        targetBinding: String,
        audience: String,
        generation: Long,
        attemptId: String,
        now: Long = System.currentTimeMillis(),
    ): Boolean = dao.claimGrantUse(
        grantId,
        runId,
        runGeneration,
        toolCallId,
        executionSlot,
        operation,
        targetBinding,
        audience,
        generation,
        now,
        attemptId,
    ) == 1

    /**
     * 可信语义 Adapter 的正常入口。调用方无需也不能从模型参数取得 grantId。
     * 候选查询后仍以数据库 CAS 为准，并发消费者只有一个能拿到 ClaimedGrant。
     */
    suspend fun claimForOperation(
        capability: String,
        runId: String,
        runGeneration: Long,
        toolCallId: String,
        executionSlot: String,
        operation: String,
        targetBinding: String,
        audience: String,
        generation: Long,
        now: Long = System.currentTimeMillis(),
    ): ClaimedGrant? {
        val grant = dao.findAvailableCapabilityGrant(
            capability,
            runId,
            runGeneration,
            toolCallId,
            executionSlot,
            operation,
            targetBinding,
            audience,
            generation,
            now,
        ) ?: return null
        val attemptId = java.util.UUID.randomUUID().toString()
        return if (claimUse(
                grant.grantId,
                runId,
                runGeneration,
                toolCallId,
                executionSlot,
                operation,
                targetBinding,
                audience,
                generation,
                attemptId,
                now,
            )
        ) ClaimedGrant(grant.grantId, attemptId) else null
    }

    suspend fun consume(claim: ClaimedGrant): Boolean = consume(claim.grantId, claim.attemptId)

    suspend fun consume(grantId: String, attemptId: String): Boolean =
        dao.consumeGrant(grantId, attemptId) == 1

    suspend fun revoke(grantId: String): Boolean = dao.revokeGrant(grantId) == 1
}
