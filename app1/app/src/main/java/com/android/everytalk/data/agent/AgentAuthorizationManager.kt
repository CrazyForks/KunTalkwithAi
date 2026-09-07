package com.android.everytalk.data.agent

import com.android.everytalk.data.computer.ComputerCredentialStore
import java.util.UUID

/**
 * 可信 UI 保存长期授权的唯一入口。
 * Room 只得到 `stored-authorization:<id>`，授权正文由 Android Keystore 封装存储。
 */
class AgentAuthorizationManager(
    private val authorizations: AgentStoredAuthorizationStore,
    private val credentials: ComputerCredentialStore,
) {
    suspend fun saveWorkspaceAuthorization(
        provider: String,
        workspaceId: String,
        secret: CharArray,
        expiresAt: Long? = null,
        now: Long = System.currentTimeMillis(),
    ): String = try {
        require(provider in TRUSTED_PROVIDERS) { "不支持的授权 provider" }
        require(workspaceId.isNotBlank()) { "workspaceId 不能为空" }
        val authorizationId = UUID.randomUUID().toString()
        val credentialReference = "agent-auth:$authorizationId"
        val publicReference = "stored-authorization:$authorizationId"
        credentials.saveAgentAuthorization(credentialReference, secret)
        try {
            authorizations.save(
                StoredAuthorization(
                    authorizationId = authorizationId,
                    provider = provider,
                    credentialReference = credentialReference,
                    userConsentScope = "WORKSPACE",
                    workspaceId = workspaceId,
                    issuedAt = now,
                    expiresAt = expiresAt,
                    revoked = false,
                    generation = 1,
                ),
            )
            return publicReference
        } catch (error: Throwable) {
            runCatching { credentials.deleteAgentAuthorization(credentialReference) }
            throw error
        }
    } finally {
        secret.fill('\u0000')
    }

    /** UI 提交与 Suspension CAS 竞争失败时销毁刚创建、尚未使用的授权。 */
    suspend fun discard(publicReference: String) {
        val authorizationId = publicReference.removePrefix("stored-authorization:")
        if (authorizationId == publicReference || authorizationId.isBlank()) return
        val authorization = authorizations.get(authorizationId) ?: return
        if (authorizations.revoke(authorizationId)) {
            credentials.deleteAgentAuthorization(authorization.credentialReference)
        }
    }

    private companion object {
        val TRUSTED_PROVIDERS = setOf("github", "openai")
    }
}
