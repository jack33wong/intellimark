import type { ModelType } from '../types/index.js';
import * as path from 'path';

export type ModelPhase = 'classification' | 'marking' | 'questionMode' | 'contextChat' | 'modelAnswer' | 'markingScheme' | 'sampleQuestion' | 'analysis' | 'performanceSummary' | 'other';

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
        const isRetryable = error.message.includes('429') || // Too Many Requests
          error.message.includes('503') || // Service Unavailable
          error.message.includes('Resource exhausted'); // Gemini specific

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
    const accessToken = this.getGeminiApiKey();
    const response = await this.makeGeminiTextRequest(accessToken, systemPrompt, userPrompt, model, forceJsonResponse);
    const result = await response.json() as any;
    const content = this.extractGeminiTextContent(result);

    // Extract REAL input/output split from API response
    let inputTokens = (result.usageMetadata?.promptTokenCount as number) || 0;
    let outputTokens = (result.usageMetadata?.candidatesTokenCount as number) || 0;
    let totalTokens = (result.usageMetadata?.totalTokenCount as number) || 0;

    // Defensive fallback: If API returns 0 or missing usageMetadata, estimate based on content length
    // (approx 4 chars per token) to ensure non-zero tracking for successful responses
    if (totalTokens === 0 && content) {
      inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
      outputTokens = Math.ceil(content.length / 4);
      totalTokens = inputTokens + outputTokens;
    }

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

  static async callGeminiChat(
    systemPrompt: string,
    userPrompt: string,
    imageData: string | string[],
    model: ModelType = 'auto',
    tracker?: any,
    phase: ModelPhase = 'other'
  ): Promise<{ content: string; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
    const accessToken = this.getGeminiApiKey();
    const response = await this.makeGeminiChatRequest(accessToken, imageData, systemPrompt, userPrompt, model, phase);
    const result = await response.json() as any;
    const content = this.extractGeminiTextContent(result);

    // Extract REAL input/output split
    let inputTokens = (result.usageMetadata?.promptTokenCount as number) || 0;
    let outputTokens = (result.usageMetadata?.candidatesTokenCount as number) || 0;
    let totalTokens = (result.usageMetadata?.totalTokenCount as number) || 0;

    // Defensive fallback: If API returns 0 or missing usageMetadata, estimate based on content length
    if (totalTokens === 0 && content) {
      // For images, we add a base cost of ~258 tokens (standard for many models) 
      // plus character count of prompts
      inputTokens = 258 + Math.ceil((systemPrompt.length + userPrompt.length) / 4);
      outputTokens = Math.ceil(content.length / 4);
      totalTokens = inputTokens + outputTokens;
    }

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

  private static async makeGeminiChatRequest(
    accessToken: string,
    imageData: string | string[],
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto',
    phase: ModelPhase = 'other'
  ): Promise<Response> {
    return this.withRetry(async () => {
      const { getModelConfig } = await import('../config/aiModels.js');
      const config = getModelConfig(model);
      const endpoint = config.apiEndpoint;

      const parts: any[] = [
        { text: systemPrompt },
        { text: userPrompt }
      ];

      // Handle single or multiple images
      const images = Array.isArray(imageData) ? imageData : [imageData];
      const isMultiImageMarking = images.length > 1 && phase === 'marking';

      images.forEach((img, index) => {
        if (img && img.trim() !== '') {
          // If multi-image marking, add a text part before each image to help AI orient itself
          if (isMultiImageMarking) {
            parts.push({ text: `\n--- Page Index ${index} ---` });
          }

          const cleanImageData = img.includes('base64,') ? img.split('base64,')[1] : img;
          parts.push({
            inline_data: {
              mime_type: 'image/jpeg',
              data: cleanImageData
            }
          });
        }
      });

      const response = await fetch(`${endpoint}?key=${accessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
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
    }, 5, 2000);
  }

  /**
   * Get Gemini API key for AI Studio
   * Reads from GEMINI_API_KEY environment variable
   */
  static getGeminiApiKey(): string {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured in environment');
    }

    return apiKey;
  }

  private static async makeGeminiTextRequest(
    accessToken: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'auto',
    forceJsonResponse: boolean = false
  ): Promise<Response> {
    return this.withRetry(async () => {
      // Use centralized model configuration
      const { getModelConfig } = await import('../config/aiModels.js');
      const config = getModelConfig(model);
      const endpoint = config.apiEndpoint;

      const response = await fetch(`${endpoint}?key=${accessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
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
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return response;
    }, 5, 2000);
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
    phase: ModelPhase = 'other'
  ): Promise<{ content: string; usageTokens: number; inputTokens?: number; outputTokens?: number }> {
    // Resolve 'auto' to default model
    const resolvedModel = model === 'auto' ? 'gemini-2.0-flash' : model;

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
    imageData?: string,
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
