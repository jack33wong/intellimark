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
  modelanswer: {
    mode: 'modelanswer',
    displayName: 'Provide model answer according to the marking scheme.',
    promptKey: 'modelAnswer',
    processingDelayMs: 1500
  },
  markingscheme: {
    mode: 'markingscheme',
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
  { text: SUGGESTED_FOLLOW_UP_MODES.modelanswer.displayName, mode: SUGGESTED_FOLLOW_UP_MODES.modelanswer.mode },
  { text: SUGGESTED_FOLLOW_UP_MODES.markingscheme.displayName, mode: SUGGESTED_FOLLOW_UP_MODES.markingscheme.mode },
  { text: SUGGESTED_FOLLOW_UP_MODES.similarquestions.displayName, mode: SUGGESTED_FOLLOW_UP_MODES.similarquestions.mode }
];

export function getSuggestedFollowUpConfig(mode: string): SuggestedFollowUpConfig | null {
  return SUGGESTED_FOLLOW_UP_MODES[mode] || null;
}

export function isValidSuggestedFollowUpMode(mode: string): boolean {
  return mode in SUGGESTED_FOLLOW_UP_MODES;
}
