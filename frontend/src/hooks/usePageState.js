/**
 * Custom hook for page state management using useReducer
 * 
 * Centralizes related state variables and provides consistent state updates
 */

import { useReducer, useCallback } from 'react';

// Initial state
const initialState = {
  pageMode: 'upload', // 'upload' | 'chat'
  showScrollButton: false,
  showInfoDropdown: false,
  selectedModel: 'chatgpt-4o'
};

// Action types
export const PAGE_ACTIONS = {
  SET_PAGE_MODE: 'SET_PAGE_MODE',
  TOGGLE_SCROLL_BUTTON: 'TOGGLE_SCROLL_BUTTON',
  SET_SCROLL_BUTTON: 'SET_SCROLL_BUTTON',
  TOGGLE_INFO_DROPDOWN: 'TOGGLE_INFO_DROPDOWN',
  SET_INFO_DROPDOWN: 'SET_INFO_DROPDOWN',
  SET_MODEL: 'SET_MODEL',
  RESET: 'RESET'
};

// Reducer function
const pageStateReducer = (state, action) => {
  switch (action.type) {
    case PAGE_ACTIONS.SET_PAGE_MODE:
      return { ...state, pageMode: action.payload };
    
    case PAGE_ACTIONS.TOGGLE_SCROLL_BUTTON:
      return { ...state, showScrollButton: !state.showScrollButton };
    
    case PAGE_ACTIONS.SET_SCROLL_BUTTON:
      return { ...state, showScrollButton: action.payload };
    
    case PAGE_ACTIONS.TOGGLE_INFO_DROPDOWN:
      return { ...state, showInfoDropdown: !state.showInfoDropdown };
    
    case PAGE_ACTIONS.SET_INFO_DROPDOWN:
      return { ...state, showInfoDropdown: action.payload };
    
    case PAGE_ACTIONS.SET_MODEL:
      return { ...state, selectedModel: action.payload };
    
    case PAGE_ACTIONS.RESET:
      return initialState;
    
    default:
      return state;
  }
};

export const usePageState = () => {
  const [state, dispatch] = useReducer(pageStateReducer, initialState);

  // Action creators
  const setPageMode = useCallback((mode) => {
    dispatch({ type: PAGE_ACTIONS.SET_PAGE_MODE, payload: mode });
  }, []);

  const toggleScrollButton = useCallback(() => {
    dispatch({ type: PAGE_ACTIONS.TOGGLE_SCROLL_BUTTON });
  }, []);

  const setScrollButton = useCallback((show) => {
    dispatch({ type: PAGE_ACTIONS.SET_SCROLL_BUTTON, payload: show });
  }, []);

  const toggleInfoDropdown = useCallback(() => {
    dispatch({ type: PAGE_ACTIONS.TOGGLE_INFO_DROPDOWN });
  }, []);

  const setInfoDropdown = useCallback((show) => {
    dispatch({ type: PAGE_ACTIONS.SET_INFO_DROPDOWN, payload: show });
  }, []);

  const setModel = useCallback((model) => {
    dispatch({ type: PAGE_ACTIONS.SET_MODEL, payload: model });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: PAGE_ACTIONS.RESET });
  }, []);

  return {
    // State
    ...state,
    
    // Actions
    setPageMode,
    toggleScrollButton,
    setScrollButton,
    toggleInfoDropdown,
    setInfoDropdown,
    setModel,
    reset
  };
};
