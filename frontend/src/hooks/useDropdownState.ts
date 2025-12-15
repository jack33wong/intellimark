import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Custom hook for managing dropdown state that persists across re-renders
 * Uses useRef to maintain state when component re-mounts with same message ID
 * 
 * @param messageId - Unique identifier for the message (used for state persistence)
 * @param initialValue - Initial dropdown state (default: false)
 * @returns Object with dropdown state and control functions
 */
export function useDropdownState(messageId: string, initialValue: boolean = false) {
  // Use ref to persist state across re-renders
  const showProgressDetailsRef = useRef<boolean>(initialValue);
  const [showProgressDetails, setShowProgressDetails] = useState<boolean>(initialValue);

  // Initialize state from ref when message changes
  useEffect(() => {
    setShowProgressDetails(showProgressDetailsRef.current);
  }, [messageId]);

  const toggleDropdown = useCallback((scrollToBottom?: () => void) => {
    const newState = !showProgressDetailsRef.current;
    showProgressDetailsRef.current = newState;
    setShowProgressDetails(newState);
  }, []);

  const setDropdownState = useCallback((isOpen: boolean) => {
    showProgressDetailsRef.current = isOpen;
    setShowProgressDetails(isOpen);
  }, []);

  return {
    showProgressDetails,
    toggleDropdown,
    setDropdownState,
    isOpen: showProgressDetails
  };
}
