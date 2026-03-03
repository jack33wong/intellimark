/**
 * Suggested Follow-up Configuration - Centralized settings for suggested follow-up features
 */

export interface SuggestedFollowUpConfig {
  mode: string;
  displayName: string;
  promptKey: string;
  processingDelayMs: number;
}

export const SUGGESTED_FOLLOW_UP_MODES: Record<string, SuggestedFollowUpConfig> = {
  'model-answer': {
    mode: 'model-answer',
    displayName: 'Provide model answer according to the marking scheme.',
    promptKey: 'modelAnswer',
    processingDelayMs: 1500
  },
  'marking-scheme': {
    mode: 'marking-scheme',
    displayName: 'Show marking scheme.',
    promptKey: 'markingScheme',
    processingDelayMs: 1500
  },
  similarquestions: {
    mode: 'similarquestions',
    displayName: 'Similar practice questions.',
    promptKey: 'similarquestions',
    processingDelayMs: 1500
  }

};

export const DEFAULT_SUGGESTED_FOLLOW_UP_SUGGESTIONS = [
  { text: SUGGESTED_FOLLOW_UP_MODES['model-answer'].displayName, mode: SUGGESTED_FOLLOW_UP_MODES['model-answer'].mode },
  { text: SUGGESTED_FOLLOW_UP_MODES['marking-scheme'].displayName, mode: SUGGESTED_FOLLOW_UP_MODES['marking-scheme'].mode },
  { text: SUGGESTED_FOLLOW_UP_MODES.similarquestions.displayName, mode: SUGGESTED_FOLLOW_UP_MODES.similarquestions.mode }
];

export function getSuggestedFollowUpConfig(mode: string): SuggestedFollowUpConfig | null {
  // Map legacy names to standardized names
  let normalizedMode = mode;
  if (mode === 'markingscheme') normalizedMode = 'marking-scheme';
  if (mode === 'modelanswer') normalizedMode = 'model-answer';

  return SUGGESTED_FOLLOW_UP_MODES[normalizedMode] || null;
}

export function isValidSuggestedFollowUpMode(mode: string): boolean {
  let normalizedMode = mode;
  if (mode === 'markingscheme') normalizedMode = 'marking-scheme';
  if (mode === 'modelanswer') normalizedMode = 'model-answer';

  return normalizedMode in SUGGESTED_FOLLOW_UP_MODES;
}
