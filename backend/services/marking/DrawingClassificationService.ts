import type { ModelType } from '../../types/index.js';
import { getModelConfig, validateModel } from '../../config/aiModels.js';

export interface DrawingClassificationResult {
  drawings: Array<{
    questionNumber?: string | null;
    subQuestionPart?: string | null; // e.g., "a", "b", "i", "ii"
    drawingType: string; // e.g., "Histogram", "Coordinate grid", "Graph", "Diagram"
    description: string; // Detailed description with accurate coordinates/frequencies
    position?: {
      x: number; // Percentage (0-100)
      y: number; // Percentage (0-100)
    };
    coordinates?: Array<{ x: number; y: number }>; // For coordinate grids
    frequencies?: Array<{ range: string; frequency: number; frequencyDensity?: number }>; // For histograms
    confidence: number;
  }>;
  usageTokens?: number;
}

export class DrawingClassificationService {
  private static readonly SAFETY_SETTINGS = [
    {
      category: "HARM_CATEGORY_HARASSMENT",
      threshold: "BLOCK_NONE"
    },
    {
      category: "HARM_CATEGORY_HATE_SPEECH",
      threshold: "BLOCK_NONE"
    },
    {
      category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold: "BLOCK_NONE"
    },
    {
      category: "HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold: "BLOCK_NONE"
    }
  ];

  /**
   * Classify drawings on a page with high accuracy
   * Focuses ONLY on student drawings, ignores question diagrams
   * @param imageData Base64 image data
   * @param questionText Question text to determine expected drawing type (can be main question or combined)
   * @param questionNumber Question number for context
   * @param subQuestionPart Single sub-question part (e.g., "a") - for backward compatibility
   * @param subQuestions Array of sub-questions with their text and parts (for grouped processing)
   * @param model Model to use
   * @param markingScheme Marking scheme for hints
   * @returns Drawing classification result
   */
  static async classifyDrawings(
    imageData: string,
    questionText: string,
    questionNumber?: string | null,
    subQuestionPart?: string | null,
    model: ModelType = 'auto',
    markingScheme?: any | null,
    subQuestions?: Array<{ part: string; text: string }> | null
  ): Promise<DrawingClassificationResult> {
    try {
      const validatedModel = validateModel(model);
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      
      const { AI_PROMPTS } = await import('../../config/prompts.js');
      const systemPrompt = AI_PROMPTS.drawingClassification.system;
      const userPrompt = AI_PROMPTS.drawingClassification.user(
        questionText, 
        questionNumber, 
        subQuestionPart, 
        markingScheme,
        subQuestions // Pass sub-questions for grouped processing
      );

      // Check if OpenAI model - use vision API, otherwise use Gemini
      const isOpenAI = validatedModel.startsWith('openai-');
      let content: string;
      let usageTokens = 0;
      
      if (isOpenAI) {
        // Use OpenAI vision API for image classification
        // Extract model name from full ID (e.g., 'openai-gpt-5-mini' -> 'gpt-5-mini')
        const openaiModelName = validatedModel.replace('openai-', '');
        const result = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData, openaiModelName);
        content = result.content;
        usageTokens = result.usageTokens || 0;
      } else {
        // Use Gemini with image
        const accessToken = await ModelProvider.getGeminiAccessToken();
        const response = await this.makeGeminiRequest(accessToken, imageData, systemPrompt, userPrompt, validatedModel);
        
        // Check if response is HTML (error page) - same as ClassificationService
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          const htmlContent = await response.text();
          console.error('❌ [DRAWING CLASSIFICATION] Received HTML response instead of JSON:');
          console.error('❌ [DRAWING CLASSIFICATION] HTML content:', htmlContent.substring(0, 200) + '...');
          throw new Error('Gemini API returned HTML error page instead of JSON. Check API key and permissions.');
        }

        const result = await response.json() as any;
        content = await this.extractGeminiContent(result);
        usageTokens = result.usageMetadata?.totalTokenCount || 0;
      }
      const cleanContent = this.cleanGeminiResponse(content);
      const parsed = this.parseJsonWithSanitization(cleanContent);

