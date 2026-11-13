/**
 * AI Model Configuration for Mark Homework System
 * Centralized configuration for all supported AI models, pricing, and tier definitions
 */

import { ModelType, AIModelConfig } from '../types/index.js';

// Vertex AI Configuration (from Environment variables)
export const VERTEX_PROJECT_ID = process.env.GCP_PROJECT_ID || 'intellimark-6649e';
export const VERTEX_LOCATION = process.env.GCP_REGION || 'europe-west2';

export type CanonicalModelId = 'gemini-3.5-flash-lite' | 'gemini-3.8-flash' | 'gemini-4-argon' | 'gemini-3.7-flash' | 'gemini-3.5-flash' | 'gemini-3.1-flash-lite' | 'gemini-3-flash-preview' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'openai-gpt-4o' | 'openai-gpt-4o-mini';

/**
 * Configuration for all supported AI models with pricing in USD per 1M tokens
 */
export const AI_MODELS: Record<CanonicalModelId, AIModelConfig> = {
  'gemini-3.5-flash-lite': {
    name: 'Gemini 3.5 Flash-Lite',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    maxTokens: 8192,
    label: 'Lite',
    description: 'Internal fast pre-flight & geometry model',
    inputPricePer1M: 0.30,
    outputPricePer1M: 2.50
  },
  'gemini-3.8-flash': {
    name: 'Gemini 3.8 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    maxTokens: 8192,
    label: 'Fast',
    description: 'Quick & accurate standard marking',
    inputPricePer1M: 0.75,
    outputPricePer1M: 3.75
  },
  'gemini-4-argon': {
    name: 'Gemini 4 Argon',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent',
    maxTokens: 8192,
    label: 'Pro',
    description: 'Frontier Gemini Argon for A-Level & complex proofs',
    inputPricePer1M: 4.00,
    outputPricePer1M: 20.00
  },

  // Legacy / fallback models kept for backward compatibility
  'gemini-3.7-flash': {
    name: 'Gemini 3.7 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
    maxTokens: 8192,
    label: 'Thinking',
    description: 'High-performance reasoning',
    inputPricePer1M: 0.75,
    outputPricePer1M: 3.75
  },
  'gemini-3.5-flash': {
    name: 'Gemini 3.5 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    maxTokens: 8192,
    label: 'Pro',
    description: 'Best for complex coding & math',
    inputPricePer1M: 1.50,
    outputPricePer1M: 9.00
  },
  'gemini-3.1-flash-lite': {
    name: 'Gemini 3.1 Flash-Lite',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
    maxTokens: 8192,
    label: 'Fast',
    description: 'Answers quickly',
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.50
  },
  'gemini-3-flash-preview': {
    name: 'Gemini 3 Flash Preview',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    maxTokens: 8192,
    label: 'Thinking',
    description: 'Deep reasoning, takes longer',
    inputPricePer1M: 0.50,
    outputPricePer1M: 3.00
  },
  'gemini-2.5-flash-lite': {
    name: 'Gemini 2.5 Flash-Lite',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    maxTokens: 8192,
    label: 'Fast',
    description: 'Answers quickly',
    inputPricePer1M: 0.10,
    outputPricePer1M: 0.40
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    maxTokens: 8192,
    label: 'Thinking',
    description: 'Deep reasoning, takes longer',
    inputPricePer1M: 0.30,
    outputPricePer1M: 2.50
  },
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    maxTokens: 8192,
    label: 'Pro',
    description: 'Best for complex coding & math',
    inputPricePer1M: 1.25,
    outputPricePer1M: 10.00
  },
  'openai-gpt-4o': {
    name: 'OpenAI GPT-4o',
    apiEndpoint: 'openai',
    maxTokens: 16384,
    label: 'GPT-4o',
    description: 'OpenAI flagship model',
    inputPricePer1M: 2.50,
    outputPricePer1M: 10.00
  },
  'openai-gpt-4o-mini': {
    name: 'OpenAI GPT-4o Mini',
    apiEndpoint: 'openai',
    maxTokens: 16384,
    label: 'GPT-4o Mini',
    description: 'OpenAI lightweight model',
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.60
  }
};

