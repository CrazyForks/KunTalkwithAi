import React, { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { RefreshCcw } from 'lucide-react';

interface ConversationSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (settings: { temperature: number; topP: number; maxTokens?: number }) => void;
  initialSettings?: { temperature: number; topP: number; maxTokens?: number };
}

export const ConversationSettingsDialog: React.FC<ConversationSettingsDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialSettings = { temperature: 0.7, topP: 1.0, maxTokens: undefined }
}) => {
  const [settings, setSettings] = useState(initialSettings);
  const [useCustomMaxTokens, setUseCustomMaxTokens] = useState(() => initialSettings.maxTokens != null);
  const [maxTokensInput, setMaxTokensInput] = useState(() => String(initialSettings.maxTokens ?? 64000));

  useEffect(() => {
    if (!isOpen) return;
    setSettings(initialSettings);
    setUseCustomMaxTokens(initialSettings.maxTokens != null);
    setMaxTokensInput(String(initialSettings.maxTokens ?? 64000));
  }, [isOpen, initialSettings.temperature, initialSettings.topP, initialSettings.maxTokens]);

  const handleChange = (key: keyof typeof settings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setSettings({ temperature: 0.7, topP: 1.0, maxTokens: undefined });
    setUseCustomMaxTokens(false);
    setMaxTokensInput('64000');
  };

  const resolveSettingsForConfirm = () => {
    const maxTokens = useCustomMaxTokens ? (Number.parseInt(maxTokensInput, 10) || 64000) : undefined;
    return {
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens,
    };
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="当前对话参数" maxWidth="max-w-lg">
      <div className="space-y-8">
        {/* Temperature */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-gray-300">随机性 (Temperature)</label>
            <span className="text-sm font-mono text-jan-400 bg-jan-400/10 px-2 py-0.5 rounded">{settings.temperature.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={settings.temperature}
            onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-jan-500"
          />
          <p className="text-xs text-gray-500">较高的数值会使输出更加随机，而较低的数值会使其更加集中和确定。</p>
        </div>

        {/* Top P */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-gray-300">核采样 (Top P)</label>
            <span className="text-sm font-mono text-jan-400 bg-jan-400/10 px-2 py-0.5 rounded">{settings.topP.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.01"
            value={settings.topP}
            onChange={(e) => handleChange('topP', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-jan-500"
          />
          <p className="text-xs text-gray-500">类似于随机性，但使用不同的方法。建议修改其中一个，而不是同时修改。</p>
        </div>

        {/* Max Tokens */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-gray-300">最大 Token 数</label>
            <span className="text-sm font-mono text-jan-400 bg-jan-400/10 px-2 py-0.5 rounded">{useCustomMaxTokens ? maxTokensInput : '默认'}</span>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={useCustomMaxTokens}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseCustomMaxTokens(checked);
                setSettings((prev) => ({
                  ...prev,
                  maxTokens: checked ? (Number.parseInt(maxTokensInput, 10) || 64000) : undefined,
                }));
              }}
            />
            启用自定义 Max Tokens
          </label>

          <input
            type="number"
            min="1"
            step="1"
            value={maxTokensInput}
            disabled={!useCustomMaxTokens}
            onChange={(e) => {
              const v = e.target.value;
              if (!/^\d*$/.test(v)) return;
              setMaxTokensInput(v);
              if (useCustomMaxTokens) {
                const parsed = Number.parseInt(v, 10);
                setSettings((prev) => ({ ...prev, maxTokens: parsed || 64000 }));
              }
            }}
            className="w-full bg-gray-900/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 disabled:opacity-50"
          />
          <p className="text-xs text-gray-500">限制模型生成的最大长度。</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 pt-4">
          <button
            onClick={handleReset}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <RefreshCcw size={16} /> 重置
          </button>
          <div className="flex-1"></div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => {
              onConfirm(resolveSettingsForConfirm());
              onClose();
            }}
            className="px-6 py-2 text-sm font-medium bg-jan-600 hover:bg-jan-500 text-white rounded-lg shadow-lg shadow-jan-900/20 transition-all"
          >
            确认修改
          </button>
        </div>
      </div>
    </Dialog>
  );
};