      // Validate and normalize drawing data
      const validatedDrawings = (parsed.drawings || []).map((drawing: any) => {
        // Validate coordinates array
        if (drawing.coordinates && Array.isArray(drawing.coordinates)) {
          drawing.coordinates = drawing.coordinates
            .map((coord: any) => {
              // Handle different coordinate formats
              if (coord && typeof coord === 'object') {
                // Already in {x, y} format
                if (typeof coord.x === 'number' && typeof coord.y === 'number') {
                  return { x: coord.x, y: coord.y };
                }
                // Try alternative formats
                if (typeof coord.x === 'string' || typeof coord.y === 'string') {
                  const x = typeof coord.x === 'string' ? parseFloat(coord.x) : coord.x;
                  const y = typeof coord.y === 'string' ? parseFloat(coord.y) : coord.y;
                  if (!isNaN(x) && !isNaN(y)) {
                    return { x, y };
                  }
                }
              }
              // Try parsing from string format like "(-3, -1)"
              if (typeof coord === 'string') {
                const match = coord.match(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
                if (match) {
                  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
                }
              }
              return null;
            })
            .filter((coord: any) => coord !== null && typeof coord.x === 'number' && typeof coord.y === 'number');
        }

        // Validate frequencies array
        if (drawing.frequencies && Array.isArray(drawing.frequencies)) {
          drawing.frequencies = drawing.frequencies
            .map((freq: any) => {
              if (freq && typeof freq === 'object') {
                return {
                  range: String(freq.range || ''),
                  frequency: typeof freq.frequency === 'number' ? freq.frequency : parseFloat(String(freq.frequency || 0)),
                  frequencyDensity: typeof freq.frequencyDensity === 'number' 
                    ? freq.frequencyDensity 
                    : (freq.frequencyDensity ? parseFloat(String(freq.frequencyDensity)) : undefined)
                };
              }
              return null;
            })
            .filter((freq: any) => freq !== null && freq.range);
        }

        // Validate position
        if (drawing.position && typeof drawing.position === 'object') {
          const x = typeof drawing.position.x === 'number' ? drawing.position.x : parseFloat(String(drawing.position.x || 0));
          const y = typeof drawing.position.y === 'number' ? drawing.position.y : parseFloat(String(drawing.position.y || 0));
          if (!isNaN(x) && !isNaN(y)) {
            drawing.position = { x, y };
          } else {
            delete drawing.position;
          }
        }

        return drawing;
      });

      // Debug: Log drawing classification response
      console.log(`[DEBUG DRAWING CLASSIFICATION] Q${questionNumber || '?'}: Found ${validatedDrawings.length} drawing(s)`, 
        validatedDrawings.length > 0 ? `- Types: ${validatedDrawings.map(d => d.drawingType).join(', ')}` : '');

      return {
        drawings: validatedDrawings,
        usageTokens: usageTokens
      };
    } catch (error) {
      console.error(`❌ [DRAWING CLASSIFICATION] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Make Gemini API request - reuses same pattern as ClassificationService
   */
  private static async makeGeminiRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<Response> {
    // Use centralized model configuration - same as ClassificationService
    const { getModelConfig } = await import('../../config/aiModels.js');
    const config = getModelConfig(model);
    const endpoint = config.apiEndpoint;
    
    const requestBody = {
      contents: [{
        parts: [
          { text: systemPrompt },
          { text: userPrompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageData.includes(',') ? imageData.split(',')[1] : imageData } }
        ]
      }],
      generationConfig: { 
        temperature: 0.1, // Low temperature for accuracy
        maxOutputTokens: (await import('../../config/aiModels.js')).getModelConfig('gemini-2.5-flash').maxTokens 
      }, // Use centralized config - same as ClassificationService
      safetySettings: this.SAFETY_SETTINGS
    };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      // Capture error response body for detailed diagnostics
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = 'Unable to read error response body';
      }
      
      const { getModelConfig } = await import('../../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
      
      console.error(`❌ [GEMINI API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [HTTP STATUS] ${response.status} ${response.statusText}`);
      console.error(`❌ [ERROR RESPONSE BODY] ${errorText}`);
      
      // Try to parse error body for structured error info
      let parsedError = null;
      try {
        parsedError = JSON.parse(errorText);
        if (parsedError.error) {
          console.error(`❌ [ERROR DETAILS]`, JSON.stringify(parsedError.error, null, 2));
        }
      } catch (e) {
        // Not JSON, that's okay
      }
      
      // Include error details in thrown error
      const errorMessage = parsedError?.error?.message || errorText || response.statusText;
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} for ${actualModelName} (${apiVersion}) - ${errorMessage}`);
    }
    
    return response;
  }

  private static async extractGeminiContent(result: any): Promise<string> {
    // Reuse same method as ClassificationService
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    return ModelProvider.extractGeminiTextContent(result);
  }

  private static cleanGeminiResponse(content: string): string {
    // Reuse same method as ClassificationService
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return cleanContent;
  }

  private static parseJsonWithSanitization(content: string): any {
    try {
      return JSON.parse(content);
    } catch (error) {
      // Try to extract JSON from text if wrapped
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error(`Failed to parse drawing classification JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

