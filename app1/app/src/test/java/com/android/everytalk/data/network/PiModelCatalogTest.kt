package com.android.everytalk.data.network

import com.android.everytalk.data.DataClass.ModelCapabilitySource
import com.android.everytalk.data.DataClass.ModelParameterProtocol
import java.nio.file.Files
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class PiModelCatalogTest {
    @Test
    fun `同名冲突取保守值且忽略远端地址协议和provider`() = runTest {
        val directory = Files.createTempDirectory("pi-name-match").toFile()
        try {
            val catalog = PiModelCatalog(directory.resolve("pi.json"))
            val result = catalog.findCapabilities(listOf(" Models/SHARED ", "proxy/shared", "shared-new"), ModelParameterProtocol.GEMINI) { sample }
            assertEquals(2, result.size)
            result.forEach {
                assertEquals(128_000, it.contextWindowTokens)
                assertEquals(16_000, it.maxOutputTokens)
                assertEquals(setOf("text"), it.inputModalities)
                assertEquals(false, it.supportsReasoning)
                assertTrue(it.reasoningEfforts.isEmpty())
                assertNull(it.endpointIdentity)
                assertNull(it.providerId)
                assertEquals(ModelParameterProtocol.GEMINI, it.protocol)
                assertEquals(ModelCapabilitySource.PI_CATALOG, it.source)
            }
        } finally { directory.deleteRecursively() }
    }

    @Test
    fun `只读取有效数值和显式推理等级不执行远端设置`() {
        val parsed = requireNotNull(parsePiModelCatalog("""{"p":{"good":{"id":"good","contextWindow":256000,"maxTokens":32000,"reasoning":true,"thinkingLevelMap":{"off":null,"low":"low","high":"max","budget":2048},"baseUrl":"https://other"},"bad":{"id":"bad","contextWindow":-1,"maxTokens":99999999999},"empty":{}}}""", 1234))
        assertEquals(setOf("good"), parsed.keys)
        val good = parsed.getValue("good").single()
        assertEquals(setOf("low", "max"), good.reasoningEfforts)
        assertEquals(1234L, good.sourceUpdatedAt)
        assertNull(good.endpointIdentity)
        assertNull(parsePiModelCatalog("not-json", 0))
        assertNull(parsePiModelCatalog("{}", 0))
    }

    @Test
    fun `刷新失败保留过期pi缓存且不会写坏文件`() = runTest {
        val directory = Files.createTempDirectory("pi-stale").toFile()
        try {
            val file = directory.resolve("pi.json")
            file.writeText(sample)
            file.setLastModified(1_000L)
            val catalog = PiModelCatalog(file, nowEpochMillis = { 100_000L }, ttlMillis = 1_000L)
            val result = catalog.findCapabilities(listOf("shared"), ModelParameterProtocol.CODEX) { "not-json" }.single()
            assertEquals(128_000, result.contextWindowTokens)
            assertEquals(ModelCapabilitySource.PI_CATALOG, result.source)
            assertEquals(1_000L, result.sourceUpdatedAt)
            assertEquals(sample, file.readText())
        } finally { directory.deleteRecursively() }
    }

    @Test
    fun `并发读取只下载一次并能从磁盘重新加载`() = runTest {
        val directory = Files.createTempDirectory("pi-concurrent").toFile()
        try {
            val file = directory.resolve("pi.json")
            val catalog = PiModelCatalog(file)
            var requests = 0
            val release = CompletableDeferred<Unit>()
            val jobs = List(4) {
                async { catalog.findCapabilities(listOf("shared"), ModelParameterProtocol.OPENAI_COMPATIBLE) {
                    requests++
                    release.await()
                    sample
                } }
            }
            release.complete(Unit)
            assertTrue(jobs.awaitAll().all { it.size == 1 })
            assertEquals(1, requests)
            val restored = PiModelCatalog(file).findCapabilities(listOf("shared"), ModelParameterProtocol.CODEX) { error("不应联网") }
            assertEquals(128_000, restored.single().contextWindowTokens)
        } finally { directory.deleteRecursively() }
    }

    @Test
    fun `取消下载不写缓存且下一次可以重试`() = runTest {
        val directory = Files.createTempDirectory("pi-cancel").toFile()
        try {
            val file = directory.resolve("pi.json")
            val catalog = PiModelCatalog(file)
            val started = CompletableDeferred<Unit>()
            val job = launch { catalog.findCapabilities(listOf("shared"), ModelParameterProtocol.CODEX) {
                started.complete(Unit)
                awaitCancellation()
            } }
            started.await()
            job.cancelAndJoin()
            assertFalse(file.exists())
            assertEquals(1, catalog.findCapabilities(listOf("shared"), ModelParameterProtocol.CODEX) { sample }.size)
        } finally { directory.deleteRecursively() }
    }

    private val sample = """{"first":{"shared":{"id":"shared","baseUrl":"https://first","api":"anthropic-messages","contextWindow":200000,"maxTokens":32000,"input":["text","image"],"reasoning":true,"thinkingLevelMap":{"high":"high"}}},"second":{"shared":{"id":"shared","baseUrl":"https://second","api":"openai-responses","contextWindow":128000,"maxTokens":16000,"input":["text"],"reasoning":false}}}"""
}
