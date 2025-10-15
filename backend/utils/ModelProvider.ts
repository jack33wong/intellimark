import type { ModelType } from '../types/index.js';
import * as path from 'path';

export class ModelProvider {
  static async callGeminiText(systemPrompt: string, userPrompt: string, model: ModelType = 'auto', forceJsonResponse: boolean = false): Promise<{ content: string; usageTokens: number }> {
    const accessToken = await this.getGeminiAccessToken();
    const response = await this.makeGeminiTextRequest(accessToken, systemPrompt, userPrompt, model, forceJsonResponse);
    const result = await response.json() as any;
    const content = this.extractGeminiTextContent(result);
    const usageTokens = (result.usageMetadata?.totalTokenCount as number) || 0;
    return { content, usageTokens };
  }

  static async getGeminiAccessToken(): Promise<string> {
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

  private static async makeGeminiTextRequest(
    accessToken: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto',
    forceJsonResponse: boolean = false
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
        contents: [{ parts: [{ text: systemPrompt }, { text: userPrompt }] }],
        generationConfig: { 
          temperature: 0, 
          maxOutputTokens: (await import('../config/aiModels.js')).getModelConfig(model).maxTokens,
          ...(forceJsonResponse && { responseMimeType: "application/json" })
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
      const { getModelConfig } = await import('../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
      
      console.error(`❌ [MODEL PROVIDER ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [HTTP STATUS] ${response.status} ${response.statusText}`);
      
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} for ${actualModelName} (${apiVersion})`);
    }
    
    return response;
  }

  static extractGeminiTextContent(result: any): string {
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      const finishReason = result.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini response exceeded maximum token limit. Consider increasing maxOutputTokens or reducing prompt length.');
      }
      throw new Error('No content in Gemini response');
    }
    return content;
  }

}


