import type { ModelType } from '../../types/index';

export interface ClassificationResult {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
  extractedQuestionText?: string;
  usageTokens?: number;
}

export class ClassificationService {
  static async classifyImage(imageData: string, model: ModelType): Promise<ClassificationResult> {
    const { ImageUtils } = await import('./ImageUtils');
    const compressedImage = await ImageUtils.compressImage(imageData);

    const systemPrompt = `You are an AI assistant that classifies math images and extracts question text.

    Your task is to:
    1. Determine if an uploaded image contains:
       A) A math question ONLY (no student work, no answers, just the question/problem)
       B) A math question WITH student work/answers (homework to be marked)
    2. Extract the main question text from the image

    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:

    {
      "isQuestionOnly": true/false,
      "reasoning": "brief explanation of your classification",
      "extractedQuestionText": "the main question text extracted from the image"
    }`;

    const userPrompt = `Please classify this uploaded image and extract the question text.`;

    try {
      if (model === 'gemini-2.5-pro') {
        return await this.callGeminiForClassification(compressedImage, systemPrompt, userPrompt);
      } else {
        return await this.callOpenAIForClassification(compressedImage, systemPrompt, userPrompt, model);
      }
    } catch (_e) {
      return {
        isQuestionOnly: false,
        reasoning: 'Classification failed, defaulting to homework marking',
        apiUsed: 'Fallback',
        extractedQuestionText: 'Unable to extract question text - AI service failed',
        usageTokens: 0
      };
    }
  }

  private static async callGeminiForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<ClassificationResult> {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt },
            { text: userPrompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageData.split(',')[1] } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
      })
    });
    if (!response.ok) throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
    const result = await response.json() as any;
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('No content in Gemini response');
    const parsed = JSON.parse(content);
    const usageTokens = (result.usageMetadata?.totalTokenCount as number) || 0;
    return {
      isQuestionOnly: parsed.isQuestionOnly,
      reasoning: parsed.reasoning,
      apiUsed: 'Google Gemini 2.0 Flash Exp',
      extractedQuestionText: parsed.extractedQuestionText,
      usageTokens
    };
  }

  private static async callOpenAIForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType
  ): Promise<ClassificationResult> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model === 'chatgpt-5' ? 'gpt-5' : 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: typeof imageData === 'string' ? imageData : String(imageData) } }
          ] as any }
        ],
        ...(model === 'chatgpt-5' ? { max_completion_tokens: 2000 } : { max_tokens: 500 })
      })
    });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(`OpenAI API request failed: ${response.status} ${JSON.stringify(result)}`);
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in OpenAI response');
    const parsed = JSON.parse(content);
    const usageTokens = (result.usage?.total_tokens as number) || 0;
    return {
      isQuestionOnly: parsed.isQuestionOnly,
      reasoning: parsed.reasoning,
      apiUsed: model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni',
      extractedQuestionText: parsed.extractedQuestionText,
      usageTokens
    };
  }
}


