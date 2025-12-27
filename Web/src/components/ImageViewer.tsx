import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Edit2, Brush, Undo, Redo, ChevronRight } from 'lucide-react';

interface ImageViewerProps {
    isOpen: boolean;
    onClose: () => void;
    imageUrl: string | null;
    onUseAsReference?: (imageUrl: string) => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ isOpen, onClose, imageUrl, onUseAsReference }) => {
    const [scale, setScale] = useState(1);
    const [isBrushMode, setIsBrushMode] = useState(false);

    // Brush Editor State
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [history, setHistory] = useState<ImageData[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [brushColor, setBrushColor] = useState('#82A8FF'); // Matches Android approx
    const [brushSize, setBrushSize] = useState(24); // Matches Android approx

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            setScale(1);
            setIsBrushMode(false);
            setHistory([]);
            setHistoryIndex(-1);
        }
    }, [isOpen]);

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!imageUrl) return;
        
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `image-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error('Download failed', err);
            const a = document.createElement('a');
            a.href = imageUrl;
            a.download = `image-${Date.now()}.png`;
            a.target = '_blank';
            a.click();
        }
    };

    const handleUseAsRef = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (imageUrl && onUseAsReference) {
            onUseAsReference(imageUrl);
            onClose();
        }
    };

    const handleEnterBrushMode = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsBrushMode(true);
    };

    // Brush Logic
    const initCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas || !imageUrl) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imageUrl;
        img.onload = () => {
            // Set canvas dimensions to image natural size or scaled fit? 
            // Better to fit to screen but draw high res? 
            // For simplicity in this overlay, let's match display size but keep aspect ratio
            // Actually, we should draw on the full res image.
            
            // To ensure it fits on screen, we need to calculate aspect ratio
            const maxWidth = window.innerWidth * 0.9;
            const maxHeight = window.innerHeight * 0.8;
            
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            
            const scale = Math.min(maxWidth / w, maxHeight / h, 1);
            
            canvas.width = w;
            canvas.height = h;
            
            // Style width/height for display
            canvas.style.width = `${w * scale}px`;
            canvas.style.height = `${h * scale}px`;

            ctx.drawImage(img, 0, 0);
            saveHistory();
        };
    };

    // Trigger canvas init when brush mode active
    useEffect(() => {
        if (isBrushMode) {
            // Delay slightly to ensure ref is ready
            setTimeout(initCanvas, 100);
        }
    }, [isBrushMode, imageUrl]);

    const saveHistory = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(data);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (canvas && ctx) {
                ctx.putImageData(history[newIndex], 0, 0);
            }
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (canvas && ctx) {
                ctx.putImageData(history[newIndex], 0, 0);
            }
        }
    };

    const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
        setIsDrawing(true);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        ctx.beginPath();
        ctx.moveTo((clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        ctx.lineTo((clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY);
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    };

    const endDraw = () => {
        if (isDrawing) {
            setIsDrawing(false);
            saveHistory();
        }
    };

    const handleBrushDone = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        // Convert to Blob and use
        canvas.toBlob((blob) => {
            if (blob && onUseAsReference) {
                const url = URL.createObjectURL(blob);
                onUseAsReference(url);
                onClose();
            }
        }, 'image/png');
    };
    
    // Zoom handlers
    const handleWheel = (e: React.WheelEvent) => {
        if (isBrushMode) return; // Disable zoom in brush mode for simplicity
        e.stopPropagation();
        if (e.deltaY < 0) {
            setScale(s => Math.min(s + 0.1, 5));
        } else {
            setScale(s => Math.max(s - 0.1, 0.5));
        }
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
         if (isBrushMode) return;
         e.stopPropagation();
         setScale(s => s === 1 ? 2 : 1);
    };

    return (
        <AnimatePresence>
            {isOpen && imageUrl && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col"
                    onClick={onClose}
                    onWheel={handleWheel}
                >
                    {/* Top Bar */}
                    {!isBrushMode && (
                        <motion.div 
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="absolute top-0 left-0 right-0 p-4 flex justify-end items-center z-50 bg-gradient-to-b from-black/50 to-transparent pointer-events-none"
                        >
                             <button
                                onClick={onClose}
                                className="p-2 text-white/80 hover:text-white pointer-events-auto"
                            >
                                <X size={24} />
                            </button>
                        </motion.div>
                    )}

                    {/* Image Area - Added padding bottom to avoid overlap with buttons */}
                    <div className="flex-1 flex items-center justify-center overflow-hidden p-4 pb-32 relative">
                        {isBrushMode ? (
                            <div 
                                className="relative flex items-center justify-center bg-black"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <canvas
                                    ref={canvasRef}
                                    onMouseDown={startDraw}
                                    onMouseMove={draw}
                                    onMouseUp={endDraw}
                                    onMouseLeave={endDraw}
                                    onTouchStart={startDraw}
                                    onTouchMove={draw}
                                    onTouchEnd={endDraw}
                                    className="cursor-crosshair shadow-2xl"
                                />
                            </div>
                        ) : (
                            <motion.div
                                 initial={{ scale: 0.9, opacity: 0 }}
                                 animate={{ scale: 1, opacity: 1 }}
                                 exit={{ scale: 0.9, opacity: 0 }}
                                 transition={{ type: "spring", damping: 25, stiffness: 300 }}
                                 style={{ scale }}
                                 className="relative"
                                 onClick={(e) => e.stopPropagation()}
                                 onDoubleClick={handleDoubleClick}
                            >
                                <img
                                    src={imageUrl}
                                    alt="Full Preview"
                                    className="max-w-full max-h-[85vh] object-contain shadow-2xl rounded-lg select-none"
                                    draggable={false}
                                />
                            </motion.div>
                        )}
                    </div>

                    {/* Bottom Action Bar */}
                    {isBrushMode ? (
                        <div className="absolute bottom-0 left-0 right-0 z-50 pointer-events-auto bg-[#1e1e1e] border-t border-white/10 p-4" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col gap-4 max-w-lg mx-auto">
                                <div className="flex justify-between items-center text-white mb-2">
                                    <h3 className="text-sm font-medium pl-2">选择要编辑的区域</h3>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <button 
                                        onClick={() => setIsBrushMode(false)}
                                        className="flex-1 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
                                    >
                                        取消
                                    </button>
                                    
                                    <div className="flex items-center gap-4">
                                        <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-2 text-white/80 hover:text-white disabled:opacity-30">
                                            <Undo size={24} />
                                        </button>
                                        <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="p-2 text-white/80 hover:text-white disabled:opacity-30">
                                            <Redo size={24} />
                                        </button>
                                    </div>

                                    <button 
                                        onClick={handleBrushDone}
                                        className="flex-1 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
                                    >
                                        下一步
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="absolute bottom-8 left-0 right-0 flex justify-center z-50 pointer-events-none">
                            <motion.div 
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                className="flex justify-center gap-12 pointer-events-auto bg-black/40 backdrop-blur-md px-10 py-4 rounded-full border border-white/10"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <BottomActionButton 
                                    icon={Edit2} 
                                    label="编辑" 
                                    onClick={handleUseAsRef} 
                                />
                                <BottomActionButton 
                                    icon={Brush} 
                                    label="选择" 
                                    onClick={handleEnterBrushMode} 
                                />
                                 <BottomActionButton 
                                    icon={Download} 
                                    label="保存" 
                                    onClick={handleDownload} 
                                />
                            </motion.div>
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
};

const BottomActionButton = ({ icon: Icon, label, onClick }: { icon: any, label: string, onClick: (e: React.MouseEvent) => void }) => (
    <button
        onClick={onClick}
        className="flex flex-col items-center gap-2 group min-w-[60px]"
    >
        <div className="p-3 rounded-full bg-white/10 group-hover:bg-white/20 transition-all group-active:scale-95">
            <Icon size={24} className="text-white" />
        </div>
        <span className="text-xs font-medium text-white/80 group-hover:text-white">{label}</span>
    </button>
);