import type { ModelType } from '../types/index.js';
import * as path from 'path';

export type ModelPhase = 'preFlight' | 'classification' | 'marking' | 'questionMode' | 'contextChat' | 'modelAnswer' | 'markingScheme' | 'sampleQuestion' | 'analysis' | 'performanceSummary' | 'other';

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


  // --- Exponential Backoff Helper ---
  /**
   * Execute an operation with exponential backoff retry logic
   * Specifically handles 429 (Too Many Requests) and 503 (Service Unavailable)
   */
  public static async withRetry<T>(
    operation: () => Promise<T>,
    retries = 3, // Default retries
    initialDelay = 2000 // Start with 2 seconds
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        attempt++;

        // Check if we should retry
        const isRetryable =
          error.message.includes('429') || // Too Many Requests
          error.message.includes('503') || // Service Unavailable
          error.message.includes('Resource exhausted') || // Gemini specific
          error.message.includes('fetch failed') || // Node/Undici network error
          error.message.includes('timeout') || // Connection or request timeout
          error.message.includes('ECONNRESET') || // Connection reset
          error.message.includes('ETIMEDOUT') || // Connection timeout
          error.message.includes('UND_ERR_CONNECT_TIMEOUT'); // Specific Undici timeout

        if (attempt > retries || !isRetryable) {
          throw error;
        }

        // Calculate delay with exponential backoff and jitter
        // delay = initialDelay * 2^(attempt-1) + random_jitter
        const backoff = initialDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000; // 0-1000ms jitter
        const delay = backoff + jitter;

        console.warn(`⚠️ [API RETRY] Attempt ${attempt}/${retries} failed. Retrying in ${Math.round(delay)}ms... (Error: ${error.message})`);

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  static async callGeminiText(
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto',
    forceJsonResponse: boolean = false,
    tracker?: any, // UsageTracker (optional for backward compatibility during migration)
    phase: ModelPhase = 'other'
  ): Promise<{ content: string; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
    return this.withRetry(async () => {
      const { VERTEX_PROJECT_ID, VERTEX_LOCATION, getModelConfig } = await import('../config/aiModels.js');
      const config = getModelConfig(model);
      const modelName = config.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;

      const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = await import('@google/genai');
      const ai = new GoogleGenAI({});
      
      const response = await ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          temperature: config.temperature,
          maxOutputTokens: forceJsonResponse ? 65536 : Math.max(config.maxTokens || 8192, 8192),
          ...(forceJsonResponse && { responseMimeType: "application/json" }),
          systemInstruction: systemPrompt,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
          ]
        }
      });

      const content = response.text;
      
      if (!content) {
         throw new Error(`Gemini API error: No content in response`);
      }

      // Extract REAL input/output split from API response
      let inputTokens = response.usageMetadata?.promptTokenCount || 0;
      let outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      let totalTokens = response.usageMetadata?.totalTokenCount || 0;

      // Defensive fallback: If API returns 0 or missing usageMetadata, estimate based on content length
      if (totalTokens === 0 && content) {
        inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
        outputTokens = Math.ceil(content.length / 4);
        totalTokens = inputTokens + outputTokens;
      }

      // Auto-record via tracker if provided
      if (tracker) {
        switch (phase) {
          case 'preFlight': tracker.recordPreFlight(inputTokens, outputTokens); break;
          case 'classification': tracker.recordClassification(inputTokens, outputTokens); break;
          case 'marking': tracker.recordMarking(inputTokens, outputTokens); break;
          case 'questionMode': tracker.recordQuestionMode(inputTokens, outputTokens); break;
          case 'contextChat': tracker.recordContextChat(inputTokens, outputTokens); break;
          case 'modelAnswer': tracker.recordModelAnswer(inputTokens, outputTokens); break;
          case 'markingScheme': tracker.recordMarkingScheme(inputTokens, outputTokens); break;
          case 'sampleQuestion': tracker.recordSampleQuestion(inputTokens, outputTokens); break;
          case 'analysis': tracker.recordAnalysis(inputTokens, outputTokens); break;
          case 'performanceSummary': tracker.recordPerformanceSummary(inputTokens, outputTokens); break;
          default: tracker.recordOther(inputTokens, outputTokens);
        }
      }

      return { content, usageTokens: totalTokens, inputTokens, outputTokens };
    }, 5, 2000);
  }

  static async callGeminiChat(
    systemPrompt: string,
    userPrompt: string,
    imageData: string | string[],
    model: ModelType = 'auto',
    tracker?: any,
    phase: ModelPhase = 'other'
  ): Promise<{ content: string; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
    return this.withRetry(async () => {
      const { VERTEX_PROJECT_ID, VERTEX_LOCATION, getModelConfig } = await import('../config/aiModels.js');
      const config = getModelConfig(model);
      const modelName = config.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;

      const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = await import('@google/genai');
      const ai = new GoogleGenAI({});
      
      const images = Array.isArray(imageData) ? imageData : [imageData];
      const imageParts = images.map(img => {
        const cleanImageData = img.includes('base64,') ? img.split('base64,')[1] : img;
        return {
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanImageData
          }
        };
      });

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          ...imageParts,
          { text: userPrompt }
        ] as any,
        config: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens,
          systemInstruction: systemPrompt,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
          ]
        }
      });

      const content = response.text;
      
      if (!content) {
         throw new Error(`Gemini API error: No content in response`);
      }

      // Extract REAL input/output split
      let inputTokens = response.usageMetadata?.promptTokenCount || 0;
      let outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      let totalTokens = response.usageMetadata?.totalTokenCount || 0;

      if (totalTokens === 0 && content) {
        inputTokens = 258 + Math.ceil((systemPrompt.length + userPrompt.length) / 4);
        outputTokens = Math.ceil(content.length / 4);
        totalTokens = inputTokens + outputTokens;
      }

      if (tracker) {
        switch (phase) {
          case 'preFlight': tracker.recordPreFlight(inputTokens, outputTokens); break;
          case 'classification': tracker.recordClassification(inputTokens, outputTokens); break;
          case 'marking': tracker.recordMarking(inputTokens, outputTokens); break;
          case 'questionMode': tracker.recordQuestionMode(inputTokens, outputTokens); break;
          case 'contextChat': tracker.recordContextChat(inputTokens, outputTokens); break;
          case 'modelAnswer': tracker.recordModelAnswer(inputTokens, outputTokens); break;
          case 'markingScheme': tracker.recordMarkingScheme(inputTokens, outputTokens); break;
          case 'sampleQuestion': tracker.recordSampleQuestion(inputTokens, outputTokens); break;
          case 'analysis': tracker.recordAnalysis(inputTokens, outputTokens); break;
          case 'performanceSummary': tracker.recordPerformanceSummary(inputTokens, outputTokens); break;
          default: tracker.recordOther(inputTokens, outputTokens);
        }
      }

      return { content, usageTokens: totalTokens, inputTokens, outputTokens };
    }, 5, 2000);
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
    phase: ModelPhase = 'other'
  ): Promise<{ content: string; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
    // Resolve tier to actual model using aiModels
    const { resolveModelTier } = await import('../config/aiModels.js');
    const resolvedModel = resolveModelTier(model);

    // Detect provider from model name
    const isOpenAI = resolvedModel.startsWith('openai-');

    if (isOpenAI) {
      // Use OpenAI - extract model name from full ID (e.g., 'openai-gpt-4o' -> 'gpt-4o')
      const openaiModelName = resolvedModel.replace('openai-', '');
      const result = await this.callOpenAIText(systemPrompt, userPrompt, openaiModelName, forceJsonResponse, tracker, phase);
      return {
        content: result.content,
        usageTokens: result.usageTokens,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
      };
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
    imageData?: string | string[],
    modelName?: string,
    forceJsonResponse: boolean = true,
    tracker?: any,
    phase: ModelPhase = 'other'
  ): Promise<{ content: string; usageTokens: number; modelName: string; inputTokens?: number; outputTokens?: number }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    const { getOpenAIEndpoint, getOpenAIModelName } = await import('../config/aiModels.js');
    const endpoint = getOpenAIEndpoint();
    const model = modelName || getOpenAIModelName();

    // Build messages. If imageData is provided, use array content with image_url per OpenAI vision design
    let userContent: any[] = [{ type: 'text', text: userPrompt }];

    if (imageData) {
      const images = Array.isArray(imageData) ? imageData : [imageData];
      images.forEach(img => {
        if (img && img.trim() !== '') {
          const cleanImageData = img.includes('base64,') ? img.split('base64,')[1] : img;
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${cleanImageData}` }
          });
        }
      });
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    const body: any = {
      model,
      messages,
      max_tokens: 8192
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
        case 'preFlight':
          tracker.recordPreFlight(inputTokens, outputTokens);
          break;
        case 'classification':
          tracker.recordClassification(inputTokens, outputTokens);
          break;
        case 'marking':
          tracker.recordMarking(inputTokens, outputTokens);
          break;
        case 'questionMode':
          tracker.recordQuestionMode(inputTokens, outputTokens);
          break;
        case 'contextChat':
          tracker.recordContextChat(inputTokens, outputTokens);
          break;
        case 'modelAnswer':
          tracker.recordModelAnswer(inputTokens, outputTokens);
          break;
        case 'markingScheme':
          tracker.recordMarkingScheme(inputTokens, outputTokens);
          break;
        case 'sampleQuestion':
          tracker.recordSampleQuestion(inputTokens, outputTokens);
          break;
        case 'analysis':
          tracker.recordAnalysis(inputTokens, outputTokens);
          break;
        case 'performanceSummary':
          tracker.recordPerformanceSummary(inputTokens, outputTokens);
          break;
        default:
          tracker.recordOther(inputTokens, outputTokens);
      }
    }

    return { content, usageTokens: totalTokens, modelName: model, inputTokens, outputTokens };
  }

  static async callOpenAIChatWithMultipleImages(
    systemPrompt: string,
    userContent: Array<{ type: string; text?: string; image_url?: { url: string } }>,
    modelName?: string
  ): Promise<{ content: string; usageTokens: number; modelName: string; inputTokens?: number; outputTokens?: number }> {
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
      response_format: { type: 'json_object' },
      max_tokens: 8192
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
    const inputTokens = json.usage?.prompt_tokens || 0;
    const outputTokens = json.usage?.completion_tokens || 0;
    const totalTokens = json.usage?.total_tokens || 0;
    return { content, usageTokens: totalTokens, modelName: model, inputTokens, outputTokens };
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
    phase: ModelPhase = 'other'
  ): Promise<{ content: string; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
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
      messages,
      max_tokens: 8192
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
        case 'preFlight':
          tracker.recordPreFlight(inputTokens, outputTokens);
          break;
        case 'classification':
          tracker.recordClassification(inputTokens, outputTokens);
          break;
        case 'marking':
          tracker.recordMarking(inputTokens, outputTokens);
          break;
        case 'questionMode':
          tracker.recordQuestionMode(inputTokens, outputTokens);
          break;
        case 'contextChat':
          tracker.recordContextChat(inputTokens, outputTokens);
          break;
        case 'modelAnswer':
          tracker.recordModelAnswer(inputTokens, outputTokens);
          break;
        case 'markingScheme':
          tracker.recordMarkingScheme(inputTokens, outputTokens);
          break;
        case 'sampleQuestion':
          tracker.recordSampleQuestion(inputTokens, outputTokens);
          break;
        case 'analysis':
          tracker.recordAnalysis(inputTokens, outputTokens);
          break;
        case 'performanceSummary':
          tracker.recordPerformanceSummary(inputTokens, outputTokens);
          break;
        default:
          tracker.recordOther(inputTokens, outputTokens);
      }
    }

    return { content, usageTokens: totalTokens, inputTokens, outputTokens };
  }

}
