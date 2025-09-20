/**
 * Custom hook for image upload functionality
 * Handles file selection, preview, and base64 conversion
 */

import { useState, useCallback } from 'react';

export const useImageUpload = () => {
  const [selectedFile, setSelectedFile] = useState(null);

  // Convert file to base64
  const fileToBase64 = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback((file) => {
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
    } else {
      console.warn('Please select a valid image file');
    }
  }, []);

  // Clear file selection
  const clearFile = useCallback(() => {
    setSelectedFile(null);
  }, []);


  // Process image (convert to base64)
  const processImage = useCallback(async (file) => {
    if (!file) return null;
    
    try {
      const imageData = await fileToBase64(file);
      return imageData;
    } catch (error) {
      console.error('Error processing image:', error);
      throw error;
    }
  }, [fileToBase64]);

  return {
    selectedFile,
    handleFileSelect,
    clearFile,
    processImage,
    fileToBase64
  };
};
