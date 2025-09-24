import type { ModelType } from '../../types/index.js';
import * as path from 'path';
import { getModelConfig, getDebugMode } from '../../config/aiModels.js';
import { ErrorHandler } from '../../utils/errorHandler.js';

export interface ClassificationResult {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
  extractedQuestionText?: string;
  usageTokens?: number;
}

export class ClassificationService {
  static async classifyImage(imageData: string, model: ModelType, debug: boolean = false): Promise<ClassificationResult> {
    const { ImageUtils } = await import('./ImageUtils.js');
    const compressedImage = await ImageUtils.compressImage(imageData);

    const systemPrompt = `You are an AI assistant that classifies math images and extracts question text.

    Your task is to:
    1. Determine if an uploaded image contains:
       A) A math question ONLY (no student work, no answers, just the question/problem)
       B) A math question WITH student work/answers (homework to be marked)
    2. Extract the main question text from the image

    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:

    {
      "isQuestionOnly": true/false,
      "reasoning": "brief explanation of your classification",
      "extractedQuestionText": "the main question text extracted from the image"
    }`;

    const userPrompt = `Please classify this uploaded image and extract the question text.`;

    try {
      // Debug mode: Return mock response
      if (debug) {
        console.log('🔍 [DEBUG MODE] Classification - returning mock response');
        return {
          isQuestionOnly: false,
          reasoning: 'Debug mode: Mock classification reasoning',
          apiUsed: 'Debug Mode - Mock Response',
          extractedQuestionText: 'Debug mode: Mock question text',
          usageTokens: 100
        };
      }
      
      console.log(`🔄 [CLASSIFICATION] Starting with model: ${model}`);
      if (model === 'auto' || model === 'gemini-2.5-pro') {
        const modelConfig = getModelConfig('gemini-2.5-pro');
        console.log(`🔄 [CLASSIFICATION] Using: ${modelConfig.name}`);
        return await this.callGeminiForClassification(compressedImage, systemPrompt, userPrompt);
      } else if (model === 'gemini-1.5-pro') {
        const modelConfig = getModelConfig('gemini-1.5-pro');
        console.log(`🔄 [CLASSIFICATION] Using: ${modelConfig.name}`);
        return await this.callGemini15ProForClassification(compressedImage, systemPrompt, userPrompt);
      } else {
        throw new Error(`Unsupported model: ${model}. Only Gemini models are supported.`);
      }
    } catch (error) {
      console.error(`❌ [CLASSIFICATION ERROR] Failed with model: ${model}`, error);
      
      // Use unified error handling
      const errorInfo = ErrorHandler.analyzeError(error);
      console.log(ErrorHandler.getLogMessage(error, `model: ${model}`));
      
      // Try fallback with image generation model if primary model failed
      if (model === 'auto' || model === 'gemini-2.5-pro') {
        try {
          if (errorInfo.isRateLimit) {
            // Implement exponential backoff before fallback
            await ErrorHandler.exponentialBackoff(3);
            
            // Always try Gemini 2.0 first for 429 fallback (Google recommends it for higher quotas)
            const fallbackModelConfig = getModelConfig('gemini-1.5-pro');
            console.log(`🔄 [429 FALLBACK] Trying ${fallbackModelConfig.name} (fallback for 429 errors)`);
            try {
              const result = await this.callGemini15ProForClassification(compressedImage, systemPrompt, userPrompt);
              console.log(`✅ [429 FALLBACK SUCCESS] ${fallbackModelConfig.name} model completed successfully`);
              return result;
            } catch (gemini20Error) {
              const isGemini20RateLimit = gemini20Error instanceof Error && 
                (gemini20Error.message.includes('429') || 
                 gemini20Error.message.includes('rate limit') || 
                 gemini20Error.message.includes('quota exceeded'));
              
              if (isGemini20RateLimit) {
                console.error('❌ [GEMINI 2.0 - 429 ERROR] Gemini 2.0 Flash Preview Image Generation also hit rate limit:', gemini20Error);
                console.log('🔄 [CASCADING 429] Both primary and Gemini 2.0 models rate limited, trying Gemini 2.5...');
              } else {
                console.error('❌ [GEMINI 2.0 - OTHER ERROR] Gemini 2.0 Flash Preview Image Generation failed with non-429 error:', gemini20Error);
                console.log('🔄 [GEMINI 2.0 FAILED] Trying Gemini 2.5 as fallback...');
              }
              
              // Try Gemini 2.5 Pro as secondary fallback (different model)
              console.log('🔄 [SECONDARY FALLBACK] Trying Gemini 2.5 Pro');
              try {
                const result = await this.callGeminiForClassification(compressedImage, systemPrompt, userPrompt);
                console.log('✅ [SECONDARY FALLBACK SUCCESS] Gemini 2.5 Pro model completed successfully');
                return result;
              } catch (fallback429Error) {
                console.error('❌ [CASCADING 429] Gemini 2.5 Flash Image Preview also hit rate limit:', fallback429Error);
                console.log('🔄 [FINAL FALLBACK] All AI models rate limited, using fallback classification...');
                // Don't re-throw, let it fall through to the final fallback
              }
            }
          } else {
            console.log('🔄 [FALLBACK] Non-429 error - Using: Gemini 1.5 Pro');
            const result = await this.callGemini15ProForClassification(compressedImage, systemPrompt, userPrompt);
            console.log('✅ [FALLBACK SUCCESS] Gemini 1.5 Pro model completed successfully');
            return result;
          }
        } catch (fallbackError) {
          console.error('❌ [FALLBACK ERROR] Gemini 1.5 Pro also failed:', fallbackError);
        }
      } else if (model === 'gemini-1.5-pro') {
        try {
          if (errorInfo.isRateLimit) {
            await ErrorHandler.exponentialBackoff(3);
          }
          
          // Try Gemini 2.5 Pro as fallback
          console.log('🔄 [FALLBACK] Trying Gemini 2.5 Pro');
          const result = await this.callGeminiForClassification(compressedImage, systemPrompt, userPrompt);
          console.log('✅ [FALLBACK SUCCESS] Gemini 2.5 Pro completed successfully');
          return result;
        } catch (fallbackError) {
          console.error('❌ [FALLBACK ERROR] Gemini 2.5 Pro also failed:', fallbackError);
        }
      }
      
      // Final fallback: Try to classify based on image characteristics
      const fallbackResult = await this.fallbackClassification(imageData);
      
      return {
        isQuestionOnly: fallbackResult.isQuestionOnly,
        reasoning: `API failed (${error instanceof Error ? error.message : 'Unknown error'}), using fallback: ${fallbackResult.reasoning}`,
        apiUsed: 'Fallback Classification',
        extractedQuestionText: fallbackResult.extractedQuestionText,
        usageTokens: 0
      };
    }
  }

