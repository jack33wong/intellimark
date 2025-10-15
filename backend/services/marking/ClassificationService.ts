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
  private static readonly SAFETY_SETTINGS = [
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
  ];
  static async classifyImage(imageData: string, model: ModelType, debug: boolean = false): Promise<ClassificationResult> {
    const { ImageUtils } = await import('../../utils/ImageUtils.js');
    
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
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const accessToken = await ModelProvider.getGeminiAccessToken();
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
      const content = await this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      const finalResult = await this.parseGeminiResponse(cleanContent, result, model);
      
      return finalResult;
    } catch (error) {
      console.error(`❌ [CLASSIFICATION] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
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
      safetySettings: this.SAFETY_SETTINGS
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



  private static async extractGeminiContent(result: any): Promise<string> {
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    return ModelProvider.extractGeminiTextContent(result);
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




}


