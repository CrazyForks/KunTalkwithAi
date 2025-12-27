import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog } from '../ui/Dialog';
import { syncService } from '../../services/SyncService';
import { CheckCircle, Smartphone, AlertCircle } from 'lucide-react';

interface ConnectMobileDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ConnectMobileDialog: React.FC<ConnectMobileDialogProps> = ({ isOpen, onClose }) => {
    const [connectionUrl, setConnectionUrl] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [statusText, setStatusText] = useState('请使用 EveryTalk APP 扫描二维码连接');

    useEffect(() => {
        if (isOpen) {
            // Initialize or ensure connection
            if (!syncService.getSessionId()) {
                syncService.connect();
            }
            
            setConnectionUrl(syncService.getLinkUrl());
            
            const handleConnected = () => {
                 setStatusText("等待手机端连接...");
            };

            const handlePeerConnected = () => {
                setIsConnected(true);
                setStatusText("已成功连接到手机端");
                // Auto close after 2 seconds
                setTimeout(() => {
                    onClose();
                }, 2000);
            };

            const handleDisconnected = () => {
                setIsConnected(false);
                setStatusText("连接已断开");
            };
            
            // Listeners
            syncService.on('connected', handleConnected);
            syncService.on('client_count', (count) => {
                if (count > 1) {
                    handlePeerConnected();
                }
            });
            syncService.on('peer_disconnected', handleDisconnected);

            return () => {
                syncService.off('connected', handleConnected);
                syncService.off('client_count', handlePeerConnected); // Simplified logic
                syncService.off('peer_disconnected', handleDisconnected);
            };
        }
    }, [isOpen, onClose]);

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title="连接到手机端"
            maxWidth="max-w-md"
        >
            <div className="flex flex-col items-center justify-center p-6 space-y-6">
                
                {isConnected ? (
                     <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
                            <CheckCircle size={40} className="text-green-500" />
                        </div>
                        <h3 className="text-xl font-semibold text-white mb-2">连接成功</h3>
                        <p className="text-gray-400 text-center">正在同步数据...</p>
                    </div>
                ) : (
                    <>
                        <div className="bg-white p-4 rounded-xl shadow-lg relative group">
                            <div className="absolute inset-0 bg-jan-500/20 blur-xl rounded-xl group-hover:bg-jan-500/30 transition-all duration-500"></div>
                            <QRCodeSVG
                                value={connectionUrl}
                                size={200}
                                level="H"
                                includeMargin={false}
                                className="relative z-10"
                            />
                            {/* Logo Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                                <div className="w-10 h-10 bg-white rounded-lg shadow-md flex items-center justify-center p-1">
                                    <Smartphone size={24} className="text-black" />
                                </div>
                            </div>
                        </div>

                        <div className="text-center space-y-2">
                             <p className={`text-sm font-medium ${isConnected ? 'text-green-400' : 'text-gray-300'}`}>
                                {statusText}
                            </p>
                            <p className="text-xs text-gray-500">
                                打开 EveryTalk APP {'->'} 侧边栏 {'->'} Web端同步
                            </p>
                        </div>
                    </>
                )}

                <div className="w-full bg-white/5 rounded-lg p-3 flex items-start space-x-3">
                    <AlertCircle size={16} className="text-jan-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                        <p className="text-xs text-gray-300">
                            连接后，您可以在电脑上继续手机端的对话，并实时同步生成内容。
                        </p>
                    </div>
                </div>
            </div>
        </Dialog>
    );
};