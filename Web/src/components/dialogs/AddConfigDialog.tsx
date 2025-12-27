import React, { useState, useEffect } from 'react';
import { Dialog } from '../ui/Dialog';
import { Server, Link, Key, Check, Wrench, RefreshCw, Loader2, ChevronsUpDown, Eye, EyeOff } from 'lucide-react';
import { ApiService } from '../../services/ApiService';

interface AddConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: { provider: string; address: string; key: string; channel: string; toolsJson?: string; models?: string[] }) => void;
  initialConfig?: { provider: string; address: string; key: string; channel: string; toolsJson?: string };
  title?: string;
  confirmText?: string;
}

const DEFAULT_PROVIDERS = [
  { name: 'OpenAI', address: 'https://api.openai.com/v1', channel: 'OpenAI兼容' },
  { name: 'SiliconFlow', address: 'https://api.siliconflow.cn/v1', channel: 'OpenAI兼容' },
  { name: 'Google', address: 'https://generativelanguage.googleapis.com', channel: 'Gemini' },
  { name: 'Anthropic', address: 'https://api.anthropic.com/v1', channel: 'OpenAI兼容' },
  { name: 'OpenRouter', address: 'https://openrouter.ai/api/v1', channel: 'OpenAI兼容' },
  { name: 'DeepSeek', address: 'https://api.deepseek.com', channel: 'OpenAI兼容' },
  { name: 'Seedream', address: 'https://ark.cn-beijing.volces.com/api/v3', channel: 'OpenAI兼容' },
  { name: 'Modal', address: 'https://api.modal.com', channel: 'OpenAI兼容' },
];

