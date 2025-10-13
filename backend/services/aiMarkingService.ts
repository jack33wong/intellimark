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
// Import getPrompt to use the centralized configuration
import { getPrompt } from '../config/prompts.js';
import { validateModel } from '../config/aiModels.js';

// Updated interface to reflect the structure used by the modern pipeline
interface SimpleProcessedImageResult {
  ocrText?: string;
  boundingBoxes: Array<{
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text: string;
    step_id?: string; // Crucial for linking feedback
    confidence?: number;
  }>;
  confidence: number;
  imageDimensions?: {
    width: number;
    height: number;
  };
  // Added fields used by the modern pipeline
  questionText?: string;
  isQuestion?: boolean;
}

// Updated interface to reflect the structure returned by the AI
interface SimpleAnnotation {
  step_id: string; // Link back to the student work step
  action: 'tick' | 'cross' | 'circle' | 'write' | 'underline' | 'comment';
  bbox?: [number, number, number, number]; // Populated later by AnnotationService
  text?: string; // Marking code (e.g., M1, A1)
  reasoning?: string; // LLM-provided explanation
  textMatch?: string; // Exact text match
}

// Updated interface for the final marking instructions structure
interface SimpleMarkingInstructions {
  annotations: SimpleAnnotation[];
  studentScore: {
    totalMarks: number;
    awardedMarks: number;
    scoreText: string;
  };
  usageTokens?: number;
}

// Minimal local types (preserved)
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
  // Added fields used by the modern pipeline
  markingScheme?: string; // JSON stringified marking scheme
  questionText?: string;
  extractedQuestionText?: string;
}

export class AIMarkingService {

  /**
   * Constructs the final marking prompt using centralized configuration.
   * This uses only text inputs (OCR/LaTeX) to bypass Gemini security filters.
   */
  public static constructMarkingPrompt(
    processedResult: SimpleProcessedImageResult,
    questionText: string,
    // Added optional questionDetection to extract total marks if available
    questionDetection?: SimpleQuestionDetectionResult
  ): { systemPrompt: string, userPrompt: string } {
    console.log('🤖 [AI MARKING] Constructing text-only marking prompt from configuration...');

    // 1. Format the Student Work Steps
    const studentSteps = Array.isArray(processedResult.boundingBoxes) 
        ? processedResult.boundingBoxes 
        : Object.values(processedResult.boundingBoxes);

    const studentWorkFormatted = studentSteps.map((step, index) => {
        const stepId = step.step_id || `step_${index + 1}`;
        // Format: 1. step_1: "Work text"
        return `${index + 1}. ${stepId}: "${step.text}"`;
    }).join('\n');

    // 2. Determine Total Marks (if possible)
    let totalMarks = 5; // Default fallback
    if (questionDetection && questionDetection.match && questionDetection.match.markingScheme) {
        // Attempt to find the total marks if available in the detection result.
        if (questionDetection.match.markingScheme.totalMarks) {
            totalMarks = questionDetection.match.markingScheme.totalMarks;
        }
    }

    // 3. Retrieve prompts from configuration
    // We use the 'textBasedMarking' configuration added in Step 1.
    let systemPrompt: string;
    let userPrompt: string;

    try {
        systemPrompt = getPrompt('textBasedMarking.system');
        userPrompt = getPrompt('textBasedMarking.user', questionText, studentWorkFormatted, totalMarks);
    } catch (error) {
        console.error("❌ [AI MARKING] CRITICAL: Failed to load 'textBasedMarking' prompt from configuration. Ensure prompts.ts is updated.", error);
        throw new Error("Configuration error: 'textBasedMarking' prompt missing.");
    }

    return { systemPrompt, userPrompt };
  }

