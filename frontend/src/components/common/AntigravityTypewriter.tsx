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
    const [isTypingActive, setIsTypingActive] = useState(false);
    const [isFinished, setIsFinished] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Flatten segments for the typing logic
    const allChars = useMemo(() => {
        return segments.flatMap(seg =>
            seg.text.split('').map(char => ({ char, className: seg.className }))
        );
    }, [segments]);

    // --- 1. Typing Logic ---
    useEffect(() => {
        const typeNextChar = () => {
            if (visibleIndex >= allChars.length) {
                setIsFinished(true);
                setIsTypingActive(false);
                if (onComplete) onComplete();
                return;
            }

            const char = allChars[visibleIndex]?.char || '';
            const currentCharEl = charRefs.current[visibleIndex];
            const prevCharEl = visibleIndex > 0 ? charRefs.current[visibleIndex - 1] : null;

            let delay = 50;
            let shouldBlink = false;

            // Detect Line Break (Forced or Wrapped) for 1s pause
            if (currentCharEl && prevCharEl && currentCharEl.offsetTop > prevCharEl.offsetTop + 5) {
                delay = 1000;
                shouldBlink = true;
            } else if (visibleIndex === 0) {
                delay = initialDelay;
                shouldBlink = true;
            } else if (['.', '!', '?'].includes(char)) {
                delay = 600;
                shouldBlink = true;
            } else if (char === ',') {
                delay = 350;
                shouldBlink = true;
            } else if (char === ' ') {
                delay = 40;
            } else {
                delay = Math.random() * 60 + 30;
            }

            setIsTypingActive(!shouldBlink);

            timerRef.current = setTimeout(() => {
                setVisibleIndex(prev => prev + 1);
            }, delay);
        };

        typeNextChar();

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [visibleIndex, allChars, initialDelay, onComplete]);

    // --- 2. Cursor Positioning (Teleport Logic) ---
    useLayoutEffect(() => {
        const updateCursor = () => {
            if (!containerRef.current) return;

            requestAnimationFrame(() => {
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
            });
        };

        updateCursor();
        window.addEventListener('resize', updateCursor);
        return () => window.removeEventListener('resize', updateCursor);
    }, [visibleIndex, cursorOffset]);

    const shouldBlink = !isTypingActive && !isFinished;

    return (
        <div className={`antigravity-typewriter-container ${className}`} ref={containerRef} aria-hidden="true">
            <div className="antigravity-text-wrapper">
                {segments.map((seg, segIdx) => {
                    // Offset calculation to map flat allChars to nested spans
                    const prevCharsCount = segments
                        .slice(0, segIdx)
                        .reduce((acc, s) => acc + s.text.length, 0);

                    return (
                        <div
                            key={`seg-${segIdx}`}
                            className={`antigravity-segment-line ${seg.className || ''}`}
                        >
                            {seg.text.split('').map((char, charIdx) => {
                                const globalIdx = prevCharsCount + charIdx;
                                return (
                                    <span
                                        key={`char-${globalIdx}`}
                                        ref={el => charRefs.current[globalIdx] = el}
                                        className="antigravity-char"
                                        style={{
                                            opacity: globalIdx < visibleIndex ? 1 : 0,
                                            visibility: globalIdx < visibleIndex ? 'visible' : 'hidden',
                                        }}
                                    >
                                        {char}
                                    </span>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            <div
                className={`antigravity-cursor-wrapper ${shouldBlink ? 'blinking' : ''}`}
                style={{
                    transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)`,
                    opacity: isFinished ? 0 : 1,
                }}
            >
                <img src="/images/antigravity-cursor.png" alt="" className="antigravity-cursor-asset" />
            </div>
        </div>
    );
};

export default AntigravityTypewriter;