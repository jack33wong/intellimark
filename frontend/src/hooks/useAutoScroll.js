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

  // Auto-scroll when messages change, but only if user is already near the bottom
  useLayoutEffect(() => {
    if (messages.length > 0 && containerRef.current) {
      const container = containerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      
      // Only auto-scroll if user is already near the bottom
      if (isNearBottom) {
        scrollToBottom();
      }
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

  // Smart scroll function that only scrolls if user is near the bottom
  const smartScrollToBottom = useCallback((hasNewResponse = false) => {
    if (containerRef.current) {
      const container = containerRef.current;
      
      // Don't auto-scroll if new response button is active
      if (hasNewResponse) {
        return;
      }
      
      // Check immediately first
      const immediateScrollDistance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const isImmediatelyNearBottom = immediateScrollDistance < 100;
      
      if (isImmediatelyNearBottom) {
        scrollToBottom();
        return;
      }
      
      // If not immediately near bottom, wait a bit for content to settle, then check again
      setTimeout(() => {
        if (containerRef.current && !hasNewResponse) {
          const container = containerRef.current;
          const scrollDistance = container.scrollHeight - container.scrollTop - container.clientHeight;
          const isNearBottom = scrollDistance < 100;
          
          if (isNearBottom) {
            scrollToBottom();
          }
        }
      }, 100); // Small delay to allow content to settle
    }
  }, [scrollToBottom]);

  return {
    containerRef,
    scrollToBottom,
    smartScrollToBottom,
    handleImageLoad,
    handleScroll
  };
};
