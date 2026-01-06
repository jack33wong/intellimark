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
        // Native behavior is now boosted by scroll-margin-top in CSS
        targetMessage.scrollIntoView(options || { behavior: 'smooth', block: 'center' });
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
      const secondLastMessage = chatMessages.length > 1 ? chatMessages[chatMessages.length - 2] : null;

      // Delay to ensure DOM rendering and layout stabilization
      setTimeout(() => {
        // Priority 1: If the new message is from user, scroll its head to top
        if (lastMessage && lastMessage.role === 'user') {
          // Double-scroll strategy: Immediately start, then refine
          scrollToMessage(lastMessage.id, { behavior: 'smooth', block: 'start' });

          // Refinement scroll after potential image expansion/spacer jump
          setTimeout(() => {
            scrollToMessage(lastMessage.id, { behavior: 'smooth', block: 'start' });
          }, 450);
        }
        // Priority 2: If we are currently in AI thinking mode or just updated a processing message, 
        // OR if this is the final AI response arriving, DO NOT scroll to bottom. 
        // We want to keep the user locked to their current reading position (usually the start of their last question).
        else if (isAIThinking || (lastMessage && lastMessage.role === 'assistant')) {
          // No-op: Maintain user focus position
        }
        // Priority 3: Otherwise (final response, system message), scroll to bottom.
        else {
          scrollToBottom();
        }
      }, 250); // Increased for better stability
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
        }
        // Removed scrollToBottom() here to prevent "Completion Jump"
        // User stays locked to their current reading position (e.g., top of question)
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

