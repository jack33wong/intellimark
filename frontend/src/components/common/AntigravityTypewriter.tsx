import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import './AntigravityTypewriter.css';

interface TextSegment {
    text: string;
    className?: string;
}

interface AntigravityTypewriterProps {
    segments: TextSegment[];
    typingSpeed?: number;
    initialDelay?: number;
    onComplete?: () => void;
    className?: string;
}

const AntigravityTypewriter: React.FC<AntigravityTypewriterProps> = ({
    segments,
    typingSpeed = 70,
    initialDelay = 500,
    onComplete,
    className = ''
}) => {
    const [visibleIndex, setVisibleIndex] = useState(0);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const lastCharRef = useRef<HTMLSpanElement | null>(null);

    // Flatten segments into an array of characters
    const allChars = useMemo(() => {
        return segments.flatMap(seg =>
            seg.text.split('').map(char => ({ char, className: seg.className }))
        );
    }, [segments]);

    const fullText = useMemo(() => segments.map(s => s.text).join(''), [segments]);

    // Use a ref for the typing index to prevent double-incrementing or resets
    const typingIdxRef = useRef(0);

    // Handle typing animation
    useEffect(() => {
        // Reset if segments change
        if (typingIdxRef.current > allChars.length) {
            typingIdxRef.current = 0;
            setVisibleIndex(0);
        }

        let timer: NodeJS.Timeout;

        const type = () => {
            if (typingIdxRef.current >= allChars.length) {
                if (onComplete) onComplete();
                return;
            }

            const interval = typingIdxRef.current === 0 ? initialDelay : typingSpeed;
            timer = setTimeout(() => {
                typingIdxRef.current += 1;
                setVisibleIndex(typingIdxRef.current);
                type();
            }, interval);
        };

        type();
        return () => clearTimeout(timer);
    }, [allChars.length, typingSpeed, initialDelay, onComplete]);

    // Update cursor position
    useLayoutEffect(() => {
        const update = () => {
            if (!containerRef.current || allChars.length === 0) return;

            const isDone = visibleIndex >= allChars.length;

            // TARGETING STRATEGY:
            // We always target the character at 'visibleIndex'.
            // If visibleIndex is N, we are looking at the N-th character (which is currently at 0 opacity).
            // If we are DONE, we target the special 'end-anchor' span.

            const targetEl = isDone ? lastCharRef.current : charRefs.current[visibleIndex];

            if (targetEl) {
                const charRect = targetEl.getBoundingClientRect();
                const containerRect = containerRef.current.getBoundingClientRect();

                let targetX = charRect.left - containerRect.left;
                let targetY = charRect.top - containerRect.top;

                setCursorPos({ x: targetX, y: targetY });
            } else if (!isDone && visibleIndex === 0) {
                // Fallback for the very first letter if refs aren't ready
                setCursorPos({ x: 0, y: 0 });
            }
        };

        const handle = requestAnimationFrame(update);
        window.addEventListener('resize', update);
        return () => {
            cancelAnimationFrame(handle);
            window.removeEventListener('resize', update);
        };
    }, [visibleIndex, allChars.length]);

    return (
        <div
            className={`antigravity-typewriter-container ${className}`}
            ref={containerRef}
            aria-label={fullText}
        >
            <div
                className="antigravity-cursor-wrapper"
                style={{
                    '--cursor-x': `${cursorPos.x}px`,
                    '--cursor-y': `${cursorPos.y}px`,
                    opacity: visibleIndex === 0 && cursorPos.x === 0 ? 0 : 1
                } as React.CSSProperties}
            >
                <img
                    src="/images/antigravity-cursor.png"
                    alt="cursor"
                    className="antigravity-cursor-asset"
                />
            </div>

            <div className="antigravity-text-wrapper" aria-hidden="true">
                {allChars.map((item, index) => (
                    <span
                        key={`char-${index}`}
                        ref={el => charRefs.current[index] = el}
                        className={`antigravity-char ${item.className || ''}`}
                        style={{
                            opacity: index < visibleIndex ? 1 : 0,
                            visibility: 'visible',
                            whiteSpace: 'pre'
                        }}
                    >
                        {item.char}
                    </span>
                ))}
                {/* VIRTUAL CURSOR SLOT: 
            This zero-width span acts as the ground-truth anchor for the "END" position. 
            The cursor targets THIS element's coordinates when typing is complete. */}
                <span
                    ref={lastCharRef}
                    style={{ display: 'inline-block', width: 0, height: '1em', verticalAlign: 'middle' }}
                />
            </div>
        </div>
    );
};

export default AntigravityTypewriter;
