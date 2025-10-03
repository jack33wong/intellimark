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
  comment?: string; // Optional for marking actions
  text?: string; // For comment actions
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
   * Generate chat response for question-only images
   */
  static async generateChatResponse(
    imageData: string,
    message: string,
    model: ModelType,
    isQuestionOnly: boolean = true,
    debug: boolean = false,
    onProgress?: (data: any) => void
  ): Promise<{ response: string; apiUsed: string }> {
    
    // Debug mode: Return mock response
    if (debug) {
      console.log('🔍 [DEBUG MODE] Chat Response - returning mock response');
      return {
        response: 'Debug mode: Mock chat response - This is a simulated AI response for testing purposes.',
        apiUsed: 'Debug Mode - Mock Response'
      };
    }
    
    const compressedImage = await this.compressImage(imageData);
    
    const systemPrompt = isQuestionOnly
      ? `You are an AI tutor helping students with math problems.
      
      You will receive an image of a math question and a message from the student.
      Your task is to provide a clear, step-by-step solution with minimal explanation.
      
      RESPONSE FORMAT REQUIREMENTS:
      - Use Markdown formatting
      - CRITICAL RULE: Each step of the solution must have a title and an explanation. The title (e.g., 'Step 1:') must be in its own paragraph with no other text. 
      - The explanation must start in the next, separate paragraph.
      - For any inline emphasis, use italics instead of bold
      - Always put the final, conclusive answer in the very last paragraph
      - CRITICAL RULE FOR MATH: All mathematical expressions, no matter how simple, must be enclosed in single dollar signs for inline math (e.g., $A = P(1+r)^3$) or double dollar signs for block math. Ensure all numbers and syntax are correct (e.g., use 1.12, not 1. 12).
      
      RESPONSE GUIDELINES:
      - Show the solution steps clearly and concisely
      - Use clear mathematical notation and formatting
      - Include essential calculations and working
      - Keep explanations brief and to the point
      - Focus on the solution method, not detailed teaching
      - Be direct and efficient
      
      Return a clear, step-by-step solution with minimal explanatory text.`
      : `You are an expert math tutor reviewing a student's work in an image.
      
      RESPONSE FORMAT REQUIREMENTS:
      - Use Markdown formatting.
      - CRITICAL RULE: Each step of the solution must have a title (e.g., 'Step 1:'). The title must be in its own paragraph with no other text.
      - The explanation must start in the next, separate paragraph.
      - Use italics for any inline emphasis, not bold.
      - Always put the final, conclusive answer in the very last paragraph.
      - CRITICAL RULE FOR MATH: All mathematical expressions, no matter how simple, must be enclosed in single dollar signs for inline math (e.g., $A = P(1+r)^3$) or double dollar signs for block math. Ensure all numbers and syntax are correct (e.g., use 1.12, not 1. 12).

      YOUR TASK:
      - Adopt the persona of an expert math tutor providing brief, targeted feedback.
      - Your entire response must be under 150 words.
      - Do not provide a full step-by-step walkthrough of the correct solution.
      - Concisely point out the student's single key mistake.
      - Ask 1-2 follow-up questions to guide the student.`;

    const userPrompt = isQuestionOnly
      ? `Student message: "${message}"
      
      Please solve this math question step by step. Show the working clearly and concisely.`
      : `Student message: "${message}"
      
      Review the student's work and provide brief feedback with 1-2 follow-up questions.`;

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
      
      if (model === 'auto' || model === 'gemini-2.5-pro') {
        return await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt, model);
      } else {
        throw new Error(`Unsupported model: ${model}. Only Gemini models are supported.`);
      }
    } catch (error) {
      // Get the actual model endpoint name for logging
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
      
      console.error(`❌ [CHAT RESPONSE ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [ERROR DETAILS] ${error instanceof Error ? error.message : 'Unknown error'}`);
      
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
   * Generate contextual response for text-based conversations
   */
  static async generateContextualResponse(
    message: string,
    chatHistory: any[],
    model: ModelType,
    contextSummary?: string
  ): Promise<string> {
    
    const systemPrompt = `You are a math solver that provides direct, step-by-step solutions to math problems.
    
    You will receive a message from the student and their chat history for context.
    ALWAYS solve the math problem directly. Do NOT ask questions or ask for clarification.
    
    RESPONSE FORMAT REQUIREMENTS:
    - Use Markdown formatting
    - CRITICAL RULE: Each step of the solution must have a title and an explanation. The title (e.g., 'Step 1:') must be in its own paragraph with no other text. 
    - The explanation must start in the next, separate paragraph.
    - For any inline emphasis, use italics instead of bold
    - Always put the final, conclusive answer in the very last paragraph
    - CRITICAL RULE FOR MATH: All mathematical expressions, no matter how simple, must be enclosed in single dollar signs for inline math (e.g., $A = P(1+r)^3$) or double dollar signs for block math. Ensure all numbers and syntax are correct (e.g., use 1.12, not 1. 12).
    
    RESPONSE RULES:
    - Solve the problem immediately, don't ask questions
    - Show step-by-step mathematical work
    - Use clear mathematical notation
    - Keep explanations minimal and focused
    - Do NOT ask "Do you want to try another one?" or similar questions
    - Do NOT ask about preferred methods - just solve it`;

    // Use context summary if available, otherwise fall back to recent messages
    let contextPrompt = '';
    if (contextSummary) {
      contextPrompt = `\n\nPrevious conversation summary:\n${contextSummary}`;
    } else if (chatHistory.length > 0) {
      contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-3).map(item => `${item.role}: ${item.content}`).join('\n')}`;
    }

    const userPrompt = `Math problem: "${message}"${contextPrompt}
    
    Solve this problem step by step. Show your work and give the final answer. Do not ask questions.`;

    try {
      const { ModelProvider } = await import('./ai/ModelProvider.js');
      const response = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'auto');
      // Extract content from the response object
      return response.content;
    } catch (error) {
      console.error('❌ Contextual response generation failed:', error);
      return 'I apologize, but I encountered an error while processing your message. Please try again.';
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
  ): Promise<{ response: string; apiUsed: string }> {
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
      
      return {
        response: content,
        apiUsed: apiUsed
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
    const { ImageUtils } = await import('./ai/ImageUtils');
    return ImageUtils.compressImage(imageData);
  }
}
