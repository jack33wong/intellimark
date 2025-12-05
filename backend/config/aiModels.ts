/**
 * AI Model Configuration for Mark Homework System
 * Centralized configuration for all supported AI models
 */

import { ModelType, AIModelConfig } from '../types/index.js';

/**
 * Debug Mode Configuration
 * When enabled, disables all external API calls and uses mock responses
 */
export const DEBUG_MODE = {
  enabled: false, // Disabled for production
  fakeDelayMs: 1000, // 1 second delay for each API call
  returnOriginalImage: true // Return original image instead of processed results
};

/**
 * Runtime debug mode state
 * This can be modified at runtime via the debug API
 */
let runtimeDebugMode = {
  enabled: false,
  fakeDelayMs: 1000,
  returnOriginalImage: false // Default: return AI-annotated images (normal operation)
};

/**
 * Get current debug mode configuration
 * Returns runtime state if available, otherwise defaults
 */
export function getDebugMode() {
  return runtimeDebugMode;
}

/**
 * Update debug mode configuration at runtime
 */
export function setDebugMode(debugMode: boolean) {
  runtimeDebugMode.enabled = debugMode;
  // When debug mode is ON, return original images (for testing)
  // When debug mode is OFF, return AI-annotated images (normal operation)
  runtimeDebugMode.returnOriginalImage = debugMode;
}

/**
 * Configuration for all supported AI models
 */
export const AI_MODELS: Record<ModelType, AIModelConfig> = {
  'gemini-2.0-flash': {
    name: 'Google Gemini 2.0 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
    maxTokens: 64000,
    temperature: 0.1
  },
  'gemini-2.5-flash': {
    name: 'Google Gemini 2.5 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    maxTokens: 64000,
    temperature: 0.1
  },
  'gemini-2.5-pro': {
    name: 'Google Gemini 2.5 Pro',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    maxTokens: 64000,
    temperature: 0.1
  },
  'gemini-3-pro-preview': {
    name: 'Google Gemini 3 Pro Preview',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent',
    maxTokens: 64000,
    temperature: 0.1
  },
  'openai-gpt-4o': {
    name: 'OpenAI GPT-4o',
    apiEndpoint: 'openai', // Special marker for OpenAI provider
    maxTokens: 16384,
    temperature: 0.1
  },
  'openai-gpt-4o-mini': {
    name: 'OpenAI GPT-4o Mini',
    apiEndpoint: 'openai', // Special marker for OpenAI provider
    maxTokens: 16384,
    temperature: 0.1
  },

};

/**
 * Get configuration for a specific model
 * @param modelType - The type of AI model
 * @returns The model configuration
 * @throws Error if model type is not supported
 */
export function getModelConfig(modelType: ModelType): AIModelConfig {
  const config = AI_MODELS[modelType];
  if (!config) {
    throw new Error(`Unsupported model type: ${modelType}`);
  }
  return config;
}

/**
 * Get all available model types
 * @returns Array of available model types
 */
export function getAvailableModels(): ModelType[] {
  return Object.keys(AI_MODELS) as ModelType[];
}

/**
 * Get model display name
 * @param modelType - The type of AI model
 * @returns The display name for the model
 */
export function getModelDisplayName(modelType: ModelType): string {
  return AI_MODELS[modelType]?.name || modelType;
}


/**
 * Get default model configuration
 * @returns The default model type
 */
export function getDefaultModel(): ModelType {
  return 'gemini-2.0-flash'; // Default model is now Gemini 2.0 Flash
}

/**
 * Validate model configuration
 * @param modelType - The type of AI model to validate
 * @returns True if the model configuration is valid
 */
export function validateModelConfig(modelType: ModelType): boolean {
  try {
    const config = getModelConfig(modelType);
    return !!(
      config.name &&
      config.apiEndpoint &&
      config.maxTokens &&
      typeof config.temperature === 'number'
    );
  } catch {
    return false;
  }
}

/**
 * Validate and normalize model string to ModelType
 * @param model - The model string to validate
 * @returns The validated ModelType
 * @throws Error if model is not supported
 */
export function validateModel(model: string): ModelType {
  if (!(model in AI_MODELS)) {
    const supportedModels = Object.keys(AI_MODELS).join(', ');
    throw new Error(`Unsupported model: ${model}. Supported models: ${supportedModels}`);
  }
  return model as ModelType;
}

/**
 * Get list of all supported model types
 * @returns Array of supported ModelType values
 */
export function getSupportedModels(): ModelType[] {
  return Object.keys(AI_MODELS) as ModelType[];
}

/**
 * Check if a model is supported
 * @param model - The model string to check
 * @returns True if the model is supported
 */
export function isModelSupported(model: string): boolean {
  return model in AI_MODELS;
}

/**
 * Get model-specific prompt templates
 * @param modelType - The type of AI model
 * @returns Prompt template for the model
 */
export function getModelPromptTemplate(modelType: ModelType): string {
  const basePrompt = `You are an expert mathematics tutor. Please analyze the provided homework or question and provide detailed feedback, step-by-step solutions, and constructive comments.`;

  switch (modelType) {
    case 'gemini-2.0-flash':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with efficient processing.`;
    case 'gemini-2.5-flash':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with efficient processing.`;
    case 'gemini-2.5-pro':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with advanced reasoning capabilities.`;
    case 'gemini-3-pro-preview':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with advanced reasoning capabilities.`;
    default:
      return basePrompt;
  }
}

/**
 * Get model-specific parameters for API calls
 * @param modelType - The type of AI model
 * @returns Parameters object for the model
 */
export function getModelParameters(modelType: ModelType): Record<string, any> {
  const config = getModelConfig(modelType);

  switch (modelType) {
    case 'gemini-2.0-flash':
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: 0.8,
        topK: 40
      };
    case 'gemini-2.5-flash':
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: 0.8,
        topK: 40
      };
    case 'gemini-2.5-pro':
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: 0.8,
        topK: 40
      };
    case 'gemini-3-pro-preview':
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: 0.8,
        topK: 40
      };
    default:
      return {
        temperature: config.temperature
      };
  }
}

/**
 * Get detailed model information including name, version, and configuration
 * @param modelType - The type of AI model
 * @returns Object containing model configuration, name, and API version
 */
export function getModelInfo(modelType: ModelType): { config: AIModelConfig; modelName: string; apiVersion: string } {
  const config = getModelConfig(modelType);
  const modelName = config.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || modelType;
  const apiVersion = config.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
  return { config, modelName, apiVersion };
}

// ----------------------------------------------------------------------------
// OpenAI (fallback) configuration helpers
// ----------------------------------------------------------------------------

/** Returns true if OpenAI fallback is configured via env */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** Get OpenAI model name (from env or default) */
export function getOpenAIModelName(): string {
  return process.env.OPENAI_MODEL || 'gpt-4o'; // Upgraded to gpt-4o for better vision capabilities
}

/** Get OpenAI API endpoint for chat completions */
export function getOpenAIEndpoint(): string {
  return process.env.OPENAI_API_BASE || 'https://api.openai.com/v1/chat/completions';
}
