import type { ModelType } from '../../types/index.js';
import * as path from 'path';

export class ModelProvider {
  static async callGeminiText(systemPrompt: string, userPrompt: string): Promise<{ content: string; usageTokens: number }> {
    const accessToken = await this.getGeminiAccessToken();
    const response = await this.makeGeminiTextRequest(accessToken, systemPrompt, userPrompt);
    const result = await response.json() as any;
    const content = this.extractGeminiTextContent(result);
    const usageTokens = (result.usageMetadata?.totalTokenCount as number) || 0;
    return { content, usageTokens };
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

  private static async makeGeminiTextRequest(
    accessToken: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<Response> {
    // Use centralized model configuration
    const { getModelConfig } = await import('../../config/aiModels.js');
    const config = getModelConfig('auto');
    const endpoint = config.apiEndpoint;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }, { text: userPrompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8000 } // Use centralized config
      })
    });
    
    if (!response.ok) {
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
    }
    
    return response;
  }

  private static extractGeminiTextContent(result: any): string {
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('No content in Gemini response');
    return content;
  }

}


