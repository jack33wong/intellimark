/**
 * Custom hook for mark homework functionality
 * Handles image analysis, API calls, and result processing
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import API_CONFIG from '../config/api';

export const useMarkHomework = () => {
  const { getAuthToken } = useAuth();
  
  // State
  const [isProcessing, setIsProcessing] = useState(false);
  const [classificationResult, setClassificationResult] = useState(null);
  const [markingResult, setMarkingResult] = useState(null);
  const [error, setError] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Handle fake loading progress when processing
  useEffect(() => {
    let progressInterval;
    if (isProcessing) {
      setLoadingProgress(0);
      progressInterval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 95) return 95; // Stop at 95% until processing is complete
          return prev + Math.random() * 15; // Random increment between 0-15
        });
      }, 200); // Update every 200ms
    } else {
      setLoadingProgress(100); // Complete the progress bar
      setTimeout(() => setLoadingProgress(0), 500); // Reset after animation
    }
    
    return () => {
      if (progressInterval) clearInterval(progressInterval);
    };
  }, [isProcessing]);

  // Analyze image through mark homework API (Response 1: Original Image)
  const analyzeImage = useCallback(async (imageData, model = 'chatgpt-4o', sessionId = null) => {
    if (!imageData) return null;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      // Prepare request payload
      const payload = {
        imageData: imageData,
        model: model,
        ...(sessionId && { sessionId: sessionId }) // Include sessionId if provided
      };

      const apiUrl = API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.MARK_HOMEWORK;

      // Get authentication token
      const authToken = await getAuthToken();
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add authorization header if token is available
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Make API call
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('🔍 DEBUG: analyzeImage API response', { 
        responseType: result.responseType, 
        success: result.success,
        hasUserMessage: !!result.userMessage,
        sessionId: result.sessionId
      });

      // Check if this is the new 2-response format
      if (result.responseType === 'original_image') {
        // Response 1: Original image (authenticated users)
        return {
          responseType: 'original_image',
          userMessage: result.userMessage,
          sessionId: result.sessionId,
          sessionTitle: result.sessionTitle,
          processing: result.processing
        };
      } else {
        // Legacy format (unauthenticated users)
        if (result.isQuestionOnly) {
          setClassificationResult({
            isQuestionOnly: true,
            reasoning: result.reasoning,
            apiUsed: result.apiUsed,
            questionDetection: result.questionDetection
          });
          setMarkingResult(null);
        } else {
          setMarkingResult({
            instructions: result.instructions,
            annotatedImage: result.annotatedImage,
            classification: result.classification,
            metadata: result.metadata,
            apiUsed: result.apiUsed,
            ocrMethod: result.ocrMethod
          });
          setClassificationResult(null);
        }
        return result;
      }

    } catch (error) {
      console.error('Error analyzing image:', error);
      setError(error.message || 'Failed to analyze image. Please try again.');
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [getAuthToken]);

  // Process AI response (Response 2: AI Processing)
  const processAIResponse = useCallback(async (imageData, model = 'chatgpt-4o', sessionId) => {
    console.log('🔍 DEBUG: processAIResponse called', { imageData: !!imageData, sessionId, model });
    
    if (!imageData || !sessionId) {
      console.log('❌ DEBUG: processAIResponse missing parameters', { imageData: !!imageData, sessionId });
      return null;
    }
    
    try {
      const payload = {
        imageData: imageData,
        model: model,
        sessionId: sessionId
      };

      const apiUrl = API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.MARK_HOMEWORK + '/process';

      // Get authentication token
      const authToken = await getAuthToken();
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add authorization header if token is available
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Make API call
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ AI Processing Error:', errorText);
        throw new Error(`AI processing failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('🔍 DEBUG: processAIResponse API response', { 
        responseType: result.responseType, 
        success: result.success,
        hasAiMessage: !!result.aiMessage
      });

      if (result.responseType === 'ai_response') {
        // Process marking result if available
        if (result.markingResult) {
          setMarkingResult({
            instructions: result.markingResult.instructions,
            annotatedImage: result.markingResult.annotatedImage,
            classification: result.markingResult.classification,
            metadata: result.markingResult.metadata,
            apiUsed: result.markingResult.apiUsed,
            ocrMethod: result.markingResult.ocrMethod
          });
        }

        if (result.isQuestionOnly) {
          setClassificationResult({
            isQuestionOnly: true,
            apiUsed: result.aiMessage.metadata?.apiUsed,
            questionDetection: result.questionDetection
          });
        }

        const returnValue = {
          responseType: 'ai_response',
          aiMessage: result.aiMessage,
          sessionId: result.sessionId,
          isQuestionOnly: result.isQuestionOnly,
          markingResult: result.markingResult
        };
        console.log('🔍 DEBUG: processAIResponse returning', returnValue);
        return returnValue;
      }

      console.log('🔍 DEBUG: processAIResponse returning result', result);
      return result;

    } catch (error) {
      console.error('Error processing AI response:', error);
      setError(error.message);
      return null;
    }
  }, [getAuthToken]);

  // Clear results
  const clearResults = useCallback(() => {
    setClassificationResult(null);
    setMarkingResult(null);
    setError(null);
    setLoadingProgress(0);
  }, []);

  // Get image source helper
  const getImageSrc = useCallback((imageData) => {
    if (!imageData) return null;
    
    // If it's already a data URL (base64), return as is
    if (imageData.startsWith('data:')) {
      return imageData;
    }
    
    // If it's a Firebase Storage URL, we need to handle it differently
    // For now, return the URL as is - the browser should handle it
    // In production, you might want to add authentication headers
    return imageData;
  }, []);

  return {
    // State
    isProcessing,
    classificationResult,
    markingResult,
    error,
    loadingProgress,
    
    // Actions
    analyzeImage,
    processAIResponse,
    clearResults,
    getImageSrc,
    
    // Setters for external control
    setMarkingResult,
    setError
  };
};
