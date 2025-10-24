/**
 * AI Marking Service
 * Handles AI-powered homework marking with image classification and annotation generation
 */

import * as path from 'path';
import { getModelConfig } from '../../config/aiModels.js';
import { ErrorHandler } from '../../utils/errorHandler.js';


import { 
  ModelType, 
  ImageClassification, 
  ProcessedImageResult, 
  Annotation, 
  MarkingInstructions 
} from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import { validateModel } from '../../config/aiModels.js';


export class MarkingServiceLocator {
  /**
   * Classify image as question-only or question+answer
   */
  static async classifyImage(
    imageData: string, 
    model: ModelType
  ): Promise<ImageClassification> {
    const { ClassificationService } = await import('./ClassificationService');
    return ClassificationService.classifyImage(imageData, model);
  }



  /**
   * Generate marking instructions for homework images
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: ModelType, 
    processedImage?: ProcessedImageResult,
    questionDetection?: any
  ): Promise<MarkingInstructions> {
      const { MarkingInstructionService } = await import('./MarkingInstructionService');
    return MarkingInstructionService.executeMarking({
      imageData,
      model,
      processedImage: processedImage || ({} as ProcessedImageResult),
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
      // Always provide context - let the AI decide what's relevant
      contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-3).map(item => `${item.role}: ${item.content}`).join('\n')}`;
      console.log('🔍 DEBUG: Providing context, AI will determine relevance');
    }

    const userPrompt = getPrompt('marking.contextual.user', message, contextPrompt);

    // E2E DEBUG: Before external API call
    console.log('🔍 E2E DEBUG: About to call external AI API:');
    console.log('🔍 E2E DEBUG: - systemPrompt:', systemPrompt);
    console.log('🔍 E2E DEBUG: - userPrompt:', userPrompt);
    console.log('🔍 E2E DEBUG: - model:', model);
    console.log('🔍 E2E DEBUG: - contextPrompt length:', contextPrompt.length);

    try {
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const response = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'auto');
      
      // E2E DEBUG: AI response received
      console.log('🔍 E2E DEBUG: AI API response received:');
      console.log('🔍 E2E DEBUG: - response:', response.content);
      console.log('🔍 E2E DEBUG: - response length:', response.content.length);
      
      const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
      const apiUsed = `Google ${modelInfo.modelName} (Service Account)`;
      
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
      compressedImage = imageDataOrOcrText;
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
      const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
      
      console.error(`❌ [GOOGLE API ERROR] Failed with model: ${modelInfo.modelName} (${modelInfo.apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelInfo.config.apiEndpoint}`);
      console.error(`❌ [GOOGLE ERROR] ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Use unified error handling
      const errorInfo = ErrorHandler.analyzeError(error);
      console.log(ErrorHandler.getLogMessage(error, `chat response model: ${modelInfo.modelName}`));
      
      // Fail fast - no fallbacks
      throw error;
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
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const accessToken = await ModelProvider.getGeminiAccessToken();
      const response = await this.makeGeminiChatRequest(accessToken, imageData, systemPrompt, userPrompt, model);
      const result = await response.json() as any;
      const content = this.extractGeminiChatContent(result);
      
      const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
      const apiUsed = `Google ${modelInfo.modelName} (Service Account)`;
      
      return {
        response: content,
        apiUsed: apiUsed,
        confidence: 0.85, // Default confidence for AI responses (question mode)
        usageTokens: (result.usageMetadata?.totalTokenCount as number) || 0
      };
    } catch (error) {
      console.error('❌ Gemini chat response failed:', error);
      
      const errorInfo = ErrorHandler.analyzeError(error);
      if (errorInfo.isRateLimit) {
        const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
        console.error(`❌ [QUOTA EXCEEDED] ${modelInfo.modelName} (${modelInfo.apiVersion}) quota exceeded for chat response`);
        console.error(`❌ [API ENDPOINT] ${modelInfo.config.apiEndpoint}`);
        console.error(`❌ [ERROR DETAILS] ${error.message}`);
        throw new Error(`API quota exceeded for ${modelInfo.modelName} (${modelInfo.apiVersion}) chat response. Please check your Google Cloud Console for quota limits.`);
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
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const result = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, false);
      
      const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
      const apiUsed = `Google ${modelInfo.modelName} (Service Account)`;
      
      return {
        response: result.content,
        apiUsed: apiUsed,
        confidence: 0.85, // Default confidence for AI responses (marking mode)
        usageTokens: result.usageTokens || 0
      };
    } catch (error) {
      console.error('❌ Gemini text response failed:', error);
      
      const errorInfo = ErrorHandler.analyzeError(error);
      if (errorInfo.isRateLimit) {
        const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
        console.error(`❌ [QUOTA EXCEEDED] ${modelInfo.modelName} (${modelInfo.apiVersion}) quota exceeded for text response`);
        console.error(`❌ [API ENDPOINT] ${modelInfo.config.apiEndpoint}`);
        console.error(`❌ [ERROR DETAILS] ${error.message}`);
        throw new Error(`API quota exceeded for ${modelInfo.modelName} (${modelInfo.apiVersion}) text response. Please check your Google Cloud Console for quota limits.`);
      }
      
      throw error;
    }
  }
  private static async makeGeminiChatRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<Response> {
    const { getModelInfo } = await import('../../config/aiModels.js');
    const modelInfo = getModelInfo(model);
    
    const response = await fetch(modelInfo.config.apiEndpoint, {
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
          maxOutputTokens: modelInfo.config.maxTokens, // Use centralized config
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      console.error(`❌ [GEMINI CHAT API ERROR] Failed with model: ${modelInfo.modelName} (${modelInfo.apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelInfo.config.apiEndpoint}`);
      console.error(`❌ [HTTP STATUS] ${response.status} ${response.statusText}`);
      console.error(`❌ [ERROR DETAILS] ${errorText}`);
      
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} for ${modelInfo.modelName} (${modelInfo.apiVersion}) - ${errorText}`);
    }

    return response;
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



}
