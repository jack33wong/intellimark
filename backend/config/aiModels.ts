/**
 * AI Model Configuration for Mark Homework System
 * Centralized configuration for all supported AI models
 */

import { ModelType, AIModelConfig } from '../types/index.js';



/**
 * Configuration for all supported AI models
 */
export const AI_MODELS: Record<Exclude<ModelType, 'auto'>, AIModelConfig> = {

  'gemini-3.1-flash-lite': {
    name: 'Gemini 3.1 Flash-Lite',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
    maxTokens: 4096,
    temperature: 0.3,
    label: 'Fast',
    description: 'Answers quickly'
  },
  'gemini-3-flash-preview': {
    name: 'Gemini 3 Flash Preview',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    maxTokens: 4096,
    temperature: 0.1,
    label: 'Thinking',
    description: 'Deep reasoning, takes longer'
  },
  'gemini-3.5-flash': {
    name: 'Gemini 3.5 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    maxTokens: 4096,
    temperature: 0.1,
    label: 'Pro',
    description: 'Best for complex coding & math'
  },
  'gemini-2.5-flash-lite': {
    name: 'Gemini 2.5 Flash-Lite',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    maxTokens: 4096,
    temperature: 0.3,
    label: 'Fast',
    description: 'Answers quickly'
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    maxTokens: 4096,
    temperature: 0.1,
    label: 'Thinking',
    description: 'Deep reasoning, takes longer'
  },
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    maxTokens: 4096,
    temperature: 0.1,
    label: 'Pro',
    description: 'Best for complex coding & math'
  },
  'openai-gpt-4o': {
    name: 'OpenAI GPT-4o',
    apiEndpoint: 'openai', // Special marker for OpenAI provider
    maxTokens: 16384,
    temperature: 0.1,
    label: 'GPT-4o',
    description: 'OpenAI flagship model'
  },
  'openai-gpt-4o-mini': {
    name: 'OpenAI GPT-4o Mini',
    apiEndpoint: 'openai', // Special marker for OpenAI provider
    maxTokens: 16384,
    temperature: 0.1
  },

};

/**
 * Model Tiers mapping
 */
export const MODEL_TIERS: Record<string, ModelType> = {
  'fast': 'gemini-2.5-flash',
  'thinking': 'gemini-2.5-flash',
  'pro': 'gemini-3.5-flash',
  'gpt-4o': 'openai-gpt-4o',
  'gpt-4o-mini': 'openai-gpt-4o-mini',
  'auto': 'gemini-2.5-flash' // Default tier mapping
};

/**
 * Resolve a tier string or model string to an actual model type
 * @param modelOrTier - The model or tier string
 * @returns The resolved model type
 */
export function resolveModelTier(modelOrTier: string): ModelType {
  if (modelOrTier === 'auto' || !modelOrTier) {
    return 'gemini-2.5-flash';
  }
  
  // If it's a known tier, resolve it
  if (modelOrTier in MODEL_TIERS) {
    return MODEL_TIERS[modelOrTier];
  }
  
  // If it's already an exact model ID that exists, use it
  if (modelOrTier in AI_MODELS) {
    return modelOrTier as ModelType;
  }
  
  // Fallback
  return 'gemini-2.5-flash';
}

/**
 * Get configuration for a specific model or tier
 * @param modelOrTier - The type of AI model or tier
 * @returns The model configuration
 * @throws Error if model type is not supported
 */
export function getModelConfig(modelOrTier: string): AIModelConfig {
  const modelType = resolveModelTier(modelOrTier);
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
 * Get the default model (now returns the default tier 'fast')
 * @returns The default model tier ('fast')
 */
export function getDefaultModel(): string {
  return 'fast';
}

/**
 * Get the default classification model
 * @returns The default classification model tier ('fast')
 */
export function getClassificationModel(): string {
  return 'fast'; // Default classification model tier
}

/**
 * Validate model configuration
 * @param modelOrTier - The type of AI model or tier to validate
 * @returns True if the model configuration is valid
 */
export function validateModelConfig(modelOrTier: string): boolean {
  try {
    const config = getModelConfig(modelOrTier);
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
 * @param modelOrTier - The model or tier string to validate
 * @returns The validated ModelType
 * @throws Error if model is not supported
 */
export function validateModel(modelOrTier: string): ModelType {
  const modelType = resolveModelTier(modelOrTier);
  if (!(modelType in AI_MODELS)) {
    const supportedModels = Object.keys(AI_MODELS).join(', ');
    throw new Error(`Unsupported model: ${modelOrTier}. Supported models: ${supportedModels}`);
  }
  return modelType;
}

/**
 * Get list of all supported model types
 * @returns Array of supported ModelType values
 */
export function getSupportedModels(): ModelType[] {
  return Object.keys(AI_MODELS) as ModelType[];
}

/**
 * Check if a model or tier is supported
 * @param modelOrTier - The model or tier string to check
 * @returns True if the model is supported
 */
export function isModelSupported(modelOrTier: string): boolean {
  try {
    const resolved = resolveModelTier(modelOrTier);
    return resolved in AI_MODELS;
  } catch {
    return false;
  }
}

/**
 * Get model-specific prompt templates
 * @param modelOrTier - The type of AI model or tier
 * @returns Prompt template for the model
 */
export function getModelPromptTemplate(modelOrTier: string): string {
  const modelType = resolveModelTier(modelOrTier);
  const basePrompt = `You are an expert mathematics tutor. Please analyze the provided homework or question and provide detailed feedback, step-by-step solutions, and constructive comments.`;

  switch (modelType) {
    case 'gemini-2.5-flash':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with efficient processing.`;
    case 'gemini-2.5-flash-lite':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with efficient processing and the latest generation model capabilities.`;
    default:
      return basePrompt;
  }
}

/**
 * Get model-specific parameters for API calls
 * @param modelOrTier - The type of AI model or tier
 * @returns Parameters object for the model
 */
export function getModelParameters(modelOrTier: string): Record<string, any> {
  const modelType = resolveModelTier(modelOrTier);
  const config = getModelConfig(modelType);

  switch (modelType) {
    case 'gemini-2.5-flash-lite':
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: 0.8,
        topK: 40
      };
    default:
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature
      };
  }
}

/**
 * Get detailed model information including name, version, and configuration
 * @param modelOrTier - The type of AI model or tier
 * @returns Object containing model configuration, name, and API version
 */
export function getModelInfo(modelOrTier: string): { config: AIModelConfig; modelName: string; apiVersion: string } {
  const modelType = resolveModelTier(modelOrTier);
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