  /**
   * Sends the constructed text prompt to the LLM and parses the JSON response.
   */
  public static async generateMarkingInstructionsFromPrompt(
    // Changed input to accept separate system and user prompts
    systemPrompt: string,
    userPrompt: string,
    model: ModelType
  ): Promise<SimpleMarkingInstructions> {
    console.log('🤖 [AI MARKING] Sending final prompt to Gemini for analysis...');

    // Display the prompt in the debug logs (optional based on environment/config)
    // Note: In a production environment, this logging might be conditional (e.g., process.env.DEBUG_LOG_PROMPTS)
    console.log("\n--- DEBUG: FINAL PROMPT SENT TO GEMINI ---\n\n[SYSTEM PROMPT]\n" + systemPrompt + "\n\n[USER PROMPT]\n" + userPrompt + "\n\n--- END OF PROMPT ---\n\n");

    try {
        const { ModelProvider } = await import('./ai/ModelProvider.js');
        
        // Call the text-only endpoint. This avoids image-based security filters.
        const response = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, true); // true for JSON mode

        // Display the raw response in the debug logs (optional)
        console.log("\n--- DEBUG: RAW RESPONSE FROM GEMINI ---\n\n" + response.content + "\n\n--- END OF RAW RESPONSE ---\n\n");

        // Parse the JSON response
        // Clean up potential markdown wrappers (e.g., ```json ... ```)
        const cleanResponse = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
        
        if (!cleanResponse) {
            throw new Error("Received empty response from AI model.");
        }

        const markingInstructions = JSON.parse(cleanResponse) as SimpleMarkingInstructions;

        // Validation: Ensure the structure is correct
        if (!markingInstructions.annotations || !Array.isArray(markingInstructions.annotations) || !markingInstructions.studentScore) {
            throw new Error("Invalid JSON structure received from AI model. Missing 'annotations' or 'studentScore'.");
        }

        // Add usage tokens to the result
        markingInstructions.usageTokens = response.usageTokens;

        console.log('✅ [AI MARKING] Successfully received and parsed marking instructions.');
        return markingInstructions;

    } catch (error) {
        console.error('❌ [AI MARKING] Failed to generate or parse marking instructions:', error);
        if (error instanceof SyntaxError) {
            console.error("❌ [AI MARKING] Failed to parse JSON response.");
        }
        throw new Error(`AI Marking failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }


  /**
   * Generate marking instructions for homework images
   * Refactored to use the modern text-based approach if processedImage is provided.
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: ModelType, 
    processedImage?: SimpleProcessedImageResult,
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<SimpleMarkingInstructions> {

    // Modern Pipeline: If we have processed results, use the text-based approach.
    if (processedImage && processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
        console.log("🚀 [AI MARKING] Using modern text-based marking pipeline.");
        
        // Determine the question text source
        const questionText = (processedImage as any).questionText || questionDetection?.questionText || questionDetection?.extractedQuestionText || "Unable to extract question text.";

        // 1. Construct the prompt using centralized configuration
        const { systemPrompt, userPrompt } = this.constructMarkingPrompt(processedImage, questionText, questionDetection);

        // 2. Generate instructions from the prompt
        return this.generateMarkingInstructionsFromPrompt(systemPrompt, userPrompt, model);
    }

    // Legacy Pipeline: Fallback to the older LLMOrchestrator if no processed image is available. (Preserved)
    console.warn("⚠️ [AI MARKING] Falling back to legacy LLMOrchestrator. This may trigger Gemini security filters if it sends images.");
    const { LLMOrchestrator } = await import('./ai/LLMOrchestrator');
    return LLMOrchestrator.executeMarking({
      imageData,
      model,
      processedImage: processedImage || ({} as SimpleProcessedImageResult),
      questionDetection
    });
  }

// --- Preserved Methods (The rest of the file remains exactly as previously implemented) ---

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
    * Updated to correctly handle the useOcrText flag (Security Bypass).
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
    } else if (!isQuestionOnly) {
      // Marking mode (Model Answer generation) always expects the input to be OCR text
      ocrText = imageDataOrOcrText;
    } else {
      // Question mode and useOcrText is false: prepare the image.
      compressedImage = await this.compressImage(imageDataOrOcrText);
    }
    
    // Use getPrompt for system and user prompts
    const systemPrompt = isQuestionOnly
      ? getPrompt('marking.questionOnly.system')
      : getPrompt('modelAnswer.system')

    let userPrompt = isQuestionOnly
      ? getPrompt('marking.questionOnly.user', message)
      // Note: modelAnswer.user expects (questionText, schemeJson, totalMarks?)
      // We pass ocrText as questionText and message as schemeJson for compatibility with legacy calls.
      : getPrompt('modelAnswer.user', ocrText, message); 


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
      
      // Determine the execution path based on mode and input type
      if (!isQuestionOnly) {
        // Marking Mode (Model Answer generation) - Always text-based
        if (!ocrText) throw new Error("OCR text required for Marking Mode.");
        return await this.callGeminiForTextResponse(ocrText, systemPrompt, userPrompt, validatedModel);
      } else {
        // Question Mode
        if (useOcrText && ocrText) {
            // Security Bypass: Use OCR text instead of image
            console.log("🛡️ [AI MARKING SERVICE] Using OCR text for Question Mode (Security Bypass).");
            // We must adjust the user prompt to include the OCR text context
            const textBasedUserPrompt = `The following text was extracted from the image. Use this as the context for your response:\n\n-- START OF EXTRACTED TEXT --\n${ocrText}\n-- END OF EXTRACTED TEXT --\n\n${userPrompt}`;
            return await this.callGeminiForTextResponse(ocrText, systemPrompt, textBasedUserPrompt, validatedModel);
        } else if (compressedImage) {
            // Original behavior: Use the image (Potential security risk)
            console.warn("⚠️ [AI MARKING SERVICE] Using Image input for Question Mode. This may trigger Gemini security alarms.");
            return await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt, validatedModel);
        } else {
            throw new Error("No valid input provided for Question Mode (neither image nor OCR text).");
        }
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

// --- Preserved Helper Methods (Implementations kept exactly as provided in the source) ---

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

    // Note: This prompt is hardcoded here, not using getPrompt, preserving original behavior.
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
    // ocrText parameter is kept for signature consistency but not directly used in the ModelProvider call
    ocrText: string | null,
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

// ... (The remaining helper methods getGeminiAccessToken, makeGeminiChatRequest, extractGeminiChatContent, etc., are preserved exactly as provided in the source code) ...

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