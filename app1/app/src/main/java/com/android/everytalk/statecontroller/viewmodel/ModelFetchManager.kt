package com.android.everytalk.statecontroller.viewmodel

import com.android.everytalk.data.DataClass.ModelCapabilityCandidate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 管理模型列表获取状态
 */
class ModelFetchManager {
    private val _fetchedModels = MutableStateFlow<List<String>>(emptyList())
    val fetchedModels: StateFlow<List<String>> = _fetchedModels.asStateFlow()
    private var fetchedCatalogByModel: Map<String, List<ModelCapabilityCandidate>> = emptyMap()
    
    private val _isRefreshingModels = MutableStateFlow<Set<String>>(emptySet())
    val isRefreshingModels: StateFlow<Set<String>> = _isRefreshingModels.asStateFlow()
    
    fun setFetchedModels(models: List<String>) {
        fetchedCatalogByModel = emptyMap()
        _fetchedModels.value = models
    }

    fun setFetchedCatalog(catalog: List<ModelCapabilityCandidate>) {
        fetchedCatalogByModel = catalog.groupBy { it.modelId.lowercase() }
        _fetchedModels.value = fetchedCatalogByModel.values.map { it.first().modelId }
    }

    fun capabilityFor(modelId: String): ModelCapabilityCandidate? =
        capabilitiesFor(modelId)?.firstOrNull()

    /** 保留所有来源，供添加和刷新按字段优先级解析；null 表示尚未获取这个模型。 */
    fun capabilitiesFor(modelId: String): List<ModelCapabilityCandidate>? =
        fetchedCatalogByModel[modelId.trim().lowercase()]
    
    fun setRefreshingModel(configId: String?) {
        _isRefreshingModels.value = configId?.let(::setOf).orEmpty()
    }
}
