import React, { useCallback, useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Bot, Check, Server } from 'lucide-react';
import { StorageService } from '../../services/StorageService';
import { type ApiConfig } from '../../db';

interface ModelSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void | Promise<void>;
  currentModelId?: string;
  modality?: 'TEXT' | 'IMAGE';
}

const PinIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="17" x2="12" y2="22"></line>
        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
    </svg>
);

export const ModelSelectionDialog: React.FC<ModelSelectionDialogProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentModelId = 'gpt-4o',
  modality = 'TEXT'
}) => {
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  
  const loadConfigs = useCallback(async () => {
      const configs = await StorageService.getAllApiConfigs(modality);
      setApiConfigs(configs);
      
      const defaultConfig = configs.find(c => c.isDefault);
      if (defaultConfig) {
          setSelectedConfigId(defaultConfig.id);
      } else if (configs.length > 0) {
          setSelectedConfigId(configs[0].id);
      }
  }, [modality]);

  useEffect(() => {
      if (isOpen) {
          loadConfigs();
      }
  }, [isOpen, loadConfigs]);

  const currentConfig = apiConfigs.find(c => c.id === selectedConfigId);
  const currentModels = currentConfig?.models || [];

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="切换模型" maxWidth="max-w-3xl">
      <div className="flex h-[500px] bg-[#09090b] text-zinc-100 rounded-b-2xl overflow-hidden">
        
        {/* Left Sidebar: Providers */}
        <div className="w-48 bg-zinc-900/50 border-r border-zinc-800 p-2 space-y-1 overflow-y-auto custom-scrollbar">
            <div className="text-xs font-semibold text-zinc-500 px-3 py-2 uppercase tracking-wider">
                平台 / 渠道
            </div>
            {apiConfigs.map(config => (
                <button
                    key={config.id}
                    onClick={() => setSelectedConfigId(config.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        selectedConfigId === config.id
                            ? 'bg-zinc-800 text-white shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}
                >
                    <div className={selectedConfigId === config.id ? 'text-emerald-400' : 'text-zinc-500'}>
                        {config.isDefault ? <PinIcon /> : <Server size={18} />}
                    </div>
                    <span className="truncate">{config.name || config.provider}</span>
                </button>
            ))}
        </div>

        {/* Right Content: Models */}
        <div className="flex-1 flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/30">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {currentConfig?.name || currentConfig?.provider || '选择配置'}
                    <span className="text-sm font-normal text-zinc-500 ml-2 bg-zinc-800 px-2 py-0.5 rounded-full">
                        {currentModels.length} 个模型
                    </span>
                </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                {currentModels.map((model) => {
                    const isSelected = currentModelId === model;
                    return (
                        <button
                            key={model}
                            onClick={async () => {
                                // Ensure we select the config too if needed
                                if (currentConfig && !currentConfig.isDefault) {
                                    await StorageService.setDefaultApiConfig(currentConfig.id, modality);
                                }
                                await onSelect(model);
                                onClose();
                            }}
                            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all group ${
                                isSelected
                                    ? 'bg-emerald-950/20 border-emerald-500/30 shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]'
                                    : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50'
                            }`}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`p-2 rounded-lg ${isSelected ? 'bg-emerald-500/20' : 'bg-zinc-800 group-hover:bg-zinc-700 transition-colors'}`}>
                                    <Bot size={18} />
                                </div>
                                <div className="text-left">
                                    <div className={`font-medium ${isSelected ? 'text-emerald-100' : 'text-zinc-200'}`}>
                                        {model}
                                    </div>
                                </div>
                            </div>
                            {isSelected && <Check size={18} className="text-emerald-500" />}
                        </button>
                    );
                })}
                
                {currentModels.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                        <p>该平台下暂无模型</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </Dialog>
  );
};