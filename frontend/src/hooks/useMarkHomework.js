/**
 * Custom hook for mark homework functionality
 * Handles image analysis, API calls, and result processing
 */

import { useState, useCallback } from 'react';
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

  // Analyze image through mark homework API
  const analyzeImage = useCallback(async (imageData, model = 'chatgpt-4o') => {
    if (!imageData) return null;
    
    setIsProcessing(true);
    setError(null);
    setLoadingProgress(0);
    
    try {
      // Prepare request payload
      const payload = {
        imageData: imageData,
        model: model
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

      setLoadingProgress(25);

      // Make API call
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      setLoadingProgress(50);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      setLoadingProgress(75);

      // Process result based on type
      if (result.isQuestionOnly) {
        // Question-only image
        setClassificationResult({
          isQuestionOnly: true,
          reasoning: result.reasoning,
          apiUsed: result.apiUsed,
          questionDetection: result.questionDetection
        });
        
        setMarkingResult(null);
      } else {
        // Marking result
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

      setLoadingProgress(100);
      return result;

    } catch (error) {
      console.error('Error analyzing image:', error);
      setError(error.message || 'Failed to analyze image. Please try again.');
      throw error;
    } finally {
      setIsProcessing(false);
      setLoadingProgress(0);
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
    clearResults,
    getImageSrc,
    
    // Setters for external control
    setMarkingResult,
    setError
  };
};
