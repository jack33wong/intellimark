/**
 * Unified Marking Service
 * 
 * PURPOSE: Single source of truth for all marking, question, and chat processing
 * REPLACES: All duplicate logic across multiple endpoints
 * 
 * DESIGN PRINCIPLES:
 * - Fail fast: Clear errors, no fallbacks
 * - Simple: One service, one endpoint, clear parameters
 * - DRY: No code duplication
 * - Consistent: Same behavior across all flows
 */

import { MarkHomeworkWithAnswer } from './marking/MarkHomeworkWithAnswer.js';
import { AIMarkingService } from './aiMarkingService.js';
import { ImageStorageService } from './imageStorageService.js';
import { FirestoreService } from './firestoreService.js';
import { getDefaultModel } from '../config/aiModels.js';
import type { Request } from 'express';
import type { ModelType } from '../types/index.js';

interface AuthData {
  userId: string;
  userEmail: string;
  isAuthenticated: boolean;
}

interface RequestData {
  imageData?: string;
  message?: string;
  sessionId?: string;
  model: string;
  mode: string;
  flowType: string;
  isFollowUp: boolean;
  auth: AuthData;
  imageLinks?: {
    original?: string;
    annotated?: string;
  };
}

interface ProcessingResult {
  message?: string;
  isQuestionOnly?: boolean;
  sessionTitle?: string;
  progressData?: any;
  metadata?: any;
  annotatedImage?: string;
  imageLinks?: {
    original?: string;
    annotated?: string;
  };
  [key: string]: any; // Allow additional properties from MarkHomeworkWithAnswer
}

interface SessionResult {
  result: ProcessingResult;
  session: any;
}

interface UnifiedResponse {
  success: boolean;
  flowType: string;
  isAuthenticated: boolean;
  result: {
    message: string;
    isQuestionOnly: boolean;
    sessionTitle: string;
    progressData?: any;
    metadata?: any;
    imageLink?: string;
    imageData?: string;
  };
  session?: any;
}

class UnifiedMarkingService {
  /**
   * Main processing method - handles all flows
   */
  static async processRequest(req: Request, options: { onProgress?: (data: any) => void } = {}): Promise<UnifiedResponse> {
    try {
      // Extract and validate request data
      const requestData = this.extractRequestData(req, options);
      
      // Process based on flow type
      let result: ProcessingResult;
      if (requestData.flowType === 'text') {
        result = await this.processTextFlow(requestData, options.onProgress);
      } else {
        result = await this.processImageFlow(requestData, options.onProgress);
      }
      
      // Update requestData with imageLinks for session management
      if (result.imageLinks) {
        requestData.imageLinks = result.imageLinks;
      }
      
      // Handle session management
      const sessionResult = await this.handleSessionManagement(result, requestData);
      
      // Format unified response
      return this.formatResponse(sessionResult, requestData);
      
    } catch (error: any) {
      console.error('❌ UnifiedMarkingService error:', error);
      throw error; // Fail fast - no fallbacks
    }
  }

  /**
   * Extract and validate request data
   */
  static extractRequestData(req: Request, options: any): RequestData {
    const { imageData, message, sessionId, model = 'auto', mode = 'auto' } = req.body;
    
    // Extract authentication
    const auth: AuthData = {
      userId: (req as any).user?.uid || 'anonymous',
      userEmail: (req as any).user?.email || 'anonymous@example.com',
      isAuthenticated: !!(req as any).user?.uid
    };
    
    // Validate model
    const validatedModel = this.validateModel(model);
    
    // Determine flow type
    const flowType = this.determineFlowType(imageData, message);
    
    // Determine processing mode
    const processingMode = this.determineProcessingMode(mode, flowType);
    
    // Determine if follow-up
    const isFollowUp = !!sessionId && !sessionId.startsWith('temp-');
    
    return {
      imageData,
      message,
      sessionId,
      model: validatedModel,
      mode: processingMode,
      flowType,
      isFollowUp,
      auth,
      ...options
    };
  }

  /**
   * Validate and resolve model
   */
  static validateModel(model: string): string {
    const validModels = ['auto', 'gemini-2.5-pro', 'gemini-2.0-flash'];
    
    if (!validModels.includes(model)) {
      throw new Error(`Invalid model: ${model}. Valid models: ${validModels.join(', ')}`);
    }
    
    if (model === 'auto') {
      return getDefaultModel();
    }
    
    return model;
  }

  /**
   * Determine flow type based on input
   */
  static determineFlowType(imageData?: string, message?: string): string {
    if (imageData && message) {
      return 'image_with_text';
    } else if (imageData) {
      return 'image_only';
    } else if (message) {
      return 'text';
    } else {
      throw new Error('Either imageData or message is required');
    }
  }

