import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Globe, ExternalLink } from 'lucide-react';
import type { WebSearchResult } from '../../db';

interface SearchResultsBlockProps {
    results: WebSearchResult[];
}

export const SearchResultsBlock: React.FC<SearchResultsBlockProps> = ({ results }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!results || results.length === 0) return null;

    return (
        <div className="mb-2">
            <motion.div 
                initial={false}
                animate={{ 
                    backgroundColor: isExpanded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'
                }}
                className="relative rounded-xl overflow-hidden transition-colors duration-300 border border-white/5"
            >
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                    <div className="flex items-center justify-center text-jan-400">
                        <Globe size={14} />
                    </div>
                    
                    <span className="font-medium text-jan-300">
                        {results.length} 个搜索来源
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
                            <div className="px-3 pb-3 pt-0 grid gap-2">
                                {results.map((r, idx) => (
                                    <a
                                        key={idx}
                                        href={r.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-start gap-2 p-2 rounded-lg bg-black/20 hover:bg-black/40 transition-colors group"
                                    >
                                        <div className="mt-0.5 min-w-[16px] flex justify-center text-gray-500 text-[10px] font-mono border border-gray-700 rounded h-4 items-center">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-jan-200 font-medium truncate group-hover:text-jan-100 transition-colors">
                                                {r.title || r.url}
                                            </div>
                                            <div className="text-[10px] text-gray-500 truncate mt-0.5">
                                                {r.url}
                                            </div>
                                        </div>
                                        <ExternalLink size={12} className="text-gray-600 group-hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-all" />
                                    </a>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};