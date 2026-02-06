import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import './AntigravityTypewriter.css';

interface TextSegment {
    text: string;
    className?: string;
}

interface AntigravityTypewriterProps {
    segments: TextSegment[];
    onComplete?: () => void;
    className?: string;
    initialDelay?: number;
    cursorOffset?: number;
}

const AntigravityTypewriter: React.FC<AntigravityTypewriterProps> = ({
    segments,
    onComplete,
    className = '',
    initialDelay = 1000,
    cursorOffset = 0
}) => {
    const [visibleIndex, setVisibleIndex] = useState(0);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

    // FALSE = Blinking (Idle/Paused)
    // TRUE = Solid (Typing fast)
    const [isTypingActive, setIsTypingActive] = useState(false);
    const [isFinished, setIsFinished] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const allChars = useMemo(() => {
        return segments.flatMap(seg =>
            seg.text.split('').map(char => ({ char, className: seg.className }))
        );
    }, [segments]);

    // --- 1. Smart Typing Loop ---
    useEffect(() => {
        const typeNextChar = () => {
            if (visibleIndex >= allChars.length) {
                setIsFinished(true);
                setIsTypingActive(false); // Resume blinking at the end (until hidden)
                if (onComplete) onComplete();
                return;
            }

            const char = allChars[visibleIndex]?.char || '';
            const currentCharEl = charRefs.current[visibleIndex];
            const prevCharEl = visibleIndex > 0 ? charRefs.current[visibleIndex - 1] : null;

            // --- TIME & STATE CALCULATION ---
            let delay = 50;
            let shouldBlinkDuringPause = false;

            // 1. Detect Line Break
            let isLineBreak = false;
            if (currentCharEl && prevCharEl) {
                if (currentCharEl.offsetTop > prevCharEl.offsetTop + 5) {
                    isLineBreak = true;
                }
            }

            if (visibleIndex === 0) {
                delay = initialDelay;
                shouldBlinkDuringPause = true;
            } else if (isLineBreak) {
                delay = 1000; // 1 second pause
                shouldBlinkDuringPause = true; // Blink while waiting at the line break
            } else if (['.', '!', '?'].includes(char)) {
                delay = 600;
                shouldBlinkDuringPause = true; // Blink during sentence pauses
            } else if (char === ',') {
                delay = 350;
                shouldBlinkDuringPause = true;
            } else if (char === ' ') {
                delay = 40;
            } else {
                delay = Math.random() * 60 + 30;
            }

            // Update Blink State based on the delay duration
            // If we are waiting, let it blink. If typing fast, keep it solid.
            setIsTypingActive(!shouldBlinkDuringPause);

            timerRef.current = setTimeout(() => {
                setVisibleIndex(prev => prev + 1);
            }, delay);
        };

        typeNextChar();

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [visibleIndex, allChars, initialDelay, onComplete]);

    // --- 2. Cursor Position ---
    useLayoutEffect(() => {
        const updateCursor = () => {
            if (!containerRef.current) return;
            const containerRect = containerRef.current.getBoundingClientRect();

            let targetX = 0;
            let targetY = 0;

            if (visibleIndex > 0) {
                const lastVisibleChar = charRefs.current[visibleIndex - 1];
                if (lastVisibleChar) {
                    const rect = lastVisibleChar.getBoundingClientRect();
                    targetX = rect.right - containerRect.left;
                    targetY = rect.top - containerRect.top;
                }
            } else {
                const firstChar = charRefs.current[0];
                if (firstChar) {
                    const rect = firstChar.getBoundingClientRect();
                    targetX = rect.left - containerRect.left;
                    targetY = rect.top - containerRect.top;
                }
            }

            setCursorPos({ x: targetX + cursorOffset, y: targetY });
        };

        updateCursor();
        window.addEventListener('resize', updateCursor);
        return () => window.removeEventListener('resize', updateCursor);
    }, [visibleIndex, cursorOffset]);

    // Blink if NOT active (and not hidden)
    const shouldBlink = !isTypingActive && !isFinished;

    return (
        <div
            className={`antigravity-typewriter-container ${className}`}
            ref={containerRef}
            aria-hidden="true"
        >
            <div className="antigravity-text-wrapper">
                {allChars.map((item, index) => (
                    <span
                        key={`char-${index}`}
                        ref={el => charRefs.current[index] = el}
                        className={`antigravity-char ${item.className || ''}`}
                        style={{
                            opacity: index < visibleIndex ? 1 : 0,
                            visibility: index < visibleIndex ? 'visible' : 'hidden',
                        }}
                    >
                        {item.char}
                    </span>
                ))}
            </div>

            <div
                className={`antigravity-cursor-wrapper ${shouldBlink ? 'blinking' : ''}`}
                style={{
                    transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)`,
                    // [FIX] Only force opacity to 0 if finished. 
                    // Otherwise leave undefined so CSS animation can control it.
                    opacity: isFinished ? 0 : undefined,
                }}
            >
                <img
                    src="/images/antigravity-cursor.png"
                    alt=""
                    className="antigravity-cursor-asset"
                />
            </div>
        </div>
    );
};

export default AntigravityTypewriter;