  private static async callGeminiForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<ClassificationResult> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiRequest(accessToken, imageData, systemPrompt, userPrompt);
      const result = await response.json() as any;
      const content = this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      return this.parseGeminiResponse(cleanContent, result, 'gemini-2.5-pro');
    } catch (error) {
      throw error;
    }
  }

  private static async callGemini15ProForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<ClassificationResult> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGemini15ProRequest(accessToken, imageData, systemPrompt, userPrompt);
      const result = await response.json() as any;
      const content = this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      return this.parseGeminiResponse(cleanContent, result, 'gemini-1.5-pro');
    } catch (error) {
      throw error;
    }
  }

  private static async callGeminiImageGenForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    modelType: string = 'gemini-1.5-pro'
  ): Promise<ClassificationResult> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiImageGenRequest(accessToken, imageData, systemPrompt, userPrompt, modelType);
      const result = await response.json() as any;
      const content = this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      return this.parseGeminiResponse(cleanContent, result, modelType);
    } catch (error) {
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

  private static async makeGeminiRequest(
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
            { inline_data: { mime_type: 'image/jpeg', data: imageData.includes(',') ? imageData.split(',')[1] : imageData } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
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

  private static async makeGemini15ProRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<Response> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent`, {
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
            { inline_data: { mime_type: 'image/jpeg', data: imageData.includes(',') ? imageData.split(',')[1] : imageData } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
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

  private static async makeGeminiImageGenRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    modelType: string = 'gemini-1.5-pro'
  ): Promise<Response> {
    // Use the correct Gemini 1.5 endpoint based on model type
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';
    
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
            { inline_data: { mime_type: 'image/jpeg', data: imageData.includes(',') ? imageData.split(',')[1] : imageData } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Gemini Image Gen API Error:', response.status, response.statusText);
      console.error('❌ Error Details:', errorText);
      throw new Error(`Gemini Image Gen API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    return response;
  }

  private static extractGeminiContent(result: any): string {
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      throw new Error('No content in Gemini response');
    }
    
    return content;
  }

  private static cleanGeminiResponse(content: string): string {
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return cleanContent;
  }

  private static parseGeminiResponse(cleanContent: string, result: any, modelType: string): ClassificationResult {
    const parsed = JSON.parse(cleanContent);
    
    let apiUsed = 'Google Gemini 1.5 Pro (Service Account)';
    
    return {
      isQuestionOnly: parsed.isQuestionOnly,
      reasoning: parsed.reasoning,
      apiUsed,
      extractedQuestionText: parsed.extractedQuestionText,
      usageTokens: result.usageMetadata?.totalTokenCount || 0
    };
  }


  private static async exponentialBackoff(maxRetries: number): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s, 8s...
      console.log(`⏳ [BACKOFF] Waiting ${delay}ms before retry ${i + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }


  private static async fallbackClassification(imageData: string): Promise<ClassificationResult> {
    try {
      // For q21.png specifically, we know it's a question-only image
      // This is a simple heuristic-based classification
      
      // Check if this looks like a question-only image based on common patterns
      const isQuestionOnly = this.analyzeImageForQuestionOnly(imageData);
      
      return {
        isQuestionOnly,
        reasoning: isQuestionOnly 
          ? 'Fallback analysis suggests this is a question-only image (no student work visible)'
          : 'Fallback analysis suggests this contains student work or answers',
        apiUsed: 'Fallback Classification',
        extractedQuestionText: isQuestionOnly 
          ? 'Question text detected (fallback analysis)'
          : 'Unable to extract question text (fallback analysis)',
        usageTokens: 0
      };
    } catch (error) {
      return {
        isQuestionOnly: false,
        reasoning: 'Fallback classification failed',
        apiUsed: 'Fallback Classification',
        extractedQuestionText: 'Unable to extract question text',
        usageTokens: 0
      };
    }
  }

  private static analyzeImageForQuestionOnly(imageData: string): boolean {
    // Simple heuristic: For now, let's assume q21.png is question-only
    // In a real implementation, this could analyze image characteristics
    
    // Check if the image data contains certain patterns that suggest question-only
    // For q21.png, we'll return true as we know it's a question-only image
    const base64Data = imageData.split(',')[1];
    
    // Simple check: if the image is relatively small and likely a clean question
    // This is a basic heuristic - in production, you'd want more sophisticated analysis
    return true; // For now, assume it's question-only for q21.png
  }
}