export type LogicalTierId = 'lite' | 'fast' | 'thinking' | 'pro';

export interface TierDefinition {
  id: LogicalTierId;
  modelId: string;
  thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'NONE';
  maxOutputTokens: number;
  exposeInUi: boolean;
  uiLabel: string;
  uiDescription: string;
}

export const MODEL_TIER_DEFINITIONS: Record<LogicalTierId, TierDefinition> = {
  lite: {
    id: 'lite',
    modelId: process.env.AI_MODEL_LITE || 'gemini-3.5-flash-lite',
    thinkingLevel: 'LOW',
    maxOutputTokens: 8192,
    exposeInUi: false,
    uiLabel: 'Lite (Internal)',
    uiDescription: 'Internal fast pre-flight & geometry model'
  },
  fast: {
    id: 'fast',
    modelId: process.env.AI_MODEL_FAST || 'gemini-3.8-flash',
    thinkingLevel: 'LOW',
    maxOutputTokens: 8192,
    exposeInUi: true,
    uiLabel: 'Fast',
    uiDescription: 'Quick & accurate standard marking (~1 credit/page)'
  },
  thinking: {
    id: 'thinking',
    modelId: process.env.AI_MODEL_THINKING || 'gemini-3.8-flash',
    thinkingLevel: 'HIGH',
    maxOutputTokens: 8192,
    exposeInUi: true,
    uiLabel: 'Thinking',
    uiDescription: 'Deep step-by-step & mark scheme reasoning (~1.5–2x credits)'
  },
  pro: {
    id: 'pro',
    modelId: process.env.AI_MODEL_PRO || 'gemini-4-argon',
    thinkingLevel: 'HIGH',
    maxOutputTokens: 8192,
    exposeInUi: true,
    uiLabel: 'Pro',
    uiDescription: 'Frontier Gemini Argon for A-Level & complex proofs (~3–4x credits)'
  }
};

