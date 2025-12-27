import React, { useState, useRef } from 'react';
import { Dialog } from '../ui/Dialog';
import { Upload, Download, CheckSquare, Square, AlertTriangle } from 'lucide-react';

interface ImportExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (file: File) => void;
  onExport: (includeHistory: boolean) => void;
}

export const ImportExportDialog: React.FC<ImportExportDialogProps> = ({ isOpen, onClose, onImport, onExport }) => {
  const [includeHistory, setIncludeHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
      fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          onImport(file);
          onClose();
      }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="配置管理" maxWidth="max-w-md">
      <div className="space-y-6 text-zinc-100">
        
        {/* Export Section */}
        <div className="space-y-4">
            <button
                onClick={() => {
                    onExport(includeHistory);
                    onClose();
                }}
                className="w-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 rounded-2xl p-5 flex items-center justify-between transition-all group"
            >
                <div className="text-left">
                    <h3 className="font-bold text-zinc-100 group-hover:text-emerald-400 transition-colors">导出配置</h3>
                    <p className="text-xs text-zinc-500 mt-1">保存当前配置到文件</p>
                </div>
                <div className="bg-zinc-800 p-3 rounded-full group-hover:bg-emerald-500/10 transition-colors">
                    <Download size={24} className="text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                </div>
            </button>

            {/* Include History Checkbox */}
            <div 
                className="flex items-center gap-3 px-4 py-3 bg-zinc-900/50 rounded-xl cursor-pointer select-none hover:bg-zinc-900 transition-colors"
                onClick={() => setIncludeHistory(!includeHistory)}
            >
                <div className={`transition-colors ${includeHistory ? 'text-emerald-500' : 'text-zinc-600'}`}>
                    {includeHistory ? <CheckSquare size={20} /> : <Square size={20} />}
                </div>
                <div>
                    <div className="text-sm font-medium text-zinc-300">包含聊天历史</div>
                    <div className="text-xs text-zinc-500">将同时导出您的对话记录</div>
                </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300/80 leading-relaxed">
                    导出文件包含 API 密钥等敏感信息，请妥善保管。
                </p>
            </div>
        </div>

        <div className="h-px bg-zinc-800 w-full"></div>

        {/* Import Section */}
        <div>
            <button
                onClick={handleImportClick}
                className="w-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 rounded-2xl p-5 flex items-center justify-between transition-all group"
            >
                <div className="text-left">
                    <h3 className="font-bold text-zinc-100 group-hover:text-blue-400 transition-colors">导入配置</h3>
                    <p className="text-xs text-zinc-500 mt-1">从文件加载配置</p>
                </div>
                <div className="bg-zinc-800 p-3 rounded-full group-hover:bg-blue-500/10 transition-colors">
                    <Upload size={24} className="text-zinc-400 group-hover:text-blue-400 transition-colors" />
                </div>
            </button>
            <p className="text-center text-xs text-zinc-600 mt-4">
                导出的配置文件可在其他设备导入使用
            </p>
            <input 
                type="file" 
                ref={fileInputRef} 
                accept=".json" 
                className="hidden" 
                onChange={handleFileChange} 
            />
        </div>

      </div>
    </Dialog>
  );
};