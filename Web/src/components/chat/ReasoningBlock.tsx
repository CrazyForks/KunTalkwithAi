import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Brain } from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';

interface ReasoningBlockProps {
    content: string;
    isGenerating?: boolean;
    hasMainContent?: boolean;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ content, isGenerating, hasMainContent }) => {
    // Initialize state: expanded if no main content yet (still reasoning), collapsed otherwise
    const [isExpanded, setIsExpanded] = useState(!hasMainContent);
    const prevHasMainContentRef = useRef(hasMainContent);

    // Auto-collapse when main content starts appearing
    useEffect(() => {
        if (!prevHasMainContentRef.current && hasMainContent) {
            setIsExpanded(false);
        }
        prevHasMainContentRef.current = hasMainContent;
    }, [hasMainContent]);

    if (!content && !isGenerating) return null;

    // Calculate duration logic (mock or real) could go here
    // For now we assume if it's collapsed and has content, it's "Thinking Process"

    return (
        <div className="mb-2">
            <motion.div 
                initial={false}
                animate={{ 
                    backgroundColor: isExpanded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'
                }}
                className="relative rounded-2xl overflow-hidden transition-colors duration-300"
            >
                <motion.div
                    initial={false}
                    animate={{ opacity: isGenerating && !hasMainContent ? 1 : 0.45 }}
                    className="absolute left-0 top-0 bottom-0 w-[2px] bg-jan-400/70"
                />
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                    <div className={`relative flex items-center justify-center ${isGenerating && !hasMainContent ? "text-jan-400" : ""}`}>
                        <Brain size={14} />
                        {isGenerating && !hasMainContent && (
                            <span className="absolute inset-0 bg-jan-400/20 animate-ping rounded-full" />
                        )}
                    </div>
                    
                    <span className={`font-medium ${isGenerating && !hasMainContent ? "text-jan-300" : ""}`}>
                        {isGenerating && !hasMainContent ? "正在思考..." : "推理过程"}
                    </span>
                    
                    <div className="flex-1" />
                    <motion.div
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <ChevronRight size={14} />
                    </motion.div>
                </button>

                <AnimatePresence initial={false}>
                    {isExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                        >
                            <div className="px-3 pb-3 pt-0">
                                <div className="pt-2 opacity-80 text-xs leading-relaxed text-gray-300">
                                    <MarkdownRenderer content={content} />
                                    {isGenerating && !hasMainContent && (
                                        <span className="inline-block w-1.5 h-3 ml-1 bg-jan-400 animate-cursor-blink align-middle" />
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};