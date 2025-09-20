import type { ModelType } from '../../types/index';
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
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }, { text: userPrompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 4500 }
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

  static async callOpenAIText(systemPrompt: string, userPrompt: string, model: ModelType): Promise<{ content: string; usageTokens: number }> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model === 'chatgpt-5' ? 'gpt-5' : 'gpt-4o',
        messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt } ],
        ...(model === 'chatgpt-5' ? { max_completion_tokens: 1000 } : { max_tokens: 1000 })
      })
    });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(`OpenAI API request failed: ${response.status} ${JSON.stringify(result)}`);
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in OpenAI response');
    const usageTokens = (result.usage?.total_tokens as number) || 0;
    return { content, usageTokens };
  }
}


