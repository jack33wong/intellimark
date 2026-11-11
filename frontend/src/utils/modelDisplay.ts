/**
 * Utility to format model identifiers and tiers for user-facing display.
 * Maps raw model IDs (e.g. 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-4-argon')
 * and logical tiers ('fast', 'thinking', 'pro', 'lite') into clear labels with both
 * tier and underlying model name.
 */

export interface ModelDisplayOptions {
  tierHint?: string | null;
}

/**
 * Format raw model string or tier identifier into a user-friendly display string.
 * Examples:
 *  - 'fast' -> 'Fast (Gemini 3.8 Flash)'
 *  - 'thinking' -> 'Thinking (Gemini 3.8 Flash)'
 *  - 'pro' -> 'Pro (Gemini 4 Argon)'
 *  - 'lite' -> 'Lite (Gemini 3.5 Flash-Lite)'
 *  - 'gemini-3.8-flash' + tierHint 'thinking' -> 'Thinking (Gemini 3.8 Flash)'
 *  - 'gemini-3.8-flash' -> 'Fast (Gemini 3.8 Flash)'
 *  - 'gemini-4-argon' -> 'Pro (Gemini 4 Argon)'
 *  - 'gemini-3.7-flash' -> 'Thinking (Gemini 3.7 Flash)'
 *  - 'gemini-2.5-flash' -> 'Gemini 2.5 Flash'
 *  - 'openai-gpt-4o' -> 'OpenAI GPT-4o'
 */
export function formatModelDisplayName(
  rawModel?: string | null,
  options?: ModelDisplayOptions
): string {
  if (!rawModel || rawModel.trim() === '' || rawModel === 'N/A' || rawModel === 'unknown' || rawModel === 'auto') {
    if (options?.tierHint) {
      return formatTier(options.tierHint);
    }
    return 'N/A';
  }

  const trimmed = rawModel.trim();

  // If already formatted with parentheses (e.g., "Fast (Gemini 3.8 Flash)"), return as is
  if (trimmed.includes('(') && trimmed.includes(')')) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();

  // 1. Direct logical tiers
  if (lower === 'fast') return 'Fast (Gemini 3.8 Flash)';
  if (lower === 'thinking') return 'Thinking (Gemini 3.8 Flash)';
  if (lower === 'pro') return 'Pro (Gemini 4 Argon)';
  if (lower === 'lite') return 'Lite (Gemini 3.5 Flash-Lite)';

  // 2. Exact or known Google model IDs
  if (lower.includes('3.8-flash') || lower === 'gemini-3.8-flash') {
    if (options?.tierHint?.toLowerCase() === 'thinking') {
      return 'Thinking (Gemini 3.8 Flash)';
    }
    if (options?.tierHint?.toLowerCase() === 'fast') {
      return 'Fast (Gemini 3.8 Flash)';
    }
    return 'Fast (Gemini 3.8 Flash)';
  }

  if (lower.includes('4-argon') || lower === 'gemini-4-argon') {
    return 'Pro (Gemini 4 Argon)';
  }

  if (lower.includes('3.7-flash') || lower === 'gemini-3.7-flash') {
    return 'Thinking (Gemini 3.7 Flash)';
  }

  if (lower.includes('3.5-flash-lite') || lower === 'gemini-3.5-flash-lite') {
    return 'Lite (Gemini 3.5 Flash-Lite)';
  }

  if (lower.includes('3.5-flash') || lower === 'gemini-3.5-flash') {
    return 'Gemini 3.5 Flash';
  }

  if (lower.includes('3.1-flash-lite') || lower === 'gemini-3.1-flash-lite') {
    return 'Gemini 3.1 Flash-Lite';
  }

  if (lower.includes('2.5-flash-lite') || lower === 'gemini-2.5-flash-lite') {
    return 'Gemini 2.5 Flash-Lite';
  }

  if (lower.includes('2.5-flash') || lower === 'gemini-2.5-flash') {
    return 'Gemini 2.5 Flash';
  }

  if (lower.includes('2.5-pro') || lower === 'gemini-2.5-pro') {
    return 'Gemini 2.5 Pro';
  }

  if (lower.includes('2.0-flash-thinking')) {
    return 'Thinking (Gemini 2.0 Flash)';
  }

  if (lower.includes('2.0-flash')) {
    return 'Gemini 2.0 Flash';
  }

  if (lower.includes('1.5-pro')) {
    return 'Gemini 1.5 Pro';
  }

  if (lower.includes('1.5-flash')) {
    return 'Gemini 1.5 Flash';
  }

  // 3. OpenAI models
  if (lower.includes('gpt-4o-mini')) {
    return 'OpenAI GPT-4o Mini';
  }
  if (lower.includes('gpt-4o')) {
    return 'OpenAI GPT-4o';
  }

  // Fallback: capitalize nicely if possible
  return trimmed;
}

