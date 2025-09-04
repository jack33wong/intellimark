/**
 * AI Model Configuration for Mark Homework System
 * Centralized configuration for all supported AI models
 */

import { ModelType, AIModelConfig } from '../types/index';

/**
 * Configuration for all supported AI models
 */
export const AI_MODELS: Record<ModelType, AIModelConfig> = {
  'gemini-2.5-pro': {
    name: 'Google Gemini 2.5 Pro',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
    maxTokens: 8000,
    temperature: 0.1
  },
  'chatgpt-5': {
    name: 'OpenAI ChatGPT 5',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5',
    maxTokens: 8000,
    temperature: 0.1,
    maxCompletionTokens: 8000
  },
  'chatgpt-4o': {
    name: 'OpenAI GPT-4 Omni',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    maxTokens: 8000,
    temperature: 0.1,
    maxCompletionTokens: 8000
  }
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
 * Check if a model type is supported
 * @param modelType - The type of AI model to check
 * @returns True if the model is supported
 */
export function isModelSupported(modelType: string): modelType is ModelType {
  return modelType in AI_MODELS;
}

/**
 * Get default model configuration
 * @returns The default model type
 */
export function getDefaultModel(): ModelType {
  return 'chatgpt-4o';
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
 * Get model-specific prompt templates
 * @param modelType - The type of AI model
 * @returns Prompt template for the model
 */
export function getModelPromptTemplate(modelType: ModelType): string {
  const basePrompt = `You are an expert mathematics tutor. Please analyze the provided homework or question and provide detailed feedback, step-by-step solutions, and constructive comments.`;

  switch (modelType) {
    case 'gemini-2.5-pro':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy.`;
    case 'chatgpt-5':
      return `${basePrompt} Provide comprehensive explanations with mathematical rigor.`;
    case 'chatgpt-4o':
      return `${basePrompt} Offer detailed analysis with practical examples.`;
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
    case 'gemini-2.5-pro':
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: 0.8,
        topK: 40
      };
    case 'chatgpt-5':
    case 'chatgpt-4o':
      return {
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        top_p: 0.8,
        frequency_penalty: 0.1,
        presence_penalty: 0.1
      };
    default:
      return {
        temperature: config.temperature
      };
  }
}
