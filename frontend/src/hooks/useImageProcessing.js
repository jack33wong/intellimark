/**
 * Unified Image Processing Hook
 * Single state management for ALL image processing
 * Eliminates multiple code paths and race conditions
 */

import React, { useReducer, useCallback } from 'react';
import ImageProcessingService from '../services/imageProcessingService';

// Initial state
const initialState = {
  status: 'idle', // 'idle' | 'processing' | 'complete' | 'error'
  userMessage: null,
  aiMessage: null,
  sessionId: null,
  error: null,
  isWaitingForAI: false
};

// Action types
const ACTION_TYPES = {
  PROCESSING_START: 'PROCESSING_START',
  USER_MESSAGE_RECEIVED: 'USER_MESSAGE_RECEIVED',
  AI_MESSAGE_RECEIVED: 'AI_MESSAGE_RECEIVED',
  PROCESSING_COMPLETE: 'PROCESSING_COMPLETE',
  PROCESSING_ERROR: 'PROCESSING_ERROR',
  RESET: 'RESET'
};

// Reducer
const imageProcessingReducer = (state, action) => {
  switch (action.type) {
    case ACTION_TYPES.PROCESSING_START:
      return {
        ...state,
        status: 'processing',
        error: null,
        userMessage: null,
        aiMessage: null
      };

    case ACTION_TYPES.USER_MESSAGE_RECEIVED:
      return {
        ...state,
        status: 'processing',
        userMessage: action.payload.userMessage,
        sessionId: action.payload.sessionId,
        isWaitingForAI: true
      };

    case ACTION_TYPES.AI_MESSAGE_RECEIVED:
      return {
        ...state,
        status: 'complete',
        aiMessage: action.payload.aiMessage,
        isWaitingForAI: false
      };

    case ACTION_TYPES.PROCESSING_COMPLETE:
      return {
        ...state,
        status: 'complete',
        isWaitingForAI: false
      };

    case ACTION_TYPES.PROCESSING_ERROR:
      return {
        ...state,
        status: 'error',
        error: action.payload.error,
        isWaitingForAI: false
      };

    case ACTION_TYPES.RESET:
      return initialState;

    default:
      return state;
  }
};

/**
 * Unified Image Processing Hook
 * Single entry point for all image processing
 */
export const useImageProcessing = () => {
  const [state, dispatch] = useReducer(imageProcessingReducer, initialState);

  /**
   * Process image with unified flow
   * @param {File} file - Image file to process
   * @param {Object} options - Processing options
   */
  const processImage = useCallback(async (file, options = {}) => {
    if (!file) {
      dispatch({
        type: ACTION_TYPES.PROCESSING_ERROR,
        payload: { error: 'No file provided' }
      });
      return;
    }

    try {
      // Start processing
      dispatch({ type: ACTION_TYPES.PROCESSING_START });

      // Process image
      const result = await ImageProcessingService.processImage(file, options);

      // Handle response based on result type
      if (result.responseType === 'original_image') {
        // Response 1: Original image
        dispatch({
          type: ACTION_TYPES.USER_MESSAGE_RECEIVED,
          payload: {
            userMessage: result.userMessage,
            sessionId: result.sessionId
          }
        });

        // Process AI response in background
        setTimeout(async () => {
          try {
            const aiResult = await ImageProcessingService.processAIResponse(
              result.imageData,
              result.sessionId,
              options.model
            );

            if (aiResult.responseType === 'ai_response') {
              dispatch({
                type: ACTION_TYPES.AI_MESSAGE_RECEIVED,
                payload: {
                  aiMessage: aiResult.aiMessage
                }
              });
            } else {
            }
          } catch (error) {
            console.error('❌ AI processing error:', error);
            dispatch({
              type: ACTION_TYPES.PROCESSING_ERROR,
              payload: { error: error.message }
            });
          }
        }, 100);

      } else if (result.responseType === 'complete') {
        // Legacy single-response format
        dispatch({
          type: ACTION_TYPES.USER_MESSAGE_RECEIVED,
          payload: {
            userMessage: result.userMessage,
            sessionId: result.sessionId
          }
        });

        if (result.aiMessage) {
          dispatch({
            type: ACTION_TYPES.AI_MESSAGE_RECEIVED,
            payload: {
              aiMessage: result.aiMessage
            }
          });
        }
      }

    } catch (error) {
      console.error('❌ Image processing error:', error);
      dispatch({
        type: ACTION_TYPES.PROCESSING_ERROR,
        payload: { error: error.message }
      });
    }
  }, []);

  /**
   * Reset processing state
   */
  const reset = useCallback(() => {
    dispatch({ type: ACTION_TYPES.RESET });
  }, []);

  /**
   * Get current messages array
   */
  const messages = React.useMemo(() => {
    const messageArray = [];
    if (state.userMessage) messageArray.push(state.userMessage);
    if (state.aiMessage) messageArray.push(state.aiMessage);
    return messageArray;
  }, [state.userMessage, state.aiMessage]);

  return {
    // State
    status: state.status,
    userMessage: state.userMessage,
    aiMessage: state.aiMessage,
    sessionId: state.sessionId,
    error: state.error,
    isWaitingForAI: state.isWaitingForAI,
    messages,
    
    // Actions
    processImage,
    reset
  };
};

export default useImageProcessing;