export interface ExecutionPlan {
  requested: string;
  phase: string;
  tierId: LogicalTierId;
  modelId: string;
  modelName: string;
  thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'NONE';
  maxOutputTokens: number;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

/**
 * Resolves the execution plan (model ID, thinking level, token budget, pricing)
 * based on the requested model/tier and the current execution phase.
 */
export function resolveExecutionPlan(
  requestedModelOrTier: string | undefined,
  phase: string
): ExecutionPlan {
  const requested = (requestedModelOrTier || 'auto').trim();
  const normalizedReq = requested.toLowerCase();

  // Handle explicit OpenAI models if requested
  if (normalizedReq.startsWith('openai-') || normalizedReq === 'gpt-4o' || normalizedReq === 'gpt-4o-mini') {
    const modelId = normalizedReq === 'gpt-4o' ? 'openai-gpt-4o' : (normalizedReq === 'gpt-4o-mini' ? 'openai-gpt-4o-mini' : normalizedReq);
    const cfg = AI_MODELS[modelId as keyof typeof AI_MODELS];
    return {
      requested,
      phase,
      tierId: 'fast',
      modelId,
      modelName: modelId.replace('openai-', ''),
      thinkingLevel: 'NONE',
      maxOutputTokens: cfg?.maxTokens || 8192,
      inputPricePer1M: cfg?.inputPricePer1M ?? 0.15,
      outputPricePer1M: cfg?.outputPricePer1M ?? 0.60
    };
  }

  let tierId: LogicalTierId = 'fast';

  // 1. Utility Phases Locked to Fixed Tiers (Never burn user's Pro credits on preprocessing!)
  if (phase === 'preFlight' || phase === 'mapper') {
    tierId = 'lite';
  } else if (phase === 'classification' || phase === 'performanceSummary' || phase === 'markingScheme') {
    tierId = 'fast';
  } else {
    // 2. Reasoning / User-Facing Phases:
    // Respect the user's selected tier ('fast', 'thinking', 'pro'). If 'auto' or empty, use 'fast'.
    if (normalizedReq === 'pro') {
      tierId = 'pro';
    } else if (normalizedReq === 'thinking') {
      tierId = 'thinking';
    } else if (normalizedReq === 'lite') {
      tierId = 'lite';
    } else if (normalizedReq === 'fast' || normalizedReq === 'auto') {
      tierId = 'fast';
    } else if (normalizedReq in MODEL_TIER_DEFINITIONS) {
      tierId = normalizedReq as LogicalTierId;
    } else {
      // Check if user passed an exact model ID that matches a tier's modelId
      const foundTier = (Object.keys(MODEL_TIER_DEFINITIONS) as LogicalTierId[]).find(
        t => MODEL_TIER_DEFINITIONS[t].modelId.toLowerCase() === normalizedReq
      );
      if (foundTier) {
        tierId = foundTier;
      } else {
        tierId = 'fast';
      }
    }
  }

  const tierDef = MODEL_TIER_DEFINITIONS[tierId] || MODEL_TIER_DEFINITIONS.fast;
  const modelId = tierDef.modelId;
  const modelConfig = AI_MODELS[modelId as keyof typeof AI_MODELS] || AI_MODELS[MODEL_TIER_DEFINITIONS.fast.modelId as keyof typeof AI_MODELS];
  const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || modelId;

  return {
    requested,
    phase,
    tierId,
    modelId,
    modelName,
    thinkingLevel: tierDef.thinkingLevel,
    maxOutputTokens: tierDef.maxOutputTokens,
    inputPricePer1M: modelConfig.inputPricePer1M ?? 0.75,
    outputPricePer1M: modelConfig.outputPricePer1M ?? 3.75
  };
}

/**
 * Model Tiers mapping
 */
export const MODEL_TIERS: Record<string, ModelType> = {
  'lite': MODEL_TIER_DEFINITIONS.lite.modelId as ModelType,
  'fast': MODEL_TIER_DEFINITIONS.fast.modelId as ModelType,
  'thinking': MODEL_TIER_DEFINITIONS.thinking.modelId as ModelType,
  'pro': MODEL_TIER_DEFINITIONS.pro.modelId as ModelType,
  'gpt-4o': 'openai-gpt-4o',
  'gpt-4o-mini': 'openai-gpt-4o-mini',
  'auto': MODEL_TIER_DEFINITIONS.fast.modelId as ModelType
};

/**
 * Resolve a tier string or model string to an actual model type
 * @param modelOrTier - The model or tier string
 * @returns The resolved model type
 */
export function resolveModelTier(modelOrTier: string): ModelType {
  if (modelOrTier === 'auto' || !modelOrTier) {
    return MODEL_TIER_DEFINITIONS.fast.modelId as ModelType;
  }
  
  const normalized = modelOrTier.toLowerCase();
  
  // If it's a known tier, resolve it
  if (normalized in MODEL_TIERS) {
    return MODEL_TIERS[normalized];
  }
  
  // If it's already an exact model ID that exists, use it
  if (normalized in AI_MODELS) {
    return normalized as ModelType;
  }
  
  // Fallback to default fast model
  return MODEL_TIER_DEFINITIONS.fast.modelId as ModelType;
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
      typeof config.maxTokens === 'number'
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
    case 'gemini-3.8-flash':
    case 'gemini-3.7-flash':
    case 'gemini-2.5-flash':
      return `${basePrompt} Use clear, concise language and focus on mathematical accuracy with efficient processing.`;
    case 'gemini-3.5-flash-lite':
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

  return {
    maxOutputTokens: config.maxTokens
  };
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
  return process.env.OPENAI_MODEL || 'gpt-4o';
}

/** Get OpenAI API endpoint for chat completions */
export function getOpenAIEndpoint(): string {
  return process.env.OPENAI_API_BASE || 'https://api.openai.com/v1/chat/completions';
}
