import React, { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Plus, Trash2, Edit2, Key, Server, ChevronDown, ChevronUp, Box, Check, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AddConfigDialog } from './AddConfigDialog';
import { StorageService } from '../../services/StorageService';
import { type ApiConfig } from '../../db';
import { ApiService } from '../../services/ApiService';

interface ImageSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImageSettingsDialog: React.FC<ImageSettingsDialogProps> = ({ isOpen, onClose }) => {
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showAddConfig, setShowAddConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ApiConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiConfig | null>(null);
  const [modelEditTarget, setModelEditTarget] = useState<ApiConfig | null>(null);
  const [newModelId, setNewModelId] = useState('');

  const sortedConfigs = useMemo(() => {
    return [...configs].sort((a, b) => {
      // Built-in configs first
      const aBuiltIn = a.id.startsWith('default_');
      const bBuiltIn = b.id.startsWith('default_');
      
      if (aBuiltIn && !bBuiltIn) return -1;
      if (!aBuiltIn && bBuiltIn) return 1;
      
      // If both are built-in, order by specific priority if needed, or name
      if (aBuiltIn && bBuiltIn) {
          if (a.id === 'default_siliconflow_image') return -1;
          if (b.id === 'default_siliconflow_image') return 1;
      }

      return a.name.localeCompare(b.name);
    });
  }, [configs]);

  const refresh = async () => {
    let list = await StorageService.getAllApiConfigs('IMAGE');
    
    // Delete all configs except 'default_image_config' - we only want ONE default card
    const toDelete = list.filter(c => c.id !== 'default_image_config');
    for (const cfg of toDelete) {
      await StorageService.deleteApiConfig(cfg.id);
    }
    
    // Refresh list after cleanup
    list = await StorageService.getAllApiConfigs('IMAGE');
    
    // Check if we have the default card
    const hasDefaultCard = list.some(c => c.id === 'default_image_config');
    
    // If missing, create the single default config
    if (!hasDefaultCard) {
       const siliconFlowUrl = import.meta.env.VITE_SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1/images/generations';
       let sfBase = siliconFlowUrl;
       if (sfBase.includes('/images/generations')) sfBase = sfBase.replace('/images/generations', '');
       if (sfBase.endsWith('/v1')) sfBase = sfBase.replace('/v1', '');
       if (sfBase.endsWith('/')) sfBase = sfBase.slice(0, -1);

       const siliconModel = import.meta.env.VITE_SILICONFLOW_DEFAULT_MODEL || 'Kwai-Kolors/Kolors';
       
       await StorageService.saveApiConfig({
           id: 'default_image_config',
           provider: 'SystemDefault',
           name: '默认配置',
           baseUrl: sfBase,
           apiKey: import.meta.env.VITE_SILICONFLOW_API_KEY || '',
           models: [
               'Z-image-turbo-modal',
               'qwen-image-edit-modal',
               siliconModel
           ],
           channel: 'OpenAI兼容',
           modality: 'IMAGE',
           isDefault: true
       });

       list = await StorageService.getAllApiConfigs('IMAGE');
    }
    
    setConfigs(list);

    const keepSelected = selectedId && list.some(c => c.id === selectedId);
    if (keepSelected) {
      setSelectedId(selectedId);
      return;
    }

    const active = list.find(c => c.isDefault);
    const def = active || list.find(c => c.id === 'default_siliconflow_image');
    setSelectedId(def?.id ?? (list[0]?.id ?? null));
  };

  useEffect(() => {
    if (!isOpen) return;
    refresh();
  }, [isOpen]);

  const handleSelect = async (cfg: ApiConfig) => {
    setSelectedId(cfg.id);
    await StorageService.setDefaultApiConfig(cfg.id, 'IMAGE');
    await refresh();
  };

