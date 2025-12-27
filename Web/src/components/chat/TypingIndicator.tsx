import React from 'react';
import { motion } from 'framer-motion';

export const TypingIndicator: React.FC = () => {
    return (
        <div className="flex items-center space-x-1.5 px-1 py-1">
            <motion.div
                className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                animate={{
                    y: [0, -4, 0],
                    opacity: [0.5, 1, 0.5]
                }}
                transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: 0,
                    ease: "easeInOut"
                }}
            />
            <motion.div
                className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                animate={{
                    y: [0, -4, 0],
                    opacity: [0.5, 1, 0.5]
                }}
                transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: 0.2,
                    ease: "easeInOut"
                }}
            />
            <motion.div
                className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                animate={{
                    y: [0, -4, 0],
                    opacity: [0.5, 1, 0.5]
                }}
                transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: 0.4,
                    ease: "easeInOut"
                }}
            />
        </div>
    );
};