export const AddConfigDialog: React.FC<AddConfigDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialConfig,
  title = '添加配置',
  confirmText = '确定添加',
}) => {
  const [provider, setProvider] = useState(initialConfig?.provider || '');
  const [address, setAddress] = useState(initialConfig?.address || '');
  const [apiKey, setApiKey] = useState(initialConfig?.key || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [channel, setChannel] = useState(initialConfig?.channel || 'OpenAI兼容');
  const [toolsJson, setToolsJson] = useState(initialConfig?.toolsJson || '');
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [showModelList, setShowModelList] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  const [showCustomProvider, setShowCustomProvider] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialConfig) {
      setProvider(initialConfig.provider);
      setAddress(initialConfig.address);
      setApiKey(initialConfig.key);
      setChannel(initialConfig.channel);
      setToolsJson(initialConfig.toolsJson || '');
      const isPreset = DEFAULT_PROVIDERS.some(p => p.name === initialConfig.provider);
      setShowCustomProvider(!isPreset);
    } else {
      setProvider('');
      setAddress('');
      setApiKey('');
      setChannel('OpenAI兼容');
      setToolsJson('');
      setShowCustomProvider(false);
    }
    setFetchedModels([]);
    setSelectedModels(new Set());
    setFetchError('');
    setIsFetching(false);
    setShowModelList(false);
    setModelSearch('');
    setShowApiKey(false);
  }, [isOpen, initialConfig]);

  // Auto-fill address and channel based on provider selection
  const handleProviderSelect = (prov: typeof DEFAULT_PROVIDERS[0]) => {
    setProvider(prov.name);
    setAddress(prov.address);
    setChannel(prov.channel);
    setShowCustomProvider(false);
  };

  const handleCustomClick = () => {
    setShowCustomProvider(true);
    setProvider(''); // Clear provider when switching to custom
    setAddress('');
  };

  const handleFetchModels = async () => {
    if (!address || !apiKey) {
      setFetchError('请先填写 API 地址和密钥');
      return;
    }
    setIsFetching(true);
    setFetchError('');
    try {
      const models = await ApiService.fetchModels({
        provider,
        baseUrl: address,
        apiKey,
        channel: channel as any
      });
      if (models.length === 0) {
        setFetchError('未获取到模型列表');
      } else {
        setFetchedModels(models);
        setSelectedModels(new Set());
        setShowModelList(true);
        setModelSearch('');
        setFetchError(`成功获取 ${models.length} 个模型`);
      }
    } catch (e: any) {
      setFetchError(e.message || '获取失败');
    } finally {
      setIsFetching(false);
    }
  };

  const toggleModel = (model: string) => {
    const next = new Set(selectedModels);
    if (next.has(model)) {
      next.delete(model);
    } else {
      next.add(model);
    }
    setSelectedModels(next);
  };

  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const visibleModels = normalizedModelSearch
    ? fetchedModels.filter(m => m.toLowerCase().includes(normalizedModelSearch))
    : fetchedModels;

  const allVisibleSelected = visibleModels.length > 0 && visibleModels.every(m => selectedModels.has(m));

  const toggleAll = () => {
    const next = new Set(selectedModels);
    if (allVisibleSelected) {
      for (const m of visibleModels) next.delete(m);
    } else {
      for (const m of visibleModels) next.add(m);
    }
    setSelectedModels(next);
  };

  const handleSubmit = () => {
    if (provider && address && apiKey) {
      onConfirm({
        provider,
        address,
        key: apiKey,
        channel,
        toolsJson: toolsJson.trim() || undefined,
        models: fetchedModels.length > 0 ? Array.from(selectedModels) : undefined
      });
      onClose();

      // Reset form
      setProvider('');
      setAddress('');
      setApiKey('');
      setChannel('OpenAI兼容');
      setToolsJson('');
      setFetchedModels([]);
      setSelectedModels(new Set());
      setFetchError('');
      setShowModelList(false);
      setModelSearch('');
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-xl">
      <div className="space-y-6 text-zinc-100">
        {/* Provider Selection */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-zinc-400">模型平台</label>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_PROVIDERS.map((p) => (
              <button
                key={p.name}
                onClick={() => handleProviderSelect(p)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                  !showCustomProvider && provider === p.name
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                {p.name}
              </button>
            ))}
            <button
              onClick={handleCustomClick}
              className={`px-3 py-1.5 rounded-lg text-sm border border-dashed transition-all ${
                showCustomProvider
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              自定义
            </button>
          </div>
          {showCustomProvider && (
            <div className="relative">
              <Server size={16} className="absolute left-3 top-3 text-zinc-500" />
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="请输入平台名称"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
          )}
        </div>

        {/* Channel Selection */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-zinc-400">渠道</label>
          <div className="flex gap-4">
            {['OpenAI兼容', 'Gemini'].map(c => (
              <label key={c} className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${channel === c ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-600 group-hover:border-zinc-500'}`}>
                  {channel === c && <Check size={10} className="text-black" />}
                </div>
                <span className={`text-sm ${channel === c ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-300'}`}>{c}</span>
                <input type="radio" className="hidden" checked={channel === c} onChange={() => setChannel(c)} />
              </label>
            ))}
          </div>
        </div>

        {/* API Address */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-zinc-400">API 接口地址</label>
          <div className="relative">
            <Link size={16} className="absolute left-3 top-3 text-zinc-500" />
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
            />
          </div>
        </div>

        {/* API Key */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-zinc-400">API 密钥</label>
          <div className="relative">
            <Key size={16} className="absolute left-3 top-3 text-zinc-500" />
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-10 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(v => !v)}
              className="absolute right-3 top-2.5 p-1 text-zinc-500 hover:text-zinc-300"
              title={showApiKey ? '隐藏' : '显示'}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Fetch Models */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              {isFetching ? (
                <span className="flex items-center gap-2 text-emerald-500">
                  <Loader2 size={14} className="animate-spin" />
                  正在获取模型列表...
                </span>
              ) : fetchError ? (
                <span className={`flex items-center gap-2 ${fetchError.includes('成功') ? 'text-emerald-500' : 'text-red-400'}`}>
                  {fetchError.includes('成功') ? <Check size={14} /> : null}
                  {fetchError}
                </span>
              ) : (
                <span className="text-zinc-500">点击右侧按钮测试连接并获取模型</span>
              )}
            </div>
            <button
              onClick={handleFetchModels}
              disabled={!address || !apiKey || isFetching}
              type="button"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                !address || !apiKey || isFetching
                  ? 'bg-zinc-800/50 border-zinc-800 text-zinc-600 cursor-not-allowed'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-white hover:border-emerald-500/50 hover:bg-zinc-700'
              }`}
            >
              <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
              获取模型列表
            </button>
          </div>

          {fetchedModels.length > 0 && (
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 overflow-hidden">
              <button
                onClick={() => setShowModelList(!showModelList)}
                className="w-full px-4 py-2 flex items-center justify-between text-xs font-medium text-zinc-400 hover:bg-zinc-800/50 transition-colors"
              >
                <span>已选择 {selectedModels.size} / {fetchedModels.length} 个模型</span>
                <ChevronsUpDown size={14} />
              </button>

              {showModelList && (
                <div className="max-h-[160px] overflow-y-auto p-2 border-t border-zinc-800 custom-scrollbar grid grid-cols-2 gap-1">
                  <div className="col-span-2 mb-1">
                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="搜索模型..."
                      className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <label className="flex items-center gap-2 p-2 rounded hover:bg-zinc-800/50 cursor-pointer col-span-2 border-b border-zinc-800/50 mb-1">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="text-xs text-zinc-300 font-bold">全选 / 取消全选</span>
                  </label>
                  {visibleModels.map(model => (
                    <label key={model} className="flex items-center gap-2 p-2 rounded hover:bg-zinc-800/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedModels.has(model)}
                        onChange={() => toggleModel(model)}
                        className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                      />
                      <span className="text-xs text-zinc-400 truncate" title={model}>{model}</span>
                    </label>
                  ))}
                  {visibleModels.length === 0 && (
                    <div className="col-span-2 p-3 text-center text-xs text-zinc-500">没有匹配的模型</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tools JSON (Optional) */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-zinc-400">自定义工具 (JSON)</label>
          <div className="relative">
            <Wrench size={16} className="absolute left-3 top-3 text-zinc-500" />
            <textarea
              value={toolsJson}
              onChange={(e) => setToolsJson(e.target.value)}
              placeholder='[{"type": "function", "function": { ... }}]'
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors font-mono min-h-[80px]"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all font-medium"
          >
            取消
          </button>
          <button 
            onClick={handleSubmit}
            disabled={!provider || !address || !apiKey}
            className={`flex-1 py-3 rounded-xl font-bold transition-all ${
              provider && address && apiKey
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            {confirmText}
          </button>
        </div>

      </div>
    </Dialog>
  );
};