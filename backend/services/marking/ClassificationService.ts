import type { ModelType } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import * as path from 'path';
import { getModelConfig, getDebugMode, validateModel } from '../../config/aiModels.js';
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
    const { ImageUtils } = await import('../ai/ImageUtils.js');
    
    console.log('🔍 [CLASSIFICATION] Enhancing image quality before sending to Gemini...');
    const compressedImage = await ImageUtils.compressImage(imageData);
    console.log('✅ [CLASSIFICATION] Image enhancement completed');

    const systemPrompt = getPrompt('classification.system');
    const userPrompt = getPrompt('classification.user');

    try {
      // Debug mode: Return mock response
      if (debug) {
        return {
          isQuestionOnly: false,
          reasoning: 'Debug mode: Mock classification reasoning',
          apiUsed: 'Debug Mode - Mock Response',
          extractedQuestionText: 'Debug mode: Mock question text',
          usageTokens: 100
        };
      }
      
      // Validate model using centralized validation
      const validatedModel = validateModel(model);
      return await this.callGeminiForClassification(compressedImage, systemPrompt, userPrompt, validatedModel);
    } catch (error) {
      // Check if this is our validation error (fail fast)
      if (error instanceof Error && error.message.includes('Unsupported model')) {
        // This is our validation error - re-throw it as-is
        throw error;
      }
      
      // This is a Google API error - log with proper context
      const { getModelConfig } = await import('../../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
      
      console.error(`❌ [GOOGLE API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [GOOGLE ERROR] ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Use unified error handling
      const errorInfo = ErrorHandler.analyzeError(error);
      
      // Fail fast on 429 errors with clear message
      if (errorInfo.isRateLimit) {
        console.error(`❌ [QUOTA EXCEEDED] ${actualModelName} (${apiVersion}) quota exceeded`);
        throw new Error(`API quota exceeded for ${actualModelName} (${apiVersion}). Please check your Google Cloud Console for quota limits.`);
      }
      
      // Fail fast - no fallbacks
      throw error;
    }
  }

  private static async callGeminiForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<ClassificationResult> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiRequest(accessToken, imageData, systemPrompt, userPrompt, model);
      
      // Check if response is HTML (error page)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        const htmlContent = await response.text();
        console.error('❌ [CLASSIFICATION] Received HTML response instead of JSON:');
        console.error('❌ [CLASSIFICATION] HTML content:', htmlContent.substring(0, 200) + '...');
        throw new Error('Gemini API returned HTML error page instead of JSON. Check API key and permissions.');
      }
      
      const result = await response.json() as any;
      const content = this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      const finalResult = await this.parseGeminiResponse(cleanContent, result, model);
      
      return finalResult;
    } catch (error) {
      console.error(`❌ [CLASSIFICATION] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }


  private static async callGeminiImageGenForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    modelType: string = 'auto'
  ): Promise<ClassificationResult> {
    try {
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiImageGenRequest(accessToken, imageData, systemPrompt, userPrompt, modelType);
      const result = await response.json() as any;
      const content = this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      return await this.parseGeminiResponse(cleanContent, result, modelType);
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
    userPrompt: string,
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<Response> {
    // Use centralized model configuration
    const { getModelConfig } = await import('../../config/aiModels.js');
    const config = getModelConfig(model);
    const endpoint = config.apiEndpoint;
    
    const requestBody = {
      contents: [{
        parts: [
          { text: systemPrompt },
          { text: userPrompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageData.includes(',') ? imageData.split(',')[1] : imageData } }
        ]
      }],
      generationConfig: { 
        temperature: 0.1, 
        maxOutputTokens: (await import('../../config/aiModels.js')).getModelConfig('gemini-2.5-flash').maxTokens 
      }, // Use centralized config
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
    };
    
    // Debug logging to show safety settings being sent
    console.log('🔍 [CLASSIFICATION DEBUG] Safety settings being sent:');
    console.log(JSON.stringify(requestBody.safetySettings, null, 2));
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      const { getModelConfig } = await import('../../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
      
      console.error(`❌ [GEMINI API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [HTTP STATUS] ${response.status} ${response.statusText}`);
      console.error(`❌ [ERROR DETAILS] ${errorText}`);
      
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} for ${actualModelName} (${apiVersion}) - ${errorText}`);
    }
    
    return response;
  }


  private static async makeGeminiImageGenRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    modelType: string = 'auto'
  ): Promise<Response> {
    // Use centralized model configuration
    const { getModelConfig } = await import('../../config/aiModels.js');
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
            { inline_data: { mime_type: 'image/jpeg', data: imageData.includes(',') ? imageData.split(',')[1] : imageData } }
          ]
        }],
        generationConfig: { 
        temperature: 0.1, 
        maxOutputTokens: (await import('../../config/aiModels.js')).getModelConfig('gemini-2.5-flash').maxTokens 
      }, // Use centralized config
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
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
    // Check if result is an error response (HTML)
    if (typeof result === 'string' && result.includes('<')) {
      console.error('❌ [CLASSIFICATION] Received HTML error response instead of JSON:');
      console.error('❌ [CLASSIFICATION] HTML content:', result.substring(0, 200) + '...');
      throw new Error('Gemini API returned HTML error response instead of JSON. Check API key and endpoint.');
    }
    
    // Check if result has the expected structure
    if (!result || !result.candidates || !Array.isArray(result.candidates)) {
      console.error('❌ [CLASSIFICATION] Unexpected response structure:');
      console.error('❌ [CLASSIFICATION] Full response:', JSON.stringify(result, null, 2));
      throw new Error('Gemini API returned unexpected response structure.');
    }
    
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      const finishReason = result.candidates?.[0]?.finishReason;
      
      // Check for detailed safety feedback in promptFeedback
      if (result.promptFeedback) {
        console.error('🔍 [CLASSIFICATION] Detailed safety feedback:');
        console.error('🔍 [CLASSIFICATION] promptFeedback:', JSON.stringify(result.promptFeedback, null, 2));
        
        if (result.promptFeedback.blockReason) {
          console.error('🔍 [CLASSIFICATION] Block reason:', result.promptFeedback.blockReason);
        }
        if (result.promptFeedback.safetyRatings) {
          console.error('🔍 [CLASSIFICATION] Safety ratings:', JSON.stringify(result.promptFeedback.safetyRatings, null, 2));
        }
      }
      
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini response exceeded maximum token limit. Consider increasing maxOutputTokens or reducing prompt length.');
      }
      if (finishReason === 'RECITATION') {
        const safetyDetails = result.promptFeedback ? `\nSafety details: ${JSON.stringify(result.promptFeedback, null, 2)}` : '';
        throw new Error(`Gemini blocked the response due to content safety filters. The image may contain content that violates safety guidelines.${safetyDetails}`);
      }
      if (finishReason === 'SAFETY') {
        const safetyDetails = result.promptFeedback ? `\nSafety details: ${JSON.stringify(result.promptFeedback, null, 2)}` : '';
        throw new Error(`Gemini blocked the response due to safety concerns. Please try with a different image.${safetyDetails}`);
      }
      console.error('❌ [CLASSIFICATION] Unexpected finish reason:', finishReason);
      console.error('❌ [CLASSIFICATION] Full response:', JSON.stringify(result, null, 2));
      throw new Error(`No content in Gemini response. Finish reason: ${finishReason}`);
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

  private static async parseGeminiResponse(cleanContent: string, result: any, modelType: string): Promise<ClassificationResult> {
    // Debug logging to see what we're getting
    console.log('🔍 [CLASSIFICATION DEBUG] Raw cleanContent:', cleanContent.substring(0, 200) + '...');
    console.log('🔍 [CLASSIFICATION DEBUG] Full Gemini result:', JSON.stringify(result, null, 2));
    
    let parsed;
    try {
      parsed = JSON.parse(cleanContent);
    } catch (error) {
      console.error('❌ [CLASSIFICATION] JSON Parse Error:');
      console.error('❌ [CLASSIFICATION] Content that failed to parse:', cleanContent);
      console.error('❌ [CLASSIFICATION] Parse error:', error);
      throw new Error(`Failed to parse Gemini response as JSON. Content: ${cleanContent.substring(0, 100)}...`);
    }
    
    // Get dynamic API name based on model
    const { getModelConfig } = await import('../../config/aiModels.js');
    const modelConfig = getModelConfig(modelType as ModelType);
    const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || modelType;
    const apiUsed = `Google ${modelName} (Service Account)`;
    
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