  const handleFetchModelsForConfig = async (config: ApiConfig) => {
    try {
      const models = await ApiService.fetchModels({
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        channel: config.channel,
      });
      if (models.length > 0) {
        await StorageService.saveApiConfig({ ...config, models });
        await refresh();
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to fetch models for image config', config.name, e);
      return false;
    }
  };

  const handleAddConfig = async (newConfig: { provider: string; address: string; key: string; channel: string }) => {
    const id = `image_${Date.now()}`;
    const cfg: ApiConfig = {
      id,
      provider: newConfig.provider,
      name: newConfig.provider,
      baseUrl: newConfig.address,
      apiKey: newConfig.key,
      models: [],
      channel: newConfig.channel as ApiConfig['channel'],
      isDefault: false,
      modality: 'IMAGE',
    };
    await StorageService.saveApiConfig(cfg);
    await refresh();
  };

  const handleEditConfirm = async (newConfig: { provider: string; address: string; key: string; channel: string }) => {
    if (!editingConfig) return;
    const next: ApiConfig = {
      ...editingConfig,
      provider: newConfig.provider,
      name: newConfig.provider,
      baseUrl: newConfig.address,
      apiKey: newConfig.key,
      channel: newConfig.channel as ApiConfig['channel'],
    };
    await StorageService.saveApiConfig(next);
    setEditingConfig(null);
    await refresh();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const wasDefault = !!deleteTarget.isDefault;
    await StorageService.deleteApiConfig(deleteTarget.id);
    setDeleteTarget(null);
    const list = await StorageService.getAllApiConfigs('IMAGE');
    if (wasDefault && list.length > 0) {
      await StorageService.setDefaultApiConfig(list[0].id, 'IMAGE');
    }
    await refresh();
  };

  const handleRemoveModel = async (cfg: ApiConfig, model: string) => {
    const nextModels = cfg.models.filter(m => m !== model);
    await StorageService.saveApiConfig({ ...cfg, models: nextModels });
    await refresh();
  };

  const handleAddModel = async () => {
    if (!modelEditTarget) return;
    const v = newModelId.trim();
    if (!v) return;
    const nextModels = modelEditTarget.models.includes(v) ? modelEditTarget.models : [...modelEditTarget.models, v];
    await StorageService.saveApiConfig({ ...modelEditTarget, models: nextModels });
    setModelEditTarget(null);
    setNewModelId('');
    await refresh();
  };

  return (
    <>
      <Dialog isOpen={isOpen} onClose={onClose} title="图像生成配置" maxWidth="max-w-3xl">
        <div className="flex flex-col h-[650px] bg-[#09090b] text-zinc-100 relative">
          {/* Toolbar & Config List Container */}
          <div className="flex-1 overflow-y-auto px-6 custom-scrollbar pb-6 pt-6">
            {/* Action Bar */}
            <div className="flex items-center justify-between gap-4 mb-6">
              <button
                onClick={() => setShowAddConfig(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/30 text-purple-500 hover:text-purple-400 py-3 rounded-xl transition-all font-bold active:scale-[0.98] group shadow-sm"
              >
                <div className="p-0.5 rounded-full bg-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
                  <Plus size={18} strokeWidth={2.5} />
                </div>
                <span>添加新配置</span>
              </button>
            </div>

            <div className="space-y-4">
              {sortedConfigs.map((config) => (
                <ConfigCard
                  key={config.id}
                  config={config}
                  isSelected={selectedId === config.id}
                  onSelect={() => handleSelect(config)}
                  onEdit={() => setEditingConfig(config)}
                  onDelete={() => setDeleteTarget(config)}
                  onAddModel={() => {
                    setModelEditTarget(config);
                    setNewModelId('');
                  }}
                  onRemoveModel={(model) => handleRemoveModel(config, model)}
                  onFetchModels={() => handleFetchModelsForConfig(config)}
                  isBuiltIn={config.id.startsWith('default_')}
                />
              ))}
              {sortedConfigs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-[200px] text-zinc-500 border-2 border-dashed border-zinc-800 rounded-2xl bg-zinc-900/30 mt-4">
                  <Server size={48} className="mb-4 opacity-50" />
                  <p>暂无图像生成配置</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </Dialog>

      <AddConfigDialog
        isOpen={showAddConfig}
        onClose={() => setShowAddConfig(false)}
        onConfirm={handleAddConfig}
      />

      <AddConfigDialog
        isOpen={!!editingConfig}
        onClose={() => setEditingConfig(null)}
        onConfirm={handleEditConfirm}
        initialConfig={editingConfig ? {
          provider: editingConfig.provider,
          address: editingConfig.baseUrl,
          key: editingConfig.apiKey,
          channel: editingConfig.channel ?? 'OpenAI兼容',
        } : undefined}
        title="编辑配置"
        confirmText="保存"
      />

      <Dialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="删除配置"
        maxWidth="max-w-sm"
      >
        <div className="p-1">
          <p className="text-gray-300 mb-6">确定要删除该配置吗？此操作无法撤销。</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-900/20"
            >
              删除
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={!!modelEditTarget}
        onClose={() => setModelEditTarget(null)}
        title="添加模型"
        maxWidth="max-w-sm"
      >
        <div className="p-1">
          <input
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            placeholder="例如：gpt-image-1"
            className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 mb-6"
            autoFocus
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setModelEditTarget(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
            >
              取消
            </button>
            <button
              onClick={handleAddModel}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20"
            >
              添加
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
};

interface ConfigCardProps {
  config: ApiConfig;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddModel: () => void;
  onRemoveModel: (model: string) => void;
  onFetchModels: () => Promise<boolean>;
  isBuiltIn?: boolean;
}

const ConfigCard = ({ config, isSelected, onSelect, onEdit, onDelete, onAddModel, onRemoveModel, onFetchModels, isBuiltIn }: ConfigCardProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  const handleFetch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFetching(true);
    await onFetchModels();
    setIsFetching(false);
  };

  return (
    <div
      onClick={onSelect}
      className={`relative overflow-hidden transition-all duration-200 group cursor-pointer border rounded-2xl ${isSelected ? 'bg-purple-950/20 border-purple-500/50 ring-1 ring-purple-500/30' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}
    >
      {/* Main Content */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl transition-colors ${isSelected ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-800 text-zinc-400'}`}>
              {isBuiltIn ? <Box size={20} /> : <Server size={20} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className={`text-base font-bold transition-colors ${isSelected ? 'text-purple-100' : 'text-zinc-100'}`}>
                  {config.name}
                </h3>
                {isBuiltIn && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-600 text-white px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(168,85,247,0.4)]">
                    Default
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {!isBuiltIn ? (
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border transition-colors ${isSelected ? 'bg-purple-950/30 border-purple-500/20' : 'bg-zinc-950/50 border-zinc-800/50'}`}>
                    <Key size={10} className={`${isSelected ? 'text-purple-400/70' : 'text-zinc-500'}`} />
                    <span className={`text-xs font-mono ${isSelected ? 'text-purple-200/70' : 'text-zinc-400'}`}>{config.apiKey}</span>
                  </div>
                ) : (
                  <div className={`flex items-center gap-1.5 text-xs ${isSelected ? 'text-purple-300/80' : 'text-zinc-500'}`}>
                    <Check size={10} />
                    <span>内置模型</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!isBuiltIn && (
              <>
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-lg transition-colors" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                  <Edit2 size={16} />
                </button>
                <button className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                  <Trash2 size={16} />
                </button>
              </>
            )}
            {/* Checkmark for selection indication */}
            {isSelected && (
              <div className="p-2 text-purple-500">
                <Check size={20} strokeWidth={2.5} />
              </div>
            )}
          </div>
        </div>

        {/* Models Grid */}
        <div 
          className={`rounded-xl border p-3 transition-colors ${isSelected ? 'bg-purple-950/30 border-purple-500/20' : 'bg-zinc-950/50 border-zinc-800/50'}`}
          onClick={(e) => e.stopPropagation()} 
        >
          <div 
            className="flex items-center justify-between mb-2 cursor-pointer select-none"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${isSelected ? 'text-purple-400/60' : 'text-zinc-500'}`}>
              <Box size={12} />
              Models ({config.models.length})
            </div>
            <div className="flex items-center gap-2">
               <button
                 className={`p-1 transition-colors ${isSelected ? 'text-purple-400/60 hover:text-purple-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                 title="刷新模型列表"
                 onClick={handleFetch}
                 disabled={isFetching}
               >
                 <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
               </button>
               {!isBuiltIn && (
                <button className={`p-1 transition-colors ${isSelected ? 'text-purple-400/60 hover:text-purple-300' : 'text-zinc-500 hover:text-zinc-300'}`} title="添加模型" onClick={(e) => { e.stopPropagation(); onAddModel(); }}>
                  <Plus size={14} />
                </button>
              )}
              <button className={`transition-colors ${isSelected ? 'text-purple-400/60 hover:text-purple-300' : 'text-zinc-600 hover:text-zinc-400'}`}>
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-2 pt-1">
                  {config.models.map((model, idx) => (
                    <div
                      key={idx}
                      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm transition-all ${isSelected ? 'bg-purple-900/30 border-purple-500/20 text-purple-100 hover:border-purple-500/40' : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600'}`}
                    >
                      <span className="font-mono text-xs">{model}</span>
                      {!isBuiltIn && (
                        <button className={`opacity-0 group-hover:opacity-100 p-0.5 rounded-full transition-all ${isSelected ? 'hover:bg-purple-800 text-purple-400' : 'hover:bg-zinc-700 text-zinc-500 hover:text-red-400'}`} onClick={(e) => { e.stopPropagation(); onRemoveModel(model); }}>
                          <XIcon size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                  {config.models.length === 0 && (
                    <div className={`w-full text-center py-2 text-xs italic ${isSelected ? 'text-purple-500/50' : 'text-zinc-600'}`}>No models configured</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const XIcon = ({ size }: { size: number }) => (
    <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
    >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
    </svg>
);