import type { ModelType } from '../types/index.js';
import * as path from 'path';

export class ModelProvider {
  /**
   * Check if an OpenAI model supports temperature 0
   * Some newer models (e.g., gpt-5-mini) only support default temperature (1)
   * @param modelName - The OpenAI model name (e.g., 'gpt-5-mini', 'gpt-4o')
   * @returns true if model supports temperature 0, false if it requires default
   */
  private static supportsTemperatureZero(modelName: string): boolean {
    // Models that only support default temperature (1)
    const modelsRequiringDefault = ['gpt-5-mini', 'gpt-5'];

    // Check if model name contains any of the restricted models
    return !modelsRequiringDefault.some(restricted => modelName.includes(restricted));
  }

  static async callGeminiText(
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto',
    forceJsonResponse: boolean = false,
    tracker?: any, // UsageTracker (optional for backward compatibility during migration)
    phase: 'classification' | 'marking' | 'questionMode' | 'other' = 'other'
  ): Promise<{ content: string; usageTokens: number }> {
    const accessToken = await this.getGeminiAccessToken();
    const response = await this.makeGeminiTextRequest(accessToken, systemPrompt, userPrompt, model, forceJsonResponse);
    const result = await response.json() as any;
    const content = this.extractGeminiTextContent(result);

    // Extract REAL input/output split from API response
    const inputTokens = (result.usageMetadata?.promptTokenCount as number) || 0;
    const outputTokens = (result.usageMetadata?.candidatesTokenCount as number) || 0;
    const totalTokens = (result.usageMetadata?.totalTokenCount as number) || 0;

    // Auto-record via tracker if provided
    if (tracker) {
      switch (phase) {
        case 'classification':
          tracker.recordClassification(inputTokens, outputTokens);
          break;
        case 'marking':
          tracker.recordMarking(inputTokens, outputTokens);
          break;
        case 'questionMode':
          tracker.recordQuestionMode(inputTokens, outputTokens);
          break;
        default:
          tracker.recordOther(inputTokens, outputTokens);
      }
    }

    return { content, usageTokens: totalTokens };
  }

  static async callGeminiChat(
    systemPrompt: string,
    userPrompt: string,
    imageData: string | string[],
    model: ModelType = 'auto',
    tracker?: any,
    phase: 'classification' | 'marking' | 'questionMode' | 'other' = 'other'
  ): Promise<{ content: string; usageTokens: number }> {
    const accessToken = await this.getGeminiAccessToken();
    const response = await this.makeGeminiChatRequest(accessToken, imageData, systemPrompt, userPrompt, model);
    const result = await response.json() as any;
    const content = this.extractGeminiTextContent(result);

    // Extract REAL input/output split
    const inputTokens = (result.usageMetadata?.promptTokenCount as number) || 0;
    const outputTokens = (result.usageMetadata?.candidatesTokenCount as number) || 0;
    const totalTokens = (result.usageMetadata?.totalTokenCount as number) || 0;

    // Auto-record via tracker
    if (tracker) {
      switch (phase) {
        case 'classification':
          tracker.recordClassification(inputTokens, outputTokens);
          break;
        case 'marking':
          tracker.recordMarking(inputTokens, outputTokens);
          break;
        case 'questionMode':
          tracker.recordQuestionMode(inputTokens, outputTokens);
          break;
        default:
          tracker.recordOther(inputTokens, outputTokens);
      }
    }

    return { content, usageTokens: totalTokens };
  }