  /**
   * Determine processing mode
   */
  static determineProcessingMode(mode: string, flowType: string): string {
    if (mode === 'auto') {
      // Auto-detect based on flow type
      return flowType === 'text' ? 'chat' : 'marking';
    }
    
    const validModes = ['marking', 'question', 'chat'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Valid modes: ${validModes.join(', ')}`);
    }
    
    return mode;
  }

  /**
   * Process text-only flow
   */
  static async processTextFlow(requestData: RequestData, onProgress?: (data: any) => void): Promise<ProcessingResult> {
    const { message, model, auth } = requestData;
    
    if (!message) {
      throw new Error('Message is required for text flow');
    }
    
    // Generate AI response for text-only
    const chatResponse = await AIMarkingService.generateContextualResponse(
      message,
      [], // No chat history for now
      model as ModelType
    );
    
    return {
      message: chatResponse,
      isQuestionOnly: true,
      sessionTitle: 'Chat Session',
      progressData: {
        isComplete: true,
        currentStepIndex: 2,
        allSteps: ['Processing your question...', 'Generating response...'],
        completedStepIndices: [0, 1]
      },
      metadata: { flowType: 'text' }
    };
  }

  /**
   * Process image-based flow
   */
  static async processImageFlow(requestData: RequestData, onProgress?: (data: any) => void): Promise<ProcessingResult> {
    const { imageData, message, model, auth, mode, flowType } = requestData;
    
    if (!imageData) {
      throw new Error('ImageData is required for image flow');
    }
    
    let result: ProcessingResult;
    
    if (flowType === 'image_with_text' && message) {
      // Handle image + text submission using marking service for proper annotated images
      console.log('🔄 Processing image + text submission with marking service');
      result = await MarkHomeworkWithAnswer.run({
        imageData,
        model: model as ModelType,
        userId: auth.userId,
        userEmail: auth.userEmail,
        onProgress: onProgress,
        customMessage: message // Pass the user's text message
      });
    } else {
      // Handle image-only submission using existing flow
      console.log('🔄 Processing image-only submission');
      result = await MarkHomeworkWithAnswer.run({
        imageData,
        model: model as ModelType,
        userId: auth.userId,
        userEmail: auth.userEmail,
        onProgress: onProgress
      });
    }
    
    // Handle image uploads for authenticated users
    let imageLinks = {};
    if (auth.isAuthenticated) {
      imageLinks = await this.handleImageUploads(result, requestData);
    }
    
    return {
      ...result,
      imageLinks,
      metadata: { 
        ...result.metadata,
        flowType: requestData.flowType,
        processingMode: mode
      }
    };
  }

  /**
   * Handle image uploads for authenticated users
   */
  static async handleImageUploads(result: any, requestData: RequestData): Promise<any> {
    const { auth, sessionId } = requestData;
    const imageLinks: any = {};
    
    try {
      // Upload original image
      if (requestData.imageData) {
        imageLinks.original = await ImageStorageService.uploadImage(
          requestData.imageData,
          auth.userId,
          sessionId || `temp-${Date.now()}`,
          'original'
        );
      }
      
      // Upload annotated image (if marking mode)
      if (!result.isQuestionOnly && result.annotatedImage) {
        imageLinks.annotated = await ImageStorageService.uploadImage(
          result.annotatedImage,
          auth.userId,
          sessionId || `temp-${Date.now()}`,
          'annotated'
        );
      }
    } catch (error: any) {
      console.error('❌ Image upload failed:', error);
      // Fail fast - don't continue if image upload fails
      throw new Error(`Image upload failed: ${error.message}`);
    }
    
    return imageLinks;
  }

  /**
   * Handle session management
   */
  static async handleSessionManagement(result: ProcessingResult, requestData: RequestData): Promise<SessionResult> {
    const { auth, sessionId, isFollowUp, message, imageData } = requestData;
    
    if (!auth.isAuthenticated) {
      // Unauthenticated users - no session management
      return { result, session: null };
    }
    
    // Create user message
    const userMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: message || 'I have a question about this image.',
      timestamp: new Date().toISOString(),
      imageLink: requestData.imageLinks?.original,
      imageData: !auth.isAuthenticated ? imageData : undefined,
      metadata: { flowType: requestData.flowType }
    };
    
    // Create AI message
    // Strip progress data for database persistence - keep only allSteps
    const strippedProgressData = result.progressData ? {
      allSteps: result.progressData.allSteps || []
    } : null;

    const aiMessage = {
      id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'assistant',
      content: result.message,
      timestamp: new Date().toISOString(),
      type: result.isQuestionOnly ? 'question_response' : 'marking_annotated',
      imageLink: requestData.imageLinks?.annotated,
      imageData: !auth.isAuthenticated && result.annotatedImage ? result.annotatedImage : undefined,
      progressData: strippedProgressData,
      metadata: result.metadata || {}
    };
    
    let session;
    if (isFollowUp) {
      // Add messages to existing session
      await FirestoreService.addMessageToUnifiedSession(sessionId!, userMessage);
      await FirestoreService.addMessageToUnifiedSession(sessionId!, aiMessage);
      
      // Load updated session
      session = await FirestoreService.getUnifiedSession(sessionId!);
    } else {
      // Create new session
      const newSessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      session = await FirestoreService.createUnifiedSessionWithMessages({
        sessionId: newSessionId,
        title: result.sessionTitle || 'Processing Session',
        userId: auth.userId,
        messageType: result.isQuestionOnly ? 'Question' : 'Marking',
        messages: [userMessage, aiMessage]
      });
    }
    
    return { result, session };
  }

  /**
   * Format unified response
   */
  static formatResponse(sessionResult: SessionResult, requestData: RequestData): UnifiedResponse {
    const { result, session } = sessionResult;
    const { auth, flowType } = requestData;
    
    const response: UnifiedResponse = {
      success: true,
      flowType,
      isAuthenticated: auth.isAuthenticated,
      result: {
        message: result.message,
        isQuestionOnly: result.isQuestionOnly,
        sessionTitle: result.sessionTitle,
        progressData: result.progressData,
        metadata: result.metadata
      }
    };
    
    // Add image data based on authentication
    if (flowType !== 'text') {
      if (auth.isAuthenticated) {
        response.result.imageLink = requestData.imageLinks?.annotated;
      } else {
        response.result.imageData = result.annotatedImage;
      }
    }
    
    // Add session data for authenticated users
    if (auth.isAuthenticated && session) {
      response.session = session;
    }
    
    return response;
  }
}

export { UnifiedMarkingService };
