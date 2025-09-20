/**
 * Custom hook for auto-scroll functionality
 * 
 * Centralizes all scroll-to-bottom logic and image loading handlers
 * to eliminate code duplication across components.
 */

import { useCallback, useRef, useLayoutEffect } from 'react';

export const useAutoScroll = (messages = []) => {
  const containerRef = useRef(null);
  
  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Auto-scroll when messages change (works for both new messages AND history loading)
  useLayoutEffect(() => {
    if (messages.length > 0) {
      // useLayoutEffect runs synchronously after DOM mutations but before paint
      // No need for requestAnimationFrame - DOM is already updated
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  // Handle image loading with delay for proper scroll
  const handleImageLoad = useCallback(() => {
    // Small delay to ensure image has rendered and expanded the container
    setTimeout(scrollToBottom, 50);
  }, [scrollToBottom]);

  // Handle scroll events (for showing/hiding scroll button)
  const handleScroll = useCallback((onScrollChange) => {
    if (!containerRef.current || !onScrollChange) return;
    
    const container = containerRef.current;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    const hasMessages = messages.length > 0;
    
    // Show button only if there are messages AND user is not at the bottom
    const shouldShowButton = hasMessages && !isNearBottom;
    onScrollChange(shouldShowButton);
  }, [messages.length]);

  return {
    containerRef,
    scrollToBottom,
    handleImageLoad,
    handleScroll
  };
};
