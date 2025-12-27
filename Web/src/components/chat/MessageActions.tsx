import React from 'react';
import { Copy, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface MessageActionsProps {
    onCopy?: () => void;
    onRegenerate?: () => void;
    onEdit?: () => void;
    onDelete: () => void;
    isUser: boolean;
}

export const MessageActions: React.FC<MessageActionsProps> = ({ 
    onCopy, 
    onRegenerate, 
    onEdit, 
    onDelete, 
    isUser 
}) => {
    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-1"
        >
            {onCopy && <ActionButton icon={<Copy size={12} />} onClick={onCopy} label="Copy" />}
            {!isUser && onRegenerate && (
                <ActionButton icon={<RefreshCw size={12} />} onClick={onRegenerate} label="Regenerate" />
            )}
            {onEdit && (
                <ActionButton icon={<Pencil size={12} />} onClick={onEdit} label="Edit" />
            )}
            <ActionButton icon={<Trash2 size={12} />} onClick={onDelete} label="Delete" className="hover:text-red-400" />
        </motion.div>
    );
};

const ActionButton: React.FC<{ 
    icon: React.ReactNode; 
    onClick: () => void; 
    label: string;
    className?: string;
}> = ({ icon, onClick, label, className = '' }) => (
    <button
        onClick={onClick}
        className={`p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors ${className}`}
        title={label}
    >
        {icon}
    </button>
);