import type { ModelType } from '../../types/index';

export class ModelProvider {
  static async callGeminiText(systemPrompt: string, userPrompt: string): Promise<string> {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }, { text: userPrompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
      })
    });
    if (!response.ok) throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
    const result = await response.json() as any;
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('No content in Gemini response');
    return content;
  }

  static async callOpenAIText(systemPrompt: string, userPrompt: string, model: ModelType): Promise<string> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model === 'chatgpt-5' ? 'gpt-5' : 'gpt-4o',
        messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt } ],
        ...(model === 'chatgpt-5' ? { max_completion_tokens: 1000 } : { max_tokens: 1000 })
      })
    });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(`OpenAI API request failed: ${response.status} ${JSON.stringify(result)}`);
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in OpenAI response');
    return content;
  }
}


