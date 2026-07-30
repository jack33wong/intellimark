/**
 * AI Marking Service
 * Handles AI-powered homework marking with image classification and annotation generation
 */

import * as path from 'path';
import UsageTracker from '../../utils/UsageTracker.js';
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
    contextSummary?: string,
    tracker?: UsageTracker, // UsageTracker
    mode?: string // NEW: Current chat mode (model-answer, marking-scheme, etc)
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number; inputTokens: number; outputTokens: number }> {

    let systemPrompt = getPrompt('marking.contextual.system');

    // [MODE-AWARENESS] Inject mode flag for the prompt selector
    if (mode === 'model-answer') {
      systemPrompt += `\n\n[MODE: MODEL ANSWER]`;
    } else if (mode === 'marking-scheme') {
      systemPrompt += `\n\n[MODE: MARKING SCHEME]`;
    }

    // Use context summary if available
    let contextPrompt = '';
    if (contextSummary) {
      contextPrompt = `\n\nPrevious conversation summary:\n${contextSummary}`;
    } else if (chatHistory.length > 0) {
      contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-3).map(item => `${item.role}: ${item.content}`).join('\n')}`;
    }

    const userPrompt = getPrompt('marking.contextual.user', message, contextPrompt);

    try {
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      // Pass tracker and phase to get real token counts
      const response = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, false, tracker, 'questionMode');

      const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
      const apiUsed = `Google ${modelInfo.modelName} (Vertex AI)`;

      // ModelProvider now returns tokens from Gemini's usageMetadata
      const inputTokens = response.inputTokens || Math.floor((response.usageTokens || 0) * 0.8);
      const outputTokens = response.outputTokens || Math.ceil((response.usageTokens || 0) * 0.2);

      return {
        response: response.content,
        apiUsed: apiUsed,
        confidence: 0.95, // Default confidence for AI responses (text mode)
        usageTokens: response.usageTokens || 0,
        inputTokens,
        outputTokens
      };
    } catch (error) {
      console.error('❌ Contextual response generation failed:', error);
      return {
        response: 'I apologize, but I encountered an error while processing your message. Please try again.',
        apiUsed: 'Error',
        confidence: 0,
        usageTokens: 0,
        inputTokens: 0,
        outputTokens: 0
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
    category: "questionOnly" | "questionAnswer" | "metadata" | "frontPage" = "questionOnly",
    debug: boolean = false,
    onProgress?: (data: any) => void,
    useOcrText: boolean = false,
    tracker?: UsageTracker,  // UsageTracker (optional)
    markingScheme?: string  // NEW: Marking scheme for model answer generation
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number; inputTokens?: number; outputTokens?: number }> {

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

    const isQuestionOnly = category === "questionOnly";
    const systemPrompt = isQuestionOnly
      ? getPrompt('marking.questionOnly.system')
      : getPrompt('modelAnswer.system')

    const userPrompt = isQuestionOnly
      // If no marking scheme (detection failed), use default message which instructs AI to solve without scheme
      ? getPrompt('marking.questionOnly.user', message, markingScheme || 'No marking scheme available. Solve as a mathematician.')
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

      // Both marking mode and question mode use text-only responses (no image sent to AI)
      // For Question Mode: message contains question text from database
      // For Marking Mode: ocrText contains student work
      const textInput = isQuestionOnly ? message : ocrText;

      return await this.callGeminiForTextResponse(textInput, systemPrompt, userPrompt, validatedModel, tracker, category);
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
    model: ModelType = 'gemini-2.5-flash',
    tracker?: any
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
    try {
      // Check if model is OpenAI - route to OpenAI API instead
      const isOpenAI = model.toString().startsWith('openai-');

      if (isOpenAI) {
        // Use OpenAI Chat API for OpenAI models
        // Question Mode doesn't need JSON format (prompts don't mention "json")
        const { ModelProvider } = await import('../../utils/ModelProvider.js');
        const openaiModelName = model.toString().replace('openai-', '');
        const result = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData, openaiModelName, false, tracker, 'marking'); // false = no JSON format

        return {
          response: result.content,
          apiUsed: `OpenAI ${result.modelName}`,
          confidence: 0.85,
          usageTokens: result.usageTokens || 0,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens
        };
      }

      // Use Gemini API for Gemini models
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      
      const result = await ModelProvider.callGeminiChat(systemPrompt, userPrompt, imageData, model, tracker, 'marking');
      
      const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
      const apiUsed = `Google ${modelInfo.modelName} (Vertex AI)`;

      return {
        response: result.content,
        apiUsed: apiUsed,
        confidence: 0.85,
        usageTokens: result.usageTokens,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
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
    model: ModelType = 'gemini-2.5-flash',
    tracker?: any,
    category?: "questionOnly" | "questionAnswer" | "metadata" | "frontPage"
  ): Promise<{ response: string; apiUsed: string; confidence: number; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
    try {
      // Check if model is OpenAI - route to OpenAI API instead
      const isOpenAI = model.toString().startsWith('openai-');

      if (isOpenAI) {
        // Use OpenAI Text API for OpenAI models
        const { ModelProvider } = await import('../../utils/ModelProvider.js');
        const openaiModelName = model.toString().replace('openai-', '');
        const result = await ModelProvider.callOpenAIText(systemPrompt, userPrompt, openaiModelName, false, tracker, 'marking');

        return {
          response: result.content,
          apiUsed: `OpenAI ${openaiModelName}`,
          confidence: 0.85,
          usageTokens: result.usageTokens || 0,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens
        };
      }

      // Use Gemini API for Gemini models
      const { ModelProvider } = await import('../../utils/ModelProvider.js');

      // Determine correct phase for token tracking based on category
      const isQuestionOnly = category === "questionOnly";
      const phase = isQuestionOnly ? 'questionMode' : 'marking';

      const result = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, false, tracker, phase);

      const { getModelInfo } = await import('../../config/aiModels.js');
      const modelInfo = getModelInfo(model);
      const apiUsed = `Google ${modelInfo.modelName} (Vertex AI)`;

      return {
        response: result.content,
        apiUsed: apiUsed,
        confidence: 0.85, // Default confidence for AI responses (marking mode)
        usageTokens: result.usageTokens || 0,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
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





}
