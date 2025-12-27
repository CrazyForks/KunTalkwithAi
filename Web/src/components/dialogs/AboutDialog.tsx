import React from 'react';
import { Dialog } from '../ui/Dialog';

interface AboutDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title="关于 EveryTalk"
            maxWidth="max-w-md"
        >
            <div className="p-4 space-y-4">
                <div className="flex flex-col items-center mb-6">
                    <img src="https://beone.kuz7.com/p/7PTke6YARhAdF5TEfwYbV21YaFuuY0bUV9RondIPds0" alt="EveryTalk Logo" className="w-20 h-20 mb-4 rounded-xl" />
                    <h2 className="text-xl font-bold text-white">EveryTalk</h2>
                    <p className="text-gray-400 text-sm">Web Client v1.0.0</p>
                </div>

                <div className="space-y-4 text-sm text-gray-300">
                    <p>
                        EveryTalk 是一个跨平台的 AI 聊天客户端，支持多种大模型，并提供 Android 和 Web 端的统一体验。
                    </p>
                    
                    <div className="bg-white/5 rounded-lg p-3 space-y-2">
                        <div className="flex justify-between">
                            <span className="text-gray-500">版本</span>
                            <span className="text-white">1.0.0</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">平台</span>
                            <span className="text-white">Web</span>
                        </div>
                    </div>

                    <div className="pt-4 text-center text-xs text-gray-600">
                        &copy; 2025 EveryTalk Team. All rights reserved.
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </Dialog>
    );
};