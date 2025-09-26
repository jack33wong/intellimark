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

type SimpleModelType = 'auto' | 'gemini-2.5-pro';

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
    model: SimpleModelType
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
    model: SimpleModelType,
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
    model: SimpleModelType, 
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
    model: SimpleModelType,
    isQuestionOnly: boolean = true,
    debug: boolean = false
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
      Your task is to provide helpful, educational responses that guide the student toward understanding.
      
      RESPONSE GUIDELINES:
      - Be encouraging and supportive
      - Break down complex problems into steps
      - Ask guiding questions to help the student think
      - Provide hints rather than direct answers when appropriate
      - Use clear mathematical notation
      - Explain concepts in simple terms
      - Encourage the student to show their work
      
      Return a helpful, educational response that guides the student.`
      : `You are an expert math tutor reviewing a student's question AND their attempted answer in an image.
      
      Your task is to:
      - Understand the original question in the image
      - Read the student’s working and answer if present
      - Give targeted, constructive feedback that helps them improve
      - Point out mistakes and explain why they’re mistakes
      - Ask specific follow-up questions that deepen understanding
      - When appropriate, outline the next step rather than giving the final answer
      - Use precise mathematical notation and keep a supportive tone`;

    const userPrompt = isQuestionOnly
      ? `Student message: "${message}"
      
      Please help the student with this math question. Provide guidance, hints, and encouragement.`
      : `Student message: "${message}"
      
      If the image contains student work, base your feedback on their steps. Provide brief, actionable feedback and one or two targeted follow-up questions.`;

    try {
      if (model === 'auto' || model === 'gemini-2.5-pro') {
        return await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt);
      } else if (model === 'auto') {
        return await this.callGemini15ProForChatResponse(compressedImage, systemPrompt, userPrompt);
      } else {
        throw new Error(`Unsupported model: ${model}. Only Gemini models are supported.`);
      }
    } catch (error) {
      // Get the actual model endpoint name for logging
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      
      console.error(`❌ [CHAT RESPONSE ERROR] Failed with model: ${actualModelName}`, error);
      
      // Use unified error handling
      const errorInfo = ErrorHandler.analyzeError(error);
      console.log(ErrorHandler.getLogMessage(error, `chat response model: ${actualModelName}`));
      
      // Try fallback with image generation model if primary model failed
      if (model === 'auto' || model === 'gemini-2.5-pro') {
        try {
          if (errorInfo.isRateLimit) {
            // Implement exponential backoff before fallback
            await ErrorHandler.exponentialBackoff(3);
            
            // Always try Gemini 2.0 first for 429 fallback (Google recommends it for higher quotas)
            const fallbackModelConfig = getModelConfig('auto');
            console.log(`🔄 [429 FALLBACK] Trying ${fallbackModelConfig.name} for chat response (fallback for 429 errors)`);
            try {
              const result = await this.callGemini15ProForChatResponse(compressedImage, systemPrompt, userPrompt);
              console.log(`✅ [429 FALLBACK SUCCESS] ${fallbackModelConfig.name} model completed successfully for chat response`);
              return result;
            } catch (gemini20Error) {
              const isGemini20RateLimit = gemini20Error instanceof Error && 
                (gemini20Error.message.includes('429') || 
                 gemini20Error.message.includes('rate limit') || 
                 gemini20Error.message.includes('quota exceeded'));
              
              if (isGemini20RateLimit) {
                console.error('❌ [GEMINI 2.0 - 429 ERROR] Gemini 2.0 Flash Preview Image Generation also hit rate limit for chat response:', gemini20Error);
                console.log('🔄 [CASCADING 429] Both primary and Gemini 2.0 models rate limited, trying Gemini 2.5 for chat response...');
              } else {
                console.error('❌ [GEMINI 2.0 - OTHER ERROR] Gemini 2.0 Flash Preview Image Generation failed with non-429 error for chat response:', gemini20Error);
                console.log('🔄 [GEMINI 2.0 FAILED] Trying Gemini 2.5 as fallback for chat response...');
              }
              
              // Try Gemini 2.5 Pro as secondary fallback (different model)
              console.log('🔄 [SECONDARY FALLBACK] Trying Gemini 2.5 Pro for chat response');
              try {
                const result = await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt);
                console.log('✅ [SECONDARY FALLBACK SUCCESS] Gemini 2.5 Pro model completed successfully for chat response');
                return result;
              } catch (fallback429Error) {
                console.error('❌ [CASCADING 429] Gemini 2.5 Flash Image Preview also hit rate limit:', fallback429Error);
                console.log('🔄 [FINAL FALLBACK] All AI models rate limited, using fallback response...');
                // Don't re-throw, let it fall through to the final fallback
              }
            }
          } else {
            console.log('🔄 [FALLBACK] Non-429 error - Using: Gemini 1.5 Pro for chat response');
            try {
              const result = await this.callGemini15ProForChatResponse(compressedImage, systemPrompt, userPrompt);
              console.log('✅ [FALLBACK SUCCESS] Gemini 1.5 Pro model completed successfully for chat response');
              return result;
            } catch (fallbackError) {
              console.error('❌ [FALLBACK ERROR] Gemini 2.5 Flash Image Preview also failed:', fallbackError);
              console.log('🔄 [FINAL FALLBACK] All AI models failed, using fallback response...');
              // Don't re-throw, let it fall through to the final fallback
            }
          }
        } catch (fallbackError) {
          console.error('❌ [FALLBACK ERROR] Gemini 1.5 Pro also failed:', fallbackError);
        }
      } else if (model === 'auto') {
        try {
          if (errorInfo.isRateLimit) {
            await ErrorHandler.exponentialBackoff(3);
          }
          
          // Try Gemini 2.5 Pro as fallback
          console.log('🔄 [FALLBACK] Trying Gemini 2.5 Pro for chat response');
          const result = await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt);
          console.log('✅ [FALLBACK SUCCESS] Gemini 2.5 Pro completed successfully for chat response');
          return result;
        } catch (fallbackError) {
          console.error('❌ [FALLBACK ERROR] Gemini 2.5 Pro also failed:', fallbackError);
        }
      }
      
      return {
        response: 'I apologize, but I encountered an error while processing your question. Please try again or rephrase your question.',
        apiUsed: 'Fallback Response'
      };
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
      const { ModelProvider } = await import('./ai/ModelProvider');
      const response = await ModelProvider.callGeminiText(
        'You are a helpful assistant that creates concise conversation summaries. Focus on key points and maintain context for future interactions.',
        summaryPrompt
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
    model: SimpleModelType,
    contextSummary?: string
  ): Promise<string> {
    
    const systemPrompt = `You are an AI tutor helping students with math problems. 
    
    You will receive a message from the student and their chat history for context.
    Provide helpful, educational responses that continue the conversation naturally.
    
    RESPONSE GUIDELINES:
    - Reference previous parts of the conversation when relevant
    - Be encouraging and supportive
    - Ask clarifying questions if needed
    - Provide step-by-step guidance
    - Use clear mathematical notation
    - Keep responses concise but helpful`;

    // Use context summary if available, otherwise fall back to recent messages
    let contextPrompt = '';
    if (contextSummary) {
      contextPrompt = `\n\nPrevious conversation summary:\n${contextSummary}`;
    } else if (chatHistory.length > 0) {
      contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-3).map(item => `${item.role}: ${item.content}`).join('\n')}`;
    }

    const userPrompt = `Student message: "${message}"${contextPrompt}
    
    Please provide a helpful response that continues our conversation.`;

    try {
      const { ModelProvider } = await import('./ai/ModelProvider');
      const response = await ModelProvider.callGeminiText(systemPrompt, userPrompt);
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
    userPrompt: string
  ): Promise<{ response: string; apiUsed: string }> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiChatRequest(accessToken, imageData, systemPrompt, userPrompt);
      const result = await response.json() as any;
      const content = this.extractGeminiChatContent(result);
      
      return {
        response: content,
        apiUsed: 'Google Gemini 2.5 Pro (Service Account)'
      };
    } catch (error) {
      console.error('❌ Gemini chat response failed:', error);
      
      // Check if it's a rate limit error
      const isRateLimitError = error instanceof Error && 
        (error.message.includes('429') || 
         error.message.includes('Too Many Requests') ||
         error.message.includes('rate limit'));
      
      if (isRateLimitError) {
        console.log('🔄 [RATE LIMIT] Gemini 2.5 Pro hit rate limit, will try fallback');
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
      
      const apiUsed = 'Google Gemini 1.5 Pro (Service Account)';
      
      return {
        response: content,
        apiUsed
      };
    } catch (error) {
      console.error('❌ Gemini Image Gen chat response failed:', error);
      throw error;
    }
  }

  private static async callGemini15ProForChatResponse(
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ response: string; apiUsed: string }> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGemini15ProChatRequest(accessToken, imageData, systemPrompt, userPrompt);
      const result = await response.json() as any;
      const content = this.extractGeminiChatContent(result);
      
      return {
        response: content,
        apiUsed: 'Google Gemini 1.5 Pro (Service Account)'
      };
    } catch (error) {
      console.error('❌ Gemini 1.5 Pro chat response failed:', error);
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
    userPrompt: string
  ): Promise<Response> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`, {
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
      console.error('❌ Gemini API Error:', response.status, response.statusText);
      console.error('❌ Error Details:', errorText);
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} - ${errorText}`);
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

  private static async makeGemini15ProChatRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<Response> {
    // Use centralized model configuration
    const { getModelConfig } = await import('../config/aiModels.js');
    const config = getModelConfig('auto');
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
                data: imageData.includes(',') ? imageData.split(',')[1] : imageData
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8000 // Use centralized config
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Gemini 1.5 Pro API Error:', response.status, response.statusText);
      console.error('❌ Error Details:', errorText);
      throw new Error(`Gemini 1.5 Pro API request failed: ${response.status} ${response.statusText} - ${errorText}`);
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
          throw new Error(`Response truncated due to token limit. The model response was too long and got cut off. Consider using Gemini 2.5 Pro for longer responses.`);
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
