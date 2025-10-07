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
  'auto': {
    name: 'Auto (Recommended)',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
    maxTokens: 8000, // Within gemini-2.0-flash-lite limit of 8192
    temperature: 0.1
  },
  'gemini-2.0-flash-lite': {
    name: 'Google Gemini 2.0 Flash Lite',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
    maxTokens: 8192,
    temperature: 0.1
  },
  'gemini-2.5-pro': {
    name: 'Google Gemini 2.5 Pro (Latest)',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    maxTokens: 8000,
    temperature: 0.1
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
  return 'gemini-2.0-flash-lite'; // Return the actual model that 'auto' maps to
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
    case 'auto':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with efficient processing.`;
    case 'gemini-2.5-pro':
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
    case 'auto':
      return {
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: 0.8,
        topK: 40
      };
    case 'gemini-2.0-flash-lite':
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
    default:
      return {
        temperature: config.temperature
      };
  }
}
