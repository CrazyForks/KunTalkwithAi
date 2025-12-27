import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';

interface MarkdownRendererProps {
    content: string;
}

type CodeProps = ComponentPropsWithoutRef<'code'> & {
    inline?: boolean;
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
    return (
        <div className="prose prose-invert max-w-none break-words text-sm md:text-base leading-relaxed">
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                code({ inline, className, children, ...props }: CodeProps) {
                    const match = /language-(\w+)/.exec(className || '');
                    const language = match ? match[1] : '';
                    
                    if (!inline && match) {
                        return (
                            <CodeBlock
                                language={language}
                                value={String(children).replace(/\n$/, '')}
                                {...props}
                            />
                        );
                    }
                    return (
                        <code className={`${className} bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono text-jan-200`} {...props}>
                            {children}
                        </code>
                    );
                },

                // Custom styles for other elements
                p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
                h1: ({ children }) => <h1 className="text-2xl font-bold mb-4 mt-6 border-b border-white/10 pb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-bold mb-3 mt-5 border-b border-white/10 pb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-bold mb-2 mt-4">{children}</h3>,
                blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-jan-500 pl-4 py-1 my-4 bg-white/5 italic rounded-r text-gray-300">
                        {children}
                    </blockquote>
                ),
                a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline hover:text-blue-300 transition-colors">
                        {children}
                    </a>
                ),
                table: ({ children }) => (
                    <div className="overflow-x-auto mb-4 border border-white/10 rounded-lg">
                        <table className="min-w-full divide-y divide-white/10">{children}</table>
                    </div>
                ),
                th: ({ children }) => (
                    <th className="px-4 py-3 bg-white/5 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        {children}
                    </th>
                ),
                td: ({ children }) => (
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 border-t border-white/10">
                        {children}
                    </td>
                ),
            }}
        >
            {content}
        </ReactMarkdown>
        </div>
    );
};

// Separate component for Code Block to handle state (Copy button)
const CodeBlock = ({ language, value }: { language: string, value: string }) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <div className="my-4 rounded-lg overflow-hidden border border-white/10 bg-[#1e1e1e] group shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/5">
                <span className="text-xs font-mono text-gray-400 lowercase">{language}</span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
                    title="Copy code"
                >
                    {isCopied ? (
                        <>
                            <Check size={14} className="text-green-500" />
                            <span className="text-green-500">Copied!</span>
                        </>
                    ) : (
                        <>
                            <Copy size={14} />
                            <span>Copy</span>
                        </>
                    )}
                </button>
            </div>
            {/* Syntax Highlighter */}
            <div className="relative overflow-x-auto">
                <SyntaxHighlighter
                    language={language}
                    style={vscDarkPlus}
                    customStyle={{
                        margin: 0,
                        padding: '1.5rem',
                        fontSize: '0.9rem',
                        lineHeight: '1.5',
                        background: 'transparent', // Let parent container handle bg
                    }}
                    showLineNumbers={true}
                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#6e6e6e', textAlign: 'right' }}
                    wrapLines={true}
                >
                    {value}
                </SyntaxHighlighter>
            </div>
        </div>
    );
};