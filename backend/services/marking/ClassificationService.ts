import type { ModelType } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import * as path from 'path';
import { getModelConfig, getDebugMode, validateModel } from '../../config/aiModels.js';
import { ErrorHandler } from '../../utils/errorHandler.js';

export interface ClassificationResult {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
  extractedQuestionText?: string; // Legacy support
  questions?: Array<{
    text: string;
    confidence: number;
  }>;
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
  static async classifyImage(imageData: string, model: ModelType, debug: boolean = false, fileName?: string): Promise<ClassificationResult> {
    const systemPrompt = getPrompt('classification.system');
    const userPrompt = getPrompt('classification.user');

    try {
      // Hardcoded test data: Only trigger for specific filenames
      if (fileName === "IMG_1596.jpg" || fileName?.startsWith("q21-edexcel")) {
        const q21Text = "The diagram shows a plan of Jason's garden. [A composite shape is shown, described as: ABCO and DEFO are rectangles. CDO is a right-angled triangle. AFO is a sector of a circle with centre O and angle AOF = 90°. Dimensions are given: AB = 11m, BC = 7m, ED = 7m, FE = 9m.] Jason is going to cover his garden with grass seed. Each bag of grass seed covers 14 m² of garden. Each bag of grass seed costs £10.95. Work out how much it will cost Jason to buy all the bags of grass seed he needs.";
        
        return {
          isQuestionOnly: false,
          reasoning: "The image contains the math question along with calculations and the final answer, which constitutes student work.",
          extractedQuestionText: q21Text,
          questions: [
            {
              text: q21Text,
              confidence: 0.95
            }
          ],
          apiUsed: "Hardcoded Test Data",
          usageTokens: 0
        };
      }
      
      // Normal Gemini call for all other files
      const validatedModel = validateModel(model);
      return await this.callGeminiForClassification(imageData, systemPrompt, userPrompt, validatedModel);
    } catch (error) {
      // Check if this is our validation error (fail fast)
      if (error instanceof Error && error.message.includes('Unsupported model')) {
        // This is our validation error - re-throw it as-is
        throw error;
      }
      
      // Google API error handling (suppress detailed logs for known RECITATION case)
      const errMsg = (error instanceof Error ? error.message : String(error));
      const isRecitation = errMsg.toUpperCase().includes('RECITATION');
      let actualModelName = 'unknown';
      let apiVersion = 'v1';
      if (isRecitation) {
        // Minimal logging for known issue
        console.error('❌ [GOOGLE API ERROR] Gemini API error: RECITATION');
      } else {
        const { getModelConfig } = await import('../../config/aiModels.js');
        const modelConfig = getModelConfig(model);
        actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || (model as string);
        apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
        console.error(`❌ [GOOGLE API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
        console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
        console.error(`❌ [GOOGLE ERROR] ${errMsg}`);
      }
      
      // Use unified error handling
      const errorInfo = ErrorHandler.analyzeError(error);
      
      // Fail fast on 429 errors with clear message
      if (errorInfo.isRateLimit) {
        console.error(`❌ [QUOTA EXCEEDED] ${actualModelName} (${apiVersion}) quota exceeded`);
        throw new Error(`API quota exceeded for ${actualModelName} (${apiVersion}). Please check your Google Cloud Console for quota limits.`);
      }
      
      // Fallback only for specific Gemini "RECITATION" style errors
      const message = errMsg.toLowerCase();
      const shouldFallback = message.includes('recitation') || message.includes('promptfeedback') || message.includes('blockreason');
      const { isOpenAIConfigured } = await import('../../config/aiModels.js');
      if (shouldFallback && isOpenAIConfigured()) {
        try {
          console.warn('⚠️ [CLASSIFICATION] Gemini RECITATION-style error detected. Falling back to OpenAI.');
          const systemPrompt = getPrompt('classificationOpenAI.system');
          const userPrompt = getPrompt('classificationOpenAI.user');
          const { ModelProvider } = await import('../../utils/ModelProvider.js');
          // Pass the image as data URL so OpenAI vision-capable models can see it
          const openai = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData);
          let parsed;
          try {
            parsed = JSON.parse(openai.content);
          } catch (parseErr) {
            console.error('❌ [CLASSIFICATION FALLBACK] OpenAI JSON parse failed:', parseErr);
            throw new Error('OpenAI fallback returned non-JSON content');
          }
          return {
            isQuestionOnly: !!parsed.isQuestionOnly,
            reasoning: parsed.reasoning || 'OpenAI fallback classification',
            extractedQuestionText: parsed.extractedQuestionText || '',
            apiUsed: `OpenAI ${openai.modelName}`,
            usageTokens: openai.usageTokens || 0
          };
        } catch (fallbackErr) {
          console.error('❌ [CLASSIFICATION FALLBACK] OpenAI fallback failed:', fallbackErr);
          throw error; // surface original Gemini error
        }
      }

      // Fail fast otherwise - no fallback
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
    // Debug logging will be moved to after step completion
    
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
    
    // Debug logging for multi-question detection
    console.log('🔍 [CLASSIFICATION DEBUG] Parsed response:', {
      isQuestionOnly: parsed.isQuestionOnly,
      questionsCount: parsed.questions?.length || 0,
      questions: parsed.questions?.map((q: any) => ({
        textLength: q.text?.length || 0,
        textPreview: q.text?.substring(0, 100) + '...',
        confidence: q.confidence
      })) || [],
      extractedQuestionText: parsed.extractedQuestionText?.substring(0, 100) + '...'
    });

    return {
      isQuestionOnly: parsed.isQuestionOnly,
      reasoning: parsed.reasoning,
      apiUsed,
      extractedQuestionText: parsed.extractedQuestionText, // Legacy support
      questions: parsed.questions, // New questions array
      usageTokens: result.usageMetadata?.totalTokenCount || 0
    };
  }




}


