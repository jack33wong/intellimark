/**
 * Type definitions barrel export
 * 
 * This file now only exports auto-generated types from the API spec.
 * All types are generated from backend/types/index.ts via OpenAPI.
 */

// Import and re-export auto-generated types from API spec
import type { components } from './api';
export type { components };

export type DetectedQuestion = components['schemas']['DetectedQuestion'];
export type UnifiedMessage = components['schemas']['UnifiedMessage'];
export type UnifiedSession = components['schemas']['UnifiedSession'];
export type MarkHomeworkRequest = components['schemas']['MarkHomeworkRequest'];
export type MarkHomeworkResponse = components['schemas']['MarkHomeworkResponse'];
export type ChatRequest = components['schemas']['ChatRequest'];
export type ChatResponse = components['schemas']['ChatResponse'];

// Re-export payment types (these are frontend-specific)
export * from './payment';

/**
 * All types are now auto-generated from backend/types/index.ts via OpenAPI.
 * See backend/scripts/generate-api-spec.ts for the generation process.
 */
  