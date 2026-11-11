import { formatModelDisplayName, getSessionModel } from './modelDisplay';

describe('formatModelDisplayName', () => {
  test('handles null, undefined, empty, and placeholder strings', () => {
    expect(formatModelDisplayName(null)).toBe('N/A');
    expect(formatModelDisplayName(undefined)).toBe('N/A');
    expect(formatModelDisplayName('')).toBe('N/A');
    expect(formatModelDisplayName('   ')).toBe('N/A');
    expect(formatModelDisplayName('N/A')).toBe('N/A');
    expect(formatModelDisplayName('unknown')).toBe('N/A');
    expect(formatModelDisplayName('auto')).toBe('N/A');
  });

  test('falls back to tierHint when rawModel is missing/placeholder', () => {
    expect(formatModelDisplayName(null, { tierHint: 'fast' })).toBe('Fast (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('N/A', { tierHint: 'thinking' })).toBe('Thinking (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('auto', { tierHint: 'pro' })).toBe('Pro (Gemini 4 Argon)');
    expect(formatModelDisplayName(undefined, { tierHint: 'lite' })).toBe('Lite (Gemini 3.5 Flash-Lite)');
  });

  test('formats logical tier strings', () => {
    expect(formatModelDisplayName('fast')).toBe('Fast (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('Fast')).toBe('Fast (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('thinking')).toBe('Thinking (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('Thinking')).toBe('Thinking (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('pro')).toBe('Pro (Gemini 4 Argon)');
    expect(formatModelDisplayName('Pro')).toBe('Pro (Gemini 4 Argon)');
    expect(formatModelDisplayName('lite')).toBe('Lite (Gemini 3.5 Flash-Lite)');
  });

  test('formats canonical Google model IDs', () => {
    expect(formatModelDisplayName('gemini-3.8-flash')).toBe('Fast (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('gemini-3.8-flash', { tierHint: 'thinking' })).toBe('Thinking (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('gemini-3.8-flash', { tierHint: 'fast' })).toBe('Fast (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('gemini-4-argon')).toBe('Pro (Gemini 4 Argon)');
    expect(formatModelDisplayName('gemini-3.7-flash')).toBe('Thinking (Gemini 3.7 Flash)');
    expect(formatModelDisplayName('gemini-3.5-flash-lite')).toBe('Lite (Gemini 3.5 Flash-Lite)');
    expect(formatModelDisplayName('gemini-2.5-flash')).toBe('Gemini 2.5 Flash');
    expect(formatModelDisplayName('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
  });

  test('preserves already formatted strings', () => {
    expect(formatModelDisplayName('Fast (Gemini 3.8 Flash)')).toBe('Fast (Gemini 3.8 Flash)');
    expect(formatModelDisplayName('Pro (Gemini 4 Argon)')).toBe('Pro (Gemini 4 Argon)');
  });

  test('formats OpenAI models', () => {
    expect(formatModelDisplayName('openai-gpt-4o')).toBe('OpenAI GPT-4o');
    expect(formatModelDisplayName('openai-gpt-4o-mini')).toBe('OpenAI GPT-4o Mini');
  });
});

describe('getSessionModel', () => {
  test('returns fast if session is null/empty', () => {
    expect(getSessionModel(null)).toBe('fast');
    expect(getSessionModel({})).toBe('fast');
  });

  test('resolves from explicit session.selectedModel', () => {
    expect(getSessionModel({ selectedModel: 'thinking' })).toBe('thinking');
    expect(getSessionModel({ selectedModel: 'pro' })).toBe('pro');
    expect(getSessionModel({ selectedModel: 'fast' })).toBe('fast');
  });

  test('resolves from user message model', () => {
    const session = {
      sessionStats: { lastModelUsed: 'gemini-3.8-flash' },
      messages: [
        { role: 'user', model: 'fast' },
        { role: 'assistant', processingStats: { modelUsed: 'gemini-3.8-flash' } }
      ]
    };
    expect(getSessionModel(session)).toBe('fast');

    const thinkingSession = {
      sessionStats: { lastModelUsed: 'gemini-3.8-flash' },
      messages: [
        { role: 'user', model: 'thinking' },
        { role: 'assistant', processingStats: { modelUsed: 'gemini-3.8-flash' } }
      ]
    };
    expect(getSessionModel(thinkingSession)).toBe('thinking');
  });

  test('resolves Pro from gemini-4-argon', () => {
    const session = {
      sessionStats: { lastModelUsed: 'gemini-4-argon' },
      messages: []
    };
    expect(getSessionModel(session)).toBe('pro');
  });

  test('resolves Thinking from thoughts tokens when user message model missing', () => {
    const sessionWithThoughts = {
      sessionStats: { lastModelUsed: 'gemini-3.8-flash' },
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', processingStats: { thoughtTokens: 4500 } }
      ]
    };
    expect(getSessionModel(sessionWithThoughts)).toBe('thinking');

    const sessionWithoutThoughts = {
      sessionStats: { lastModelUsed: 'gemini-3.8-flash' },
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', processingStats: { thoughtTokens: 0 } }
      ]
    };
    expect(getSessionModel(sessionWithoutThoughts)).toBe('fast');
  });
});
