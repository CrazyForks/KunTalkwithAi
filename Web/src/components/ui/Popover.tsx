import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  triggerRef: React.RefObject<HTMLElement | null>;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'right' | 'left';
  offset?: number;
  alignOffset?: number;
  usePortal?: boolean;
  animation?: 'default' | 'android_panel';
}

export const Popover: React.FC<PopoverProps> = ({
  isOpen,
  onClose,
  children,
  triggerRef,
  align = 'center',
  side = 'bottom',
  offset = 8,
  alignOffset = 0,
  usePortal = true, // Default to true to avoid overflow clipping in sidebars
  animation = 'default'
}) => {

  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });
  const lastPosRef = useRef({ top: -9999, left: -9999 });
  
  // Use ref for onClose to avoid re-running effect when parent re-renders
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // 检查点击目标是否在 Popover 内部
      const isInsidePopover = popoverRef.current && popoverRef.current.contains(event.target as Node);
      
      // 检查点击目标是否在 Trigger 内部 (如果是，则交给 Trigger 的 onClick 处理 Toggle，不在这里 Close)
      const isInsideTrigger = triggerRef.current && triggerRef.current.contains(event.target as Node);

      if (!isInsidePopover && !isInsideTrigger) {
        onCloseRef.current();
      }
    };

    const updatePosition = () => {
        if (isOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const popRect = popoverRef.current?.getBoundingClientRect();
            const popWidth = popRect?.width ?? 0;
            const popHeight = popRect?.height ?? 0;

            let top = 0;
            let left = 0;

            if (side === 'bottom') {
                top = rect.bottom + offset;
                if (align === 'center') left = rect.left + rect.width / 2 - popWidth / 2 + alignOffset;
                else if (align === 'start') left = rect.left + alignOffset;
                else if (align === 'end') left = rect.right - popWidth + alignOffset;
            } else if (side === 'top') {
                top = rect.top - offset - popHeight;
                if (align === 'center') left = rect.left + rect.width / 2 - popWidth / 2 + alignOffset;
                else if (align === 'start') left = rect.left + alignOffset;
                else if (align === 'end') left = rect.right - popWidth + alignOffset;
            } else if (side === 'right') {
                left = rect.right + offset;
                if (align === 'start') top = rect.top + alignOffset;
                else if (align === 'center') top = rect.top + rect.height / 2 - popHeight / 2 + alignOffset;
                else if (align === 'end') top = rect.bottom - popHeight + alignOffset;
            } else if (side === 'left') {
                left = rect.left - offset - popWidth;
                if (align === 'start') top = rect.top + alignOffset;
                else if (align === 'center') top = rect.top + rect.height / 2 - popHeight / 2 + alignOffset;
                else if (align === 'end') top = rect.bottom - popHeight + alignOffset;
            }

            if (Math.abs(top - lastPosRef.current.top) > 0.5 || Math.abs(left - lastPosRef.current.left) > 0.5) {
                lastPosRef.current = { top, left };
                setPosition({ top, left });
            }
        }
    };

    let resizeObserver: ResizeObserver | null = null;
    let rafHandle = 0;

    const loop = () => {
        updatePosition();
        if (isOpen) {
            rafHandle = requestAnimationFrame(loop);
        }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      
      if (popoverRef.current) {
          resizeObserver = new ResizeObserver(() => updatePosition());
          resizeObserver.observe(popoverRef.current);
      }
      
      loop();
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      resizeObserver?.disconnect();
      cancelAnimationFrame(rafHandle);
    };
  }, [isOpen, triggerRef, align, side, offset, alignOffset]); // Removed onClose from dependencies

  const motionPreset = animation === 'android_panel'
    ? {
        initial: { opacity: 0, scale: 0.8 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.9 },
        transition: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const },
        style: { transformOrigin: '50% 100%' },
      }
    : {
        initial: { opacity: 0, scale: 0.95 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
        transition: { duration: 0.15 },
        style: undefined as undefined | React.CSSProperties,
      };

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
            ref={popoverRef}
            initial={motionPreset.initial}
            animate={motionPreset.animate}
            exit={motionPreset.exit}
            transition={motionPreset.transition}
            className="fixed z-[9999] min-w-[140px] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-xl overflow-hidden"
            style={{
                top: position.top,
                left: position.left,
                ...(motionPreset.style ?? {})
            }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (usePortal && typeof document !== 'undefined') {
      return createPortal(content, document.body);
  }

  return content;
};