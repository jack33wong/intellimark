/**
 * AI Marking Service
 * Handles AI-powered homework marking with image classification and annotation generation
 */

import * as path from 'path';
import { getModelConfig } from '../config/aiModels.js';
import { ErrorHandler } from '../utils/errorHandler.js';

// Define types inline to avoid import issues
interface SimpleImageClassification {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
  extractedQuestionText?: string;
}

import { ModelType } from '../types/index.js';
import { getPrompt } from '../config/prompts.js';
import { validateModel } from '../config/aiModels.js';

interface SimpleProcessedImageResult {
  ocrText: string;
  boundingBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    confidence?: number;
  }>;
  confidence: number;
  imageDimensions: {
    width: number;
    height: number;
  };
  isQuestion?: boolean;
}

interface SimpleAnnotation {
  action: 'circle' | 'write' | 'tick' | 'cross' | 'underline' | 'comment';
  bbox: [number, number, number, number]; // [x, y, width, height]
  text?: string; // Text content for all annotation types
  reasoning?: string; // LLM-provided explanation
}

interface SimpleMarkingInstructions {
  annotations: SimpleAnnotation[];
}

// Minimal local types to pass question detection + mark scheme context without importing
interface SimpleMarkingScheme {
  id: string;
  examDetails: {
    board: string;
    qualification: string;
    paperCode: string;
    tier: string;
    paper: string;
    date: string;
  };
  questionMarks?: any;
  totalQuestions: number;
  totalMarks: number;
  confidence?: number;
}

interface SimpleExamPaperMatch {
  board: string;
  qualification: string;
  paperCode: string;
  year: string;
  questionNumber?: string;
  confidence?: number;
  markingScheme?: SimpleMarkingScheme;
}

interface SimpleQuestionDetectionResult {
  found: boolean;
  match?: SimpleExamPaperMatch;
  message?: string;
}

export class AIMarkingService {
  /**
   * Classify image as question-only or question+answer
   */
  static async classifyImage(
    imageData: string, 
    model: ModelType
  ): Promise<SimpleImageClassification> {
    const { ClassificationService } = await import('./ai/ClassificationService');
    return ClassificationService.classifyImage(imageData, model);
  }

  // Legacy per-line annotation generation removed

  // Legacy per-line coordinate calculation removed


  /**
   * NEW LLM2: Generate marking annotations based on final OCR text only (no coordinates)
   */
  static async generateMarkingAnnotationsFromText(
    model: ModelType,
    ocrText: string,
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<{
    annotations: string; // Raw AI response as string
  }> {
    const { MarkingInstructionService } = await import('./ai/MarkingInstructionService');
    return MarkingInstructionService.generateFromOCR(model, ocrText, questionDetection);
  }


  /**
   * Generate marking instructions for homework images
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: ModelType, 
    processedImage?: SimpleProcessedImageResult,
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<SimpleMarkingInstructions> {
    const { LLMOrchestrator } = await import('./ai/LLMOrchestrator');
    return LLMOrchestrator.executeMarking({
      imageData,
      model,
      processedImage: processedImage || ({} as SimpleProcessedImageResult),
      questionDetection
    });
  }

  /**
   * Generate contextual response for text-based conversations
   */
  static async generateContextualResponse(
    message: string,
    chatHistory: any[],
    model: ModelType,
    contextSummary?: string
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number }> {
    
    const systemPrompt = getPrompt('marking.contextual.system');

    // Use context summary if available, otherwise fall back to recent messages
    let contextPrompt = '';
    if (contextSummary) {
      contextPrompt = `\n\nPrevious conversation summary:\n${contextSummary}`;
    } else if (chatHistory.length > 0) {
      // For simple math problems, limit context to avoid confusion
      const isSimpleMath = /^[\d\s\+\-\*\/\(\)\.]+$/.test(message.trim());
      
      if (isSimpleMath) {
        // For simple math, use minimal context (only last 1 message)
        contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-1).map(item => `${item.role}: ${item.content}`).join('\n')}`;
      } else {
        // For complex problems, use normal context (last 3 messages)
        contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-3).map(item => `${item.role}: ${item.content}`).join('\n')}`;
      }
    }

