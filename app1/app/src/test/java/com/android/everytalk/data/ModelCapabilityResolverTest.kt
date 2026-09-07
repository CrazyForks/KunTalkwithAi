package com.android.everytalk.data

import com.android.everytalk.data.DataClass.ApiConfig
import com.android.everytalk.data.DataClass.ModelCapabilityCandidate
import com.android.everytalk.data.DataClass.ModelCapabilitySource
import com.android.everytalk.data.DataClass.ModelParameterProtocol
import com.android.everytalk.data.DataClass.ModelParameters
import com.android.everytalk.data.DataClass.ModelTokenLimits
import com.android.everytalk.data.DataClass.ResolvedModelCapability
import com.android.everytalk.data.DataClass.resolveModelCapability
import com.android.everytalk.data.DataClass.withModelCapabilityDefaults
import kotlinx.serialization.json.Json
import com.android.everytalk.data.DataClass.familyModelCapability
import com.android.everytalk.data.DataClass.withUserTokenLimits
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelCapabilityResolverTest {

    @Test
    fun `pi高于社区与旧缓存但保留实时和手动值优先级`() {
        val priority = listOf(
            ModelCapabilitySource.USER_OVERRIDE, ModelCapabilitySource.LIVE_ENDPOINT,
            ModelCapabilitySource.PI_CATALOG,
            ModelCapabilitySource.LOCAL_CACHE, ModelCapabilitySource.COMMUNITY_CATALOG,
            ModelCapabilitySource.FAMILY_FALLBACK, ModelCapabilitySource.CONSERVATIVE_DEFAULT,
        )
        val candidates = priority.mapIndexed { index, source ->
            ModelCapabilityCandidate(
                modelId = "model-a", protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                contextWindowTokens = 100_000 + index, maxOutputTokens = 8_000 + index, source = source,
            )
        }
        priority.indices.forEach { index ->
            val resolved = resolveModelCapability("model-a", ModelParameterProtocol.OPENAI_COMPATIBLE,
                "https://any-proxy.example", candidates.drop(index).reversed())
            assertEquals(priority[index], resolved.contextWindowSource)
            assertEquals(priority[index], resolved.maxOutputSource)
            assertEquals(100_000 + index, resolved.contextWindowTokens)
        }
    }

    @Test
    fun `同名模型在不同端点的能力互不污染`() {
        val candidates = listOf(
            ModelCapabilityCandidate(
                modelId = "shared-model",
                protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                endpointIdentity = "https://first.example/v1",
                contextWindowTokens = 111_000,
                maxOutputTokens = 11_000,
                source = ModelCapabilitySource.LIVE_ENDPOINT,
            ),
            ModelCapabilityCandidate(
                modelId = "shared-model",
                protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                endpointIdentity = "https://second.example/v1",
                contextWindowTokens = 222_000,
                maxOutputTokens = 22_000,
                source = ModelCapabilitySource.LIVE_ENDPOINT,
            ),
        )

        val resolved = resolveModelCapability(
            modelId = "shared-model",
            protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
            apiAddress = "https://first.example/v1/",
            candidates = candidates,
        )

        assertEquals(111_000, resolved.contextWindowTokens)
        assertEquals(11_000, resolved.maxOutputTokens)
    }

    @Test
    fun `用户覆盖值高于端点与社区来源`() {
        val resolved = resolveModelCapability(
            modelId = "example-model",
            protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
            apiAddress = "https://api.example/v1",
            candidates = listOf(
                ModelCapabilityCandidate(
                    modelId = "example-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    endpointIdentity = "https://api.example/v1",
                    contextWindowTokens = 100_000,
                    maxOutputTokens = 8_000,
                    source = ModelCapabilitySource.LIVE_ENDPOINT,
                ),
                ModelCapabilityCandidate(
                    modelId = "example-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    endpointIdentity = "https://api.example/v1",
                    contextWindowTokens = 80_000,
                    maxOutputTokens = 4_000,
                    source = ModelCapabilitySource.USER_OVERRIDE,
                ),
            ),
        )

        assertEquals(80_000, resolved.contextWindowTokens)
        assertEquals(4_000, resolved.maxOutputTokens)
        assertEquals(ModelCapabilitySource.USER_OVERRIDE, resolved.contextWindowSource)
        assertEquals(ModelCapabilitySource.USER_OVERRIDE, resolved.maxOutputSource)
    }

    @Test
    fun `输出上限不小于上下文时使用下一有效来源`() {
        val resolved = resolveModelCapability(
            modelId = "example-model",
            protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
            apiAddress = "https://api.example/v1",
            candidates = listOf(
                ModelCapabilityCandidate(
                    modelId = "example-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    endpointIdentity = "https://api.example/v1",
                    contextWindowTokens = 10_000,
                    maxOutputTokens = 20_000,
                    source = ModelCapabilitySource.LIVE_ENDPOINT,
                ),
                ModelCapabilityCandidate(
                    modelId = "example-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    maxOutputTokens = 8_000,
                    source = ModelCapabilitySource.COMMUNITY_CATALOG,
                ),
            ),
        )

        assertEquals(8_000, resolved.maxOutputTokens)
        assertEquals(ModelCapabilitySource.COMMUNITY_CATALOG, resolved.maxOutputSource)
    }

    @Test
    fun `实时端点值优先于社区目录和家族兜底`() {
        val resolved = resolveModelCapability(
            modelId = "example-model",
            protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
            apiAddress = "https://api.example.com/v1/",
            candidates = listOf(
                ModelCapabilityCandidate(
                    modelId = "example-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    contextWindowTokens = 128_000,
                    maxOutputTokens = 8_192,
                    source = ModelCapabilitySource.COMMUNITY_CATALOG,
                ),
                ModelCapabilityCandidate(
                    modelId = "example-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    endpointIdentity = "https://api.example.com/v1",
                    contextWindowTokens = 256_000,
                    maxOutputTokens = 16_384,
                    source = ModelCapabilitySource.LIVE_ENDPOINT,
                ),
                ModelCapabilityCandidate(
                    modelId = "example-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    contextWindowTokens = 64_000,
                    maxOutputTokens = 4_096,
                    source = ModelCapabilitySource.FAMILY_FALLBACK,
                ),
            ),
        )

        assertEquals(256_000, resolved.contextWindowTokens)
        assertEquals(16_384, resolved.maxOutputTokens)
        assertEquals(ModelCapabilitySource.LIVE_ENDPOINT, resolved.contextWindowSource)
        assertEquals(ModelCapabilitySource.LIVE_ENDPOINT, resolved.maxOutputSource)
    }

    @Test
    fun `每项能力从各自最高优先级来源独立合并`() {
        val resolved = resolveModelCapability(
            modelId = "mixed-model",
            protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
            apiAddress = "https://api.example/v1",
            candidates = listOf(
                ModelCapabilityCandidate(
                    modelId = "mixed-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    endpointIdentity = "https://api.example/v1",
                    contextWindowTokens = 256_000,
                    source = ModelCapabilitySource.LIVE_ENDPOINT,
                ),
                ModelCapabilityCandidate(
                    modelId = "mixed-model",
                    protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                    maxInputTokens = 220_000,
                    maxOutputTokens = 32_000,
                    reasoningEfforts = setOf("high", "max"),
                    supportsReasoning = true,
                    source = ModelCapabilitySource.COMMUNITY_CATALOG,
                ),
            ),
        )

        assertEquals(256_000, resolved.contextWindowTokens)
        assertEquals(220_000, resolved.maxInputTokens)
        assertEquals(32_000, resolved.maxOutputTokens)
        assertEquals(ModelCapabilitySource.LIVE_ENDPOINT, resolved.contextWindowSource)
        assertEquals(ModelCapabilitySource.COMMUNITY_CATALOG, resolved.maxInputSource)
        assertEquals(ModelCapabilitySource.COMMUNITY_CATALOG, resolved.maxOutputSource)
        assertEquals(setOf("high", "max"), resolved.reasoningEfforts)
        assertEquals(ModelCapabilitySource.COMMUNITY_CATALOG, resolved.reasoningSource)
    }

    @Test
    fun `用户只修改最大输出时保留上下文原始来源`() {
        val liveCapability = ResolvedModelCapability(
            modelId = "example-model",
            endpointIdentity = "https://api.example.com/v1",
            contextWindowTokens = 256_000,
            maxOutputTokens = 16_384,
            contextWindowSource = ModelCapabilitySource.LIVE_ENDPOINT,
            maxOutputSource = ModelCapabilitySource.LIVE_ENDPOINT,
            inputModalities = setOf("text"),
            outputModalities = setOf("text"),
            supportsReasoning = true,
        )
        val config = ApiConfig(
            address = "https://api.example.com/v1",
            key = "secret",
            model = "example-model",
            provider = "provider",
            name = "example-model",
            maxTokens = liveCapability.maxOutputTokens,
            modelParameters = ModelParameters(
                maxContextTokens = liveCapability.contextWindowTokens,
                resolvedCapability = liveCapability,
            ),
        )

        val updated = config.withUserTokenLimits(
            ModelTokenLimits(maxOutputTokens = 8_192, maxContextTokens = 256_000)
        )

        assertEquals(ModelCapabilitySource.LIVE_ENDPOINT, updated.modelParameters.resolvedCapability?.contextWindowSource)
        assertEquals(ModelCapabilitySource.USER_OVERRIDE, updated.modelParameters.resolvedCapability?.maxOutputSource)
        assertEquals(8_192, updated.maxTokens)
    }

    @Test
    fun `GPT56实际配置采用pi限制而不被内置值覆盖`() {
        for (model in listOf("gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")) {
            val config = ApiConfig(address = "https://proxy.example", key = "key", model = model, provider = "proxy", name = model)
            val pi = ModelCapabilityCandidate(modelId = model, protocol = ModelParameterProtocol.OPENAI_COMPATIBLE,
                contextWindowTokens = 272_000, maxOutputTokens = 128_000, source = ModelCapabilitySource.PI_CATALOG)
            val community = pi.copy(contextWindowTokens = 1_050_000, source = ModelCapabilitySource.COMMUNITY_CATALOG)
            val result = config.withModelCapabilityDefaults(listOf(community, pi))
            assertEquals(272_000, result.modelParameters.maxContextTokens)
            assertEquals(128_000, result.maxTokens)
            assertEquals(ModelCapabilitySource.PI_CATALOG, result.modelParameters.resolvedCapability?.contextWindowSource)
            val fallback = config.withModelCapabilityDefaults(listOf(community.copy(contextWindowTokens = 200_000)))
            assertEquals(200_000, fallback.modelParameters.maxContextTokens)
            assertEquals(ModelCapabilitySource.COMMUNITY_CATALOG, fallback.modelParameters.resolvedCapability?.contextWindowSource)
        }
    }

    @Test
    fun `旧来源标记可以反序列化但不再作为参数来源`() {
        val legacy = Json.decodeFromString<ModelCapabilityCandidate>("""{"modelId":"model-a","protocol":"OPENAI_COMPATIBLE","contextWindowTokens":1050000,"maxOutputTokens":128000,"source":"OFFICIAL_CATALOG"}""")
        val community = legacy.copy(contextWindowTokens = 200_000, source = ModelCapabilitySource.COMMUNITY_CATALOG)
        val result = resolveModelCapability("model-a", ModelParameterProtocol.OPENAI_COMPATIBLE, "https://proxy.example",
            listOf(legacy, legacy.copy(source = ModelCapabilitySource.LOCAL_CACHE, cachedSource = legacy.source), community))
        assertEquals(200_000, result.contextWindowTokens)
        assertEquals(ModelCapabilitySource.COMMUNITY_CATALOG, result.contextWindowSource)
    }

    @Test
    fun `模型家族兜底使用低优先级安全限制`() {
        val capability = familyModelCapability(
            modelId = "gemini-unknown-preview",
            protocol = ModelParameterProtocol.GEMINI,
        )

        requireNotNull(capability)
        assertEquals(32_768, capability.contextWindowTokens)
        assertEquals(8_192, capability.maxOutputTokens)
        assertEquals(ModelCapabilitySource.FAMILY_FALLBACK, capability.source)
    }
}