function formatTier(tier: string): string {
  const t = tier.trim().toLowerCase();
  if (t === 'fast') return 'Fast (Gemini 3.8 Flash)';
  if (t === 'thinking') return 'Thinking (Gemini 3.8 Flash)';
  if (t === 'pro') return 'Pro (Gemini 4 Argon)';
  if (t === 'lite') return 'Lite (Gemini 3.5 Flash-Lite)';
  return tier;
}

/**
 * Extract the exact model tier used by a session.
 * Checks session.selectedModel, sessionStats.selectedModel, message models,
 * thought tokens, and falls back to inspecting lastModelUsed.
 */
export function getSessionModel(session: any): string {
  if (!session) return 'fast';

  // 1. Explicit session-level or stats selectedModel
  if (session.selectedModel && typeof session.selectedModel === 'string') {
    const tier = normalizeTier(session.selectedModel);
    if (tier) return tier;
  }
  if (session.sessionStats?.selectedModel && typeof session.sessionStats.selectedModel === 'string') {
    const tier = normalizeTier(session.sessionStats.selectedModel);
    if (tier) return tier;
  }
  if (session.sessionStats?.modelTier && typeof session.sessionStats.modelTier === 'string') {
    const tier = normalizeTier(session.sessionStats.modelTier);
    if (tier) return tier;
  }

  // 2. Check user message (where the requested model is saved upon session creation)
  const userMsg = session.messages?.find((m: any) => m.role === 'user' && (m.model || m.processingStats?.modelUsed));
  if (userMsg?.model) {
    const tier = normalizeTier(userMsg.model);
    if (tier) return tier;
  }
  if (userMsg?.processingStats?.modelUsed) {
    const tier = normalizeTier(userMsg.processingStats.modelUsed);
    if (tier) return tier;
  }

  // 3. Check assistant messages
  const assistantMsg = session.messages?.find((m: any) => m.role === 'assistant' && (m.model || m.processingStats?.selectedModel || m.processingStats?.modelUsed));
  if (assistantMsg?.model) {
    const tier = normalizeTier(assistantMsg.model);
    if (tier) return tier;
  }
  if (assistantMsg?.processingStats?.selectedModel) {
    const tier = normalizeTier(assistantMsg.processingStats.selectedModel);
    if (tier) return tier;
  }

  // 4. Inspect sessionStats.lastModelUsed or modelUsed
  const rawModel = session.sessionStats?.lastModelUsed || session.sessionStats?.modelUsed;
  if (rawModel && typeof rawModel === 'string') {
    const lower = rawModel.toLowerCase().trim();
    if (lower === 'pro' || lower.includes('argon')) return 'pro';
    if (lower === 'thinking' || lower.includes('3.7-flash')) return 'thinking';
    if (lower === 'lite' || lower.includes('3.5-flash-lite')) return 'lite';
    if (lower === 'fast') return 'fast';

    // If gemini-3.8-flash, check if thoughts were generated
    if (lower === 'gemini-3.8-flash' || lower.includes('3.8-flash')) {
      const hasThoughts = session.messages?.some((m: any) => (m.processingStats?.thoughtTokens || 0) > 0);
      if (hasThoughts) return 'thinking';
      return 'fast';
    }

    if (lower.includes('gpt-4o')) return 'pro';
  }

  return 'fast';
}

function normalizeTier(tierStr: string): string | null {
  if (!tierStr || typeof tierStr !== 'string') return null;
  const t = tierStr.toLowerCase().trim();
  if (t === 'fast' || t === 'thinking' || t === 'pro' || t === 'lite') {
    return t;
  }
  if (t.includes('argon')) return 'pro';
  if (t.includes('3.7-flash')) return 'thinking';
  if (t.includes('3.5-flash-lite')) return 'lite';
  return null;
}