    const userPrompt = getPrompt('marking.contextual.user', message, contextPrompt);


    try {
      const { ModelProvider } = await import('./ai/ModelProvider.js');
      const response = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'auto');
      
      // Get dynamic API name based on model
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiUsed = `Google ${modelName} (Service Account)`;
      
      return {
        response: response.content,
        apiUsed: apiUsed,
        confidence: 0.95, // Default confidence for AI responses (text mode)
        usageTokens: response.usageTokens || 0
      };
    } catch (error) {
      console.error('❌ Contextual response generation failed:', error);
      return {
        response: 'I apologize, but I encountered an error while processing your message. Please try again.',
        apiUsed: 'Error',
        confidence: 0,
        usageTokens: 0
      };
    }
  }

  /**
   * Generate chat response for question-only images or marking feedback from OCR text
   */
  static async generateChatResponse(
    imageDataOrOcrText: string,
    message: string,
    model: ModelType,
    isQuestionOnly: boolean = true,
    debug: boolean = false,
    onProgress?: (data: any) => void,
    useOcrText: boolean = false
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number }> {
    
    // Debug mode: Return mock response
    if (debug) {
      return {
        response: 'Debug mode: Mock chat response - This is a simulated AI response for testing purposes.',
        apiUsed: 'Debug Mode - Mock Response',
        confidence: 0.85,
        usageTokens: 150
      };
    }
    
    // Handle both image and OCR text inputs
    let compressedImage: string | null = null;
    let ocrText: string | null = null;
    
    if (useOcrText) {
      ocrText = imageDataOrOcrText;
    } else {
      compressedImage = await this.compressImage(imageDataOrOcrText);
    }
    
    const systemPrompt = isQuestionOnly
      ? getPrompt('marking.questionOnly.system')
      : getPrompt('modelAnswer.system')

    const userPrompt = isQuestionOnly
      ? getPrompt('marking.questionOnly.user', message)
      : getPrompt('modelAnswer.user', ocrText, message); // ocrText and schemeJson (message)


    try {
      // Call progress callback to indicate AI response generation is starting
      if (onProgress) {
        onProgress({
          currentStepDescription: 'Generating response...',
          completedSteps: ['classification', 'question_detection'],
          allSteps: [
            { id: 'classification', description: 'Analyzing image...' },
            { id: 'question_detection', description: 'Detecting question type...' },
            { id: 'ai_response', description: 'Generating response...' }
          ],
          isComplete: false
        });
      }
      
      // Validate model using centralized validation
      const validatedModel = validateModel(model);
      
      // For marking mode, always use text response (model answer)
      if (!isQuestionOnly) {
        return await this.callGeminiForTextResponse(ocrText, systemPrompt, userPrompt, validatedModel);
      } else {
        return await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt, validatedModel);
      }
    } catch (error) {
      // Check if this is our validation error (fail fast)
      if (error instanceof Error && error.message.includes('Unsupported model')) {
        // This is our validation error - re-throw it as-is
        throw error;
      }
      
      // This is a Google API error - log with proper context
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
      
      console.error(`❌ [GOOGLE API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [GOOGLE ERROR] ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Use unified error handling
      const errorInfo = ErrorHandler.analyzeError(error);
      console.log(ErrorHandler.getLogMessage(error, `chat response model: ${actualModelName}`));
      
      // Fail fast - no fallbacks
      throw error;
    }
  }

  /**
   * Generate context summary from chat history
   */
  static async generateContextSummary(chatHistory: any[]): Promise<string> {
    if (chatHistory.length === 0) {
      return '';
    }


    const conversationText = chatHistory.map(item => 
      `${item.role}: ${item.content}`
    ).join('\n');

    const summaryPrompt = `Please provide a concise summary of the following conversation. Focus on:
1. The main topic/subject being discussed
2. Key questions asked by the user
3. Important information or solutions provided
4. Current state of the conversation

Keep the summary under 200 words and maintain context for future responses.

Conversation:
${conversationText}

Summary:`;

    try {
      // Use Gemini for context summary generation
      const { ModelProvider } = await import('./ai/ModelProvider.js');
      const response = await ModelProvider.callGeminiText(
        'You are a helpful assistant that creates concise conversation summaries. Focus on key points and maintain context for future interactions.',
        summaryPrompt,
        'auto'
      );
      return response.content.trim();
    } catch (error) {
      console.error('❌ Context summary generation failed:', error);
      return '';
    }
  }

  /**
   * Call Gemini API for chat response with image
   */
  private static async callGeminiForChatResponse(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto'
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number }> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiChatRequest(accessToken, imageData, systemPrompt, userPrompt, model);
      const result = await response.json() as any;
      const content = this.extractGeminiChatContent(result);
      
      // Get dynamic API name based on model
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiUsed = `Google ${modelName} (Service Account)`;
      
      // Extract usage tokens and confidence
      const usageTokens = (result.usageMetadata?.totalTokenCount as number) || 0;
      const confidence = 0.85; // Default confidence for AI responses (question mode)
      
      return {
        response: content,
        apiUsed: apiUsed,
        confidence: confidence,
        usageTokens: usageTokens
      };
    } catch (error) {
      console.error('❌ Gemini chat response failed:', error);
      
      // Check if it's a rate limit error and fail fast
      const isRateLimitError = error instanceof Error && 
        (error.message.includes('429') || 
         error.message.includes('Too Many Requests') ||
         error.message.includes('rate limit'));
      
      if (isRateLimitError) {
        const { getModelConfig } = await import('../config/aiModels.js');
        const modelConfig = getModelConfig(model);
        const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
        const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
        console.error(`❌ [QUOTA EXCEEDED] ${modelName} (${apiVersion}) quota exceeded for chat response`);
        console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
        console.error(`❌ [ERROR DETAILS] ${error.message}`);
        throw new Error(`API quota exceeded for ${modelName} (${apiVersion}) chat response. Please check your Google Cloud Console for quota limits.`);
      }
      
      throw error;
    }
  }

  /**
   * Call Gemini API for text-only responses (no image)
   */
  private static async callGeminiForTextResponse(
    ocrText: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto'
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number }> {
    try {
      // Debug logs removed for production
      
      const { ModelProvider } = await import('./ai/ModelProvider.js');
      const result = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, false);
      
      // Get dynamic API name based on model
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiUsed = `Google ${modelName} (Service Account)`;
      
      // Extract usage tokens and confidence
      const usageTokens = result.usageTokens || 0;
      const confidence = 0.85; // Default confidence for AI responses (marking mode)
      
      return {
        response: result.content,
        apiUsed: apiUsed,
        confidence: confidence,
        usageTokens: usageTokens
      };
    } catch (error) {
      console.error('❌ Gemini text response failed:', error);
      
      // Check if it's a rate limit error and fail fast
      const isRateLimitError = error instanceof Error && 
        (error.message.includes('429') || 
         error.message.includes('Too Many Requests') ||
         error.message.includes('rate limit'));
      
      if (isRateLimitError) {
        const { getModelConfig } = await import('../config/aiModels.js');
        const modelConfig = getModelConfig(model);
        const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
        const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
        console.error(`❌ [QUOTA EXCEEDED] ${modelName} (${apiVersion}) quota exceeded for text response`);
        console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
        console.error(`❌ [ERROR DETAILS] ${error.message}`);
        throw new Error(`API quota exceeded for ${modelName} (${apiVersion}) text response. Please check your Google Cloud Console for quota limits.`);
      }
      
      throw error;
    }
  }

  private static async callGeminiImageGenForChatResponse(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    modelType: string = 'auto'
  ): Promise<{ response: string; apiUsed: string }> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiImageGenChatRequest(accessToken, imageData, systemPrompt, userPrompt, modelType);
      const result = await response.json() as any;
      const content = this.extractGeminiChatContent(result);
      
      // Get dynamic API name based on model
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(modelType as ModelType);
      const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || modelType;
      const apiUsed = `Google ${modelName} (Service Account)`;
      
      return {
        response: content,
        apiUsed
      };
    } catch (error) {
      console.error('❌ Gemini Image Gen chat response failed:', error);
      throw error;
    }
  }


  private static async getGeminiAccessToken(): Promise<string> {
    const { GoogleAuth } = await import('google-auth-library');
    
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || './intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json';
    
    const auth = new GoogleAuth({
      keyFile,
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/generative-language.retriever'
      ]
    });
    
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    
    if (!accessToken.token) {
      throw new Error('Failed to get access token from service account');
    }
    
    return accessToken.token;
  }

  private static async makeGeminiChatRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<Response> {
    // Use centralized model configuration
    const { getModelConfig } = await import('../config/aiModels.js');
    const config = getModelConfig(model);
    const endpoint = config.apiEndpoint;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt },
            { text: userPrompt },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: imageData.split(',')[1]
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8000, // Use centralized config
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
      
      console.error(`❌ [GEMINI CHAT API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [HTTP STATUS] ${response.status} ${response.statusText}`);
      console.error(`❌ [ERROR DETAILS] ${errorText}`);
      
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} for ${actualModelName} (${apiVersion}) - ${errorText}`);
    }

    return response;
  }

  private static async makeGeminiImageGenChatRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    modelType: string = 'auto'
  ): Promise<Response> {
    // Use centralized model configuration
    const { getModelConfig } = await import('../config/aiModels.js');
    const config = getModelConfig(modelType as any);
    const endpoint = config.apiEndpoint;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt },
            { text: userPrompt },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: imageData.split(',')[1]
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8000, // Use centralized config
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini Image Gen API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }


  private static async exponentialBackoff(maxRetries: number): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s, 8s...
      console.log(`⏳ [BACKOFF] Waiting ${delay}ms before retry ${i + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }


  private static extractGeminiChatContent(result: any): string {
    // Check if this is an error response first
    if (result.error) {
      console.error('❌ [DEBUG] Gemini API returned error response:', result.error);
      throw new Error(`Gemini API error: ${result.error.message || 'Unknown error'}`);
    }
    
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      console.error('❌ [DEBUG] No content found in Gemini response');
      console.error('❌ [DEBUG] Response structure:', {
        hasCandidates: !!result.candidates,
        candidatesLength: result.candidates?.length,
        firstCandidate: result.candidates?.[0],
        hasContent: !!result.candidates?.[0]?.content,
        hasParts: !!result.candidates?.[0]?.content?.parts,
        partsLength: result.candidates?.[0]?.content?.parts?.length,
        firstPart: result.candidates?.[0]?.content?.parts?.[0]
      });
      
      // Check for safety filters or other issues
      const finishReason = result.candidates?.[0]?.finishReason;
      if (finishReason) {
        console.error('❌ [DEBUG] Finish reason:', finishReason);
        
        // Handle MAX_TOKENS specifically
        if (finishReason === 'MAX_TOKENS') {
          console.error('❌ [MAX_TOKENS] Response truncated due to token limit. Consider using a model with higher limits or reducing prompt length.');
          throw new Error(`Response truncated due to token limit. The model response was too long and got cut off. Consider using a model with higher token limits for longer responses.`);
        }
      }
      
      throw new Error(`No content in Gemini response. Finish reason: ${finishReason || 'unknown'}`);
    }

    return content;
  }


  // Text-only response helpers removed; use ModelProvider instead

  /**
   * Compress image data to reduce API payload size
   */
  private static async compressImage(imageData: string): Promise<string> {
    // Image enhancement is now handled in ClassificationService
    // Return original image data to avoid double processing
    return imageData;
  }
}
