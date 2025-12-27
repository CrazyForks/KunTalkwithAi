import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Terminal, Check, Copy } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeExecutionBlockProps {
    codeExecution: {
        language?: string;
        code?: string;
        output?: string;
        imageUrl?: string;
    };
}

export const CodeExecutionBlock: React.FC<CodeExecutionBlockProps> = ({ codeExecution }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isCopied, setIsCopied] = useState(false);

    const { code, language, output, imageUrl } = codeExecution;
    const codeString = code || '';

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(codeString);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <div className="w-full my-2 font-sans">
             {/* Code Block Section */}
             {codeString && (
                <div className="rounded-lg border border-white/10 bg-[#1e1e1e] overflow-hidden shadow-sm">
                    {/* Header */}
                    <div
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-white/5 hover:bg-white/5 transition-colors group select-none"
                    >
                         <Terminal size={14} className="text-[#9C27B0]" />
                         <span className="text-xs font-medium text-gray-300">代码执行</span>
                         {language && <span className="text-[10px] text-gray-500 uppercase tracking-widest font-medium ml-2 opacity-60">{language}</span>}
                         
                         <div className="flex-1" />
                         
                         {/* Copy Button - Visible on hover or when expanded */}
                         <button
                            onClick={handleCopy}
                            className={`flex items-center justify-center p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-all mr-1 ${isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            title="Copy code"
                        >
                            {isCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        </button>

                         <motion.div
                            animate={{ rotate: isExpanded ? 90 : 0 }}
                            transition={{ duration: 0.2 }}
                            className="text-gray-500"
                        >
                            <ChevronRight size={14} />
                        </motion.div>
                    </div>
                    
                    {/* Collapsible Body */}
                    <AnimatePresence initial={false}>
                        {isExpanded && (
                            <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: 'auto' }}
                                exit={{ height: 0 }}
                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                className="overflow-hidden"
                            >
                                <div className="text-sm">
                                    <SyntaxHighlighter
                                        language={language}
                                        style={vscDarkPlus}
                                        customStyle={{
                                            margin: 0,
                                            padding: '1rem',
                                            fontSize: '0.85rem',
                                            lineHeight: '1.5',
                                            background: 'transparent',
                                        }}
                                        wrapLines={true}
                                        showLineNumbers={true}
                                        lineNumberStyle={{ minWidth: '2em', paddingRight: '1em', color: '#6e6e6e', textAlign: 'right' }}
                                    >
                                        {codeString}
                                    </SyntaxHighlighter>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
             )}

             {/* Results Section - Visually separated */}
             {(output || imageUrl) && (
                 <div className="mt-3 space-y-3 pl-1">
                     {output && (
                         <div className="space-y-1">
                             <div className="text-[10px] text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                 <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
                                 Execution Output
                             </div>
                             <div className="p-3 rounded-lg border border-white/10 bg-black/20 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap shadow-inner leading-relaxed">
                                {output}
                             </div>
                         </div>
                     )}
                     
                     {imageUrl && (
                         <div className="space-y-1">
                             <div className="text-[10px] text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                 <div className="w-1 h-1 rounded-full bg-blue-500"></div>
                                 Generated Image
                             </div>
                             <div className="rounded-lg overflow-hidden border border-white/10 bg-black/20 shadow-lg inline-block">
                                 <img 
                                    src={imageUrl} 
                                    className="max-w-full h-auto block" 
                                    alt="Execution Result" 
                                 />
                             </div>
                         </div>
                     )}
                 </div>
             )}
        </div>
    );
};