  private static async makeGeminiChatRequest(
    accessToken: string,
    imageData: string | string[],
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto'
  ): Promise<Response> {
    const { getModelConfig } = await import('../config/aiModels.js');
    const config = getModelConfig(model);
    const endpoint = config.apiEndpoint;

    const parts: any[] = [
      { text: systemPrompt },
      { text: userPrompt }
    ];

    // Handle single or multiple images
    const images = Array.isArray(imageData) ? imageData : [imageData];

    images.forEach(img => {
      if (img && img.trim() !== '') {
        const cleanImageData = img.includes('base64,') ? img.split('base64,')[1] : img;
        parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: cleanImageData
          }
        });
      }
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: [{
          parts: parts
        }],
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });



    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private static cachedAccessToken: string | null = null;
  private static tokenExpiry: number = 0;

  static async getGeminiAccessToken(): Promise<string> {
    // Check if cached token is valid (with 5-minute buffer)
    if (this.cachedAccessToken && Date.now() < this.tokenExpiry - 5 * 60 * 1000) {
      return this.cachedAccessToken;
    }

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

    // Cache the token
    this.cachedAccessToken = accessToken.token;
    // Set expiry (default to 1 hour if not provided, minus buffer)
    // accessToken.res.data.expires_in is in seconds
    const expiresIn = (accessToken.res?.data as any)?.expires_in || 3600;
    this.tokenExpiry = Date.now() + (expiresIn * 1000);

    console.log(`[MODEL PROVIDER] 🔑 Refreshed Google Access Token (Expires in ${expiresIn}s)`);

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

      // Capture error response body for detailed diagnostics
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (e) {
        errorBody = 'Unable to read error response body';
      }

      // Log detailed error information
      console.error(`❌ [MODEL PROVIDER ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [HTTP STATUS] ${response.status} ${response.statusText}`);
      console.error(`❌ [ERROR RESPONSE BODY] ${errorBody}`);

      // Try to parse error body for structured error info
      let parsedError = null;
      try {
        parsedError = JSON.parse(errorBody);
        if (parsedError.error) {
          console.error(`❌ [ERROR DETAILS]`, JSON.stringify(parsedError.error, null, 2));
        }
      } catch (e) {
        // Not JSON, that's okay
      }

      // Include error details in thrown error
      const errorMessage = parsedError?.error?.message || errorBody || response.statusText;
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} for ${actualModelName} (${apiVersion}) - ${errorMessage}`);
    }

    return response;
  }

  static extractGeminiTextContent(result: any): string {
    const candidate = result.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text;
    const finishReason = candidate?.finishReason;

    // Check for truncation even if content exists
    if (finishReason === 'MAX_TOKENS') {
      const tokenCount = result.usageMetadata?.totalTokenCount || 'unknown';
      const modelVersion = result.modelVersion || 'unknown';
      throw new Error(`Gemini response truncated (MAX_TOKENS). Generated ${tokenCount} tokens using model version ${modelVersion}. The model limit may be lower than configured.`);
    }

    if (!content) {
      // Extract meaningful error from Gemini response
      const errorMessage = result.error?.message ||
        finishReason ||
        result.promptFeedback?.blockReason ||
        'No content in Gemini response';
      throw new Error(`Gemini API error: ${errorMessage}`);
    }
    return content;
  }

  // ----------------------------------------------------------------------------
  // Unified Text Call - Routes to Gemini or OpenAI based on model type
  // ----------------------------------------------------------------------------
  static async callText(
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto',
    forceJsonResponse: boolean = false,
    tracker?: any,
    phase: 'classification' | 'marking' | 'questionMode' | 'other' = 'other'
  ): Promise<{ content: string; usageTokens: number }> {
    // Resolve 'auto' to default model
    const resolvedModel = model === 'auto' ? 'gemini-2.5-flash' : model;

    // Detect provider from model name
    const isOpenAI = resolvedModel.startsWith('openai-');

    if (isOpenAI) {
      // Use OpenAI - extract model name from full ID (e.g., 'openai-gpt-4o' -> 'gpt-4o')
      const openaiModelName = resolvedModel.replace('openai-', '');
      const result = await this.callOpenAIText(systemPrompt, userPrompt, openaiModelName, forceJsonResponse, tracker, phase);
      return { content: result.content, usageTokens: result.usageTokens };
    } else {
      // Use existing Gemini method
      return await this.callGeminiText(systemPrompt, userPrompt, resolvedModel as ModelType, forceJsonResponse, tracker, phase);
    }
  }

  // ----------------------------------------------------------------------------
  // OpenAI Chat Completions (fallback and direct calls)
  // ----------------------------------------------------------------------------
  static async callOpenAIChat(
    systemPrompt: string,
    userPrompt: string,
    imageData?: string,
    modelName?: string,
    forceJsonResponse: boolean = true,
    tracker?: any,
    phase: 'classification' | 'marking' | 'questionMode' | 'other' = 'other'
  ): Promise<{ content: string; usageTokens: number; modelName: string }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    const { getOpenAIEndpoint, getOpenAIModelName } = await import('../config/aiModels.js');
    const endpoint = getOpenAIEndpoint();
    const model = modelName || getOpenAIModelName();

    // Build messages. If imageData is provided, use array content with image_url per OpenAI vision design
    const userContent = imageData
      ? [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: imageData } }
      ]
      : userPrompt;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    const body: any = {
      model,
      messages
    };

    // Only add JSON format if requested (Question Mode doesn't need it)
    if (forceJsonResponse) {
      body.response_format = { type: 'json_object' };
    }

    // Only set temperature 0 if model supports it, otherwise use default (omit parameter)
    if (this.supportsTemperatureZero(model)) {
      body.temperature = 0;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const json = await response.json() as any;
    const content = json.choices?.[0]?.message?.content || '';

    // Extract REAL input/output split
    const inputTokens = json.usage?.prompt_tokens || 0;
    const outputTokens = json.usage?.completion_tokens || 0;
    const totalTokens = json.usage?.total_tokens || 0;

    // Auto-record via tracker
    if (tracker) {
      switch (phase) {
        case 'classification':
          tracker.recordClassification(inputTokens, outputTokens);
          break;
        case 'marking':
          tracker.recordMarking(inputTokens, outputTokens);
          break;
        case 'questionMode':
          tracker.recordQuestionMode(inputTokens, outputTokens);
          break;
        default:
          tracker.recordOther(inputTokens, outputTokens);
      }
    }

    return { content, usageTokens: totalTokens, modelName: model };
  }

  static async callOpenAIChatWithMultipleImages(
    systemPrompt: string,
    userContent: Array<{ type: string; text?: string; image_url?: { url: string } }>,
    modelName?: string
  ): Promise<{ content: string; usageTokens: number; modelName: string }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    const { getOpenAIEndpoint, getOpenAIModelName } = await import('../config/aiModels.js');
    const endpoint = getOpenAIEndpoint();
    const model = modelName || getOpenAIModelName();

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    const body: any = {
      model,
      messages,
      response_format: { type: 'json_object' }
    };

    // Only set temperature 0 if model supports it, otherwise use default (omit parameter)
    if (this.supportsTemperatureZero(model)) {
      body.temperature = 0;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const json = await response.json() as any;
    const content = json.choices?.[0]?.message?.content || '';
    const usageTokens = json.usage?.total_tokens || 0;
    return { content, usageTokens, modelName: model };
  }

  /**
   * OpenAI text-only call (no images)
   * Similar to callGeminiText but for OpenAI
   */
  static async callOpenAIText(
    systemPrompt: string,
    userPrompt: string,
    modelName: string = 'gpt-4o-mini',
    forceJsonResponse: boolean = false,
    tracker?: any,
    phase: 'classification' | 'marking' | 'questionMode' | 'other' = 'other'
  ): Promise<{ content: string; usageTokens: number }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    const { getOpenAIEndpoint } = await import('../config/aiModels.js');
    const endpoint = getOpenAIEndpoint();

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const body: any = {
      model: modelName,
      messages
    };

    // Only set temperature 0 if model supports it, otherwise use default (omit parameter)
    if (this.supportsTemperatureZero(modelName)) {
      body.temperature = 0;
    }

    // Add JSON response format if requested
    if (forceJsonResponse) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const json = await response.json() as any;
    const content = json.choices?.[0]?.message?.content || '';

    // Extract REAL input/output split from OpenAI response
    const inputTokens = json.usage?.prompt_tokens || 0;
    const outputTokens = json.usage?.completion_tokens || 0;
    const totalTokens = json.usage?.total_tokens || 0;

    // Auto-record via tracker
    if (tracker) {
      switch (phase) {
        case 'classification':
          tracker.recordClassification(inputTokens, outputTokens);
          break;
        case 'marking':
          tracker.recordMarking(inputTokens, outputTokens);
          break;
        case 'questionMode':
          tracker.recordQuestionMode(inputTokens, outputTokens);
          break;
        default:
          tracker.recordOther(inputTokens, outputTokens);
      }
    }

    return { content, usageTokens: totalTokens };
  }

}
