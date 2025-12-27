import React, { useState, useEffect } from 'react';
import { Dialog } from '../ui/Dialog';
import { Save } from 'lucide-react';

interface SystemPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  isEngaged: boolean;
  onSave: (prompt: string, engaged: boolean) => void;
}

export const SystemPromptDialog: React.FC<SystemPromptDialogProps> = ({
  isOpen,
  onClose,
  systemPrompt,
  isEngaged,
  onSave
}) => {
  const [prompt, setPrompt] = useState(systemPrompt);
  const [engaged, setEngaged] = useState(isEngaged);

  useEffect(() => {
    if (isOpen) {
        setPrompt(systemPrompt);
        setEngaged(isEngaged);
    }
  }, [isOpen, systemPrompt, isEngaged]);

  const handleSave = () => {
    onSave(prompt, engaged);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="系统提示词 (System Prompt)" maxWidth="max-w-2xl">
      <div className="space-y-6">
        <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/10">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-gray-200">启用系统提示词</h3>
            <p className="text-xs text-gray-500">开启后，每次对话都会携带此提示词，可能增加Token消耗</p>
          </div>
          <button
            onClick={() => setEngaged(!engaged)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              engaged ? 'bg-jan-600' : 'bg-gray-700'
            }`}
          >
            <span
              className={`${
                engaged ? 'translate-x-6' : 'translate-x-1'
              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
            />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">提示词内容</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入系统提示词，例如：你是一个专业的翻译助手..."
            className="w-full h-64 bg-black/20 border border-white/10 rounded-xl p-4 text-sm text-gray-200 focus:border-jan-500/50 focus:ring-1 focus:ring-jan-500/50 outline-none resize-none"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 text-sm font-medium bg-jan-600 hover:bg-jan-500 text-white rounded-lg shadow-lg shadow-jan-900/20 transition-all flex items-center gap-2"
          >
            <Save size={16} />
            保存设置
          </button>
        </div>
      </div>
    </Dialog>
  );
};