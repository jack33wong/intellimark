/**
 * Unified Image Processing Service
 * Single entry point for ALL image processing
 * Handles both authenticated and unauthenticated users
 * Returns consistent result structure
 */

import ApiClient from './apiClient';
import { 
  validateFile, 
  validateModel, 
  validateApiResponse, 
  validateProcessingOptions,
  validateSessionId
} from '../utils/validation';

class ImageProcessingService {
  /**
   * Process image with unified flow
   * @param {File} file - Image file to process
   * @param {Object} options - Processing options
   * @returns {Promise<ProcessingResult>} - Consistent result structure
   */
  static async processImage(file, options = {}) {
    // Fail fast on invalid inputs
    validateFile(file);
    validateProcessingOptions(options);
    
    const { model = 'chatgpt-4o', sessionId = null, isFollowUp = false } = options;
    
    try {
      // Convert image to base64
      const imageData = await this.convertToBase64(file);
      
      // Process image through unified API
      const result = await this.processImageData(imageData, {
        model,
        sessionId,
        isFollowUp
      });
      
      return result;
    } catch (error) {
      console.error('❌ ImageProcessingService.processImage error:', error);
      throw error;
    }
  }

  /**
   * Convert file to base64
   * @param {File} file - File to convert
   * @returns {Promise<string>} - Base64 string
   */
  static convertToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Process image data through API
   * @param {string} imageData - Base64 image data
   * @param {Object} options - Processing options
   * @returns {Promise<ProcessingResult>} - Processing result
   */
  static async processImageData(imageData, options = {}) {
    // Fail fast on invalid inputs
    if (!imageData || typeof imageData !== 'string') {
      throw new Error('Invalid image data: must be a non-empty string');
    }
    
    validateProcessingOptions(options);
    
    const { model, sessionId, isFollowUp } = options;
    
    try {
      // Call unified API endpoint
      const response = await ApiClient.post('/api/process', {
        imageData,
        model,
        sessionId,
        isFollowUp
      });

      // Validate API response structure
      validateApiResponse(response);

      return response.data;
    } catch (error) {
      console.error('❌ ImageProcessingService.processImageData error:', error);
      throw error;
    }
  }

  /**
   * Process AI response (Response 2)
   * @param {string} imageData - Base64 image data
   * @param {string} sessionId - Session ID
   * @param {string} model - AI model
   * @returns {Promise<ProcessingResult>} - AI response result
   */
  static async processAIResponse(imageData, sessionId, model = 'chatgpt-4o') {
    // Fail fast on invalid inputs
    if (!imageData || typeof imageData !== 'string') {
      throw new Error('Invalid image data: must be a non-empty string');
    }
    
    validateSessionId(sessionId);
    validateModel(model);
    
    try {
      const response = await ApiClient.post('/api/process/ai', {
        imageData,
        sessionId,
        model
      });

      // Validate API response structure
      validateApiResponse(response, 'ai_response');

      return response.data;
    } catch (error) {
      console.error('❌ ImageProcessingService.processAIResponse error:', error);
      throw error;
    }
  }
}

export default ImageProcessingService;
