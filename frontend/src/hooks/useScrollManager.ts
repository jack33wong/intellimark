import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { UnifiedMessage } from '../types';

/**
 * A dedicated hook to manage all complex scrolling logic for the chat view.
 */
export const useScrollManager = (chatMessages: UnifiedMessage[], isAIThinking: boolean) => {
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasNewResponse, setHasNewResponse] = useState(false);
  const [newResponseMessageId, setNewResponseMessageId] = useState<string | number | null>(null);

  // State to hold the actual DOM element. This triggers re-renders/effects when the node changes.
  const [chatContainerElement, setChatContainerElement] = useState<HTMLDivElement | null>(null);

  // Callback ref to capture the DOM element from the consumer
  const chatContainerRef = useCallback((node: HTMLDivElement | null) => {
    setChatContainerElement(node);
  }, []);

  const prevMessagesCountRef = useRef(chatMessages.length);
  const prevIsAIThinkingRef = useRef(isAIThinking);

  const scrollToBottom = useCallback(() => {
    if (chatContainerElement) {
      chatContainerElement.scrollTo({
        top: chatContainerElement.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [chatContainerElement]);

  const scrollToMessage = useCallback((messageId: string | number, options?: ScrollIntoViewOptions) => {
    if (chatContainerElement && messageId) {
      const targetMessage = chatContainerElement.querySelector(`[data-message-id="${messageId}"]`);

      if (targetMessage) {
        // Custom handling for 'start' alignment to account for fixed Headers (Offset ~140px)
        if (options?.block === 'start') {
          const containerRect = chatContainerElement.getBoundingClientRect();
          const targetRect = targetMessage.getBoundingClientRect();
          const offset = 140; // Approx height of Header + Ribbon
          // Calculate scrolling position: currentScroll + relativeTop - offset
          const top = chatContainerElement.scrollTop + (targetRect.top - containerRect.top) - offset;

          chatContainerElement.scrollTo({
            top: top,
            behavior: options.behavior || 'smooth'
          });
        } else {
          // Default native behavior for 'center' or 'end'
          targetMessage.scrollIntoView(options || { behavior: 'smooth', block: 'center' });
        }
        return true;
      }
    }
    // If we can't find message, only scroll to bottom if no specific options were passed (default behavior)
    if (!options) {
      scrollToBottom();
    }
    return false;
  }, [chatContainerElement, scrollToBottom]);

  const scrollToNewResponse = useCallback(() => {
    if (newResponseMessageId) {
      scrollToMessage(newResponseMessageId);
    }
    setHasNewResponse(false);
    setNewResponseMessageId(null);
  }, [newResponseMessageId, scrollToMessage]);

  // Effect to attach scroll listener whenever the element is available/changes
  useEffect(() => {
    const container = chatContainerElement;
    if (!container) return;

    const handleScroll = () => {
      // Show button if scrolled up more than 200px
      const isUp = container.scrollHeight - container.scrollTop - container.clientHeight > 200;
      setShowScrollButton(isUp);

      if (hasNewResponse && !isUp) {
        setHasNewResponse(false);
        setNewResponseMessageId(null);
      }
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check
    return () => container.removeEventListener('scroll', handleScroll);
  }, [chatContainerElement, hasNewResponse]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (chatMessages.length > prevMessagesCountRef.current) {
      const lastMessage = chatMessages[chatMessages.length - 1];

      // Delay to ensure DOM rendering
      setTimeout(() => {
        if (lastMessage && lastMessage.role === 'user') {
          // FIX: Scroll new user message to the TOP ('start') to show the dynamic spacer below
          const success = scrollToMessage(lastMessage.id, { behavior: 'smooth', block: 'start' });

          // Retry once if failed (sometimes DOM is slow)
          if (!success) {
            setTimeout(() => {
              scrollToMessage(lastMessage.id, { behavior: 'smooth', block: 'start' });
            }, 300);
          }
        } else {
          scrollToBottom();
        }
      }, 100);
    }
    prevMessagesCountRef.current = chatMessages.length;
  }, [chatMessages, scrollToBottom, scrollToMessage]);

  useLayoutEffect(() => {
    if (prevIsAIThinkingRef.current === true && isAIThinking === false) {
      const animationFrameId = requestAnimationFrame(() => {
        const container = chatContainerElement;
        if (!container) return;
        const lastMessage = chatMessages[chatMessages.length - 1];
        if (!lastMessage) return;

        const isScrolledUp = container.scrollHeight - container.scrollTop - container.clientHeight > 200;
        if (isScrolledUp) {
          setHasNewResponse(true);
          setNewResponseMessageId(lastMessage.id || lastMessage.timestamp);
        } else {
          scrollToBottom();
        }
      });
      return () => cancelAnimationFrame(animationFrameId);
    }
    prevIsAIThinkingRef.current = isAIThinking;
  }, [isAIThinking, chatMessages, scrollToBottom, chatContainerElement]);

  return {
    chatContainerRef, // Now exposing the callback
    showScrollButton,
    hasNewResponse,
    scrollToBottom,
    scrollToNewResponse,
    scrollToMessage,
  };
};

