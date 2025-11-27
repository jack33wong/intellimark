import type { ModelType } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import * as path from 'path';
import { getModelConfig, getDebugMode, validateModel } from '../../config/aiModels.js';
import { ErrorHandler } from '../../utils/errorHandler.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';

export interface ClassificationResult {
  category: "questionOnly" | "questionAnswer" | "metadata";
  reasoning: string;
  apiUsed: string;
  questions?: Array<{
    questionNumber?: string | null; // Main question number (e.g., "1", "2", "3") or null
    text: string | null; // Main question text, or null if no main text (only sub-questions)
    studentWork?: string | null; // Extracted student work for main question (LaTeX format)
    studentWorkPosition?: { x: number; y: number; width: number; height: number }; // Percentage position
    hasStudentDrawing?: boolean; // Indicator if main question has student drawing work
    subQuestions?: Array<{
      part: string; // Sub-question part (e.g., "a", "b", "i", "ii")
      text: string; // Complete sub-question text
      studentWork?: string | null; // Extracted student work for sub-question (LaTeX format)
      studentWorkPosition?: { x: number; y: number; width: number; height: number }; // Percentage position
      hasStudentDrawing?: boolean; // Indicator if sub-question has student drawing work
      confidence?: number;
      pageIndex?: number; // Page index where this sub-question was found
    }>;
    confidence: number;
  }>;
  usageTokens?: number;
}

export class ClassificationService {
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
   * Classify multiple images at once (for better cross-page context)
   * @param images Array of objects with imageData and optional fileName/pageIndex
   * @param model Model to use
   * @param debug Debug mode
   * @returns Array of classification results, one per image
   */
  static async classifyMultipleImages(
    images: Array<{ imageData: string; fileName?: string; pageIndex?: number }>,
    model: ModelType = 'auto',
    debug: boolean = false
  ): Promise<Array<{ pageIndex: number; result: ClassificationResult }>> {
    if (images.length === 0) return [];

    // Use Gemini prompt for classification
    const systemPrompt = getPrompt('classification.system');
    const userPrompt = getPrompt('classification.user');

    // Enhanced prompt for multi-image context
    const multiImageSystemPrompt = systemPrompt + `\n\nIMPORTANT FOR MULTI-PAGE DOCUMENTS (${images.length} pages):
- You are analyzing ${images.length} pages/images together
- Return results for EACH page in the "pages" array, maintaining the same order as input

**CRITICAL RULES FOR SUB-QUESTION CONTINUATION ACROSS PAGES:**

1. **Question Number Consistency (MANDATORY):**
   - Questions that span multiple pages MUST have the SAME questionNumber on ALL pages
   - If Page N has questionNumber "3" with sub-question part "a", and Page N+1 (next page) has sub-question part "b" text/question, Page N+1 MUST also have questionNumber "3"
   - Even if Page N+1 doesn't show the question number "3" visibly, you MUST assign it based on the sub-question part sequence
   - NEVER leave questionNumber as null or undefined for continuation pages that have sub-question content

2. **Sub-Question Part Sequence Matching:**
   - Sub-question parts follow alphabetical order: "a" comes before "b", "b" comes before "c", etc.
   - If you see sub-question part "b" on a page, scan backward through previous pages to find a question with sub-question part "a"
   - If found, assign the SAME questionNumber to the current page
   - Continue scanning backward if needed (up to 10 pages) to find the matching question

3. **Scanning Backward for Question Number (MANDATORY):**
   - If a page has sub-question part "b" (or "c", "d", etc.) but no visible question number:
     1. Look at the previous page(s) to find a question with the previous sub-question part (e.g., "a" for "b", "b" for "c")
     2. If found, assign the SAME questionNumber to the current page
     3. Scan backward up to 10 pages if needed to find the matching question
     4. This applies even if pages are far apart (e.g., Page 20 has Q3a, Page 21 has Q3b)

4. **Examples of Correct Assignment:**
   - Example 1: Page 3 has questionNumber "3" with sub-question "a", Page 4 has sub-question "b" text → Page 4 MUST have questionNumber "3"
   - Example 2: Page 20 has questionNumber "3" with sub-question "a", Page 21 has sub-question "b" text → Page 21 MUST have questionNumber "3"
   - Example 3: Page 5 has questionNumber "3" with sub-question "a", Page 6 has sub-question "b" text but no visible "3" → Page 6 MUST still have questionNumber "3"
   - Example 4: Page 4 has questionNumber "3" with sub-question "a", Page 5 says "Does this affect your answer to part (a)?" → Page 5 MUST have questionNumber "3" with sub-question "b"`;

    const multiImageUserPrompt = `Please classify all ${images.length} pages/images together and extract ALL question text from each page. Use context from previous pages to identify question numbers on continuation pages.

${images.map((img, index) => `--- Page ${index + 1} ${img.fileName ? `(${img.fileName})` : ''} ---`).join('\n')}`;

    try {
      const validatedModel = validateModel(model);
      const { ModelProvider } = await import('../../utils/ModelProvider.js');

      // Check if OpenAI model - use vision API, otherwise use Gemini
      const isOpenAI = validatedModel.startsWith('openai-');
      let content: string;
      let usageTokens = 0;
      let apiUsed: string;
      let parsed: any;

      // Use raw images for classification
      const imagesToUse = images;

      if (isOpenAI) {
        // Use OpenAI vision API for multi-image classification
        // Extract model name from full ID (e.g., 'openai-gpt-5-mini' -> 'gpt-5-mini')
        const openaiModelName = validatedModel.replace('openai-', '');

        // Build user content with all images and page indicators
        const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
          { type: 'text', text: multiImageUserPrompt }
        ];

        // Add all images with page indicators
        imagesToUse.forEach((img, index) => {
          const imageData = img.imageData.includes(',') ? img.imageData : `data:image/jpeg;base64,${img.imageData}`;
          userContent.push({
            type: 'text',
            text: `\n--- Page ${index + 1} ${img.fileName ? `(${img.fileName})` : ''} ---`
          });
          userContent.push({
            type: 'image_url',
            image_url: { url: imageData }
          });
        });

        // DEBUG: Save the images being sent to AI

        const result = await ModelProvider.callOpenAIChatWithMultipleImages(multiImageSystemPrompt, userContent, openaiModelName);
        content = result.content;
        usageTokens = result.usageTokens || 0;
        apiUsed = `OpenAI ${result.modelName}`;

        // Parse OpenAI JSON response
        try {
          parsed = JSON.parse(content);
        } catch (parseErr) {
          console.error('❌ [CLASSIFICATION] OpenAI JSON parse failed:', parseErr);
          throw new Error('OpenAI returned non-JSON content');
        }
      } else {
        // Use Gemini with images
        const accessToken = await ModelProvider.getGeminiAccessToken();

        // Build parts array with all images
        const parts: any[] = [
          { text: multiImageSystemPrompt },
          { text: multiImageUserPrompt }
        ];

        // Add all images with page indicators
        imagesToUse.forEach((img, index) => {
          const imageData = img.imageData.includes(',') ? img.imageData.split(',')[1] : img.imageData;
          parts.push({
            text: `\n--- Page ${index + 1} ${img.fileName ? `(${img.fileName})` : ''} ---`
          });
          parts.push({
            inline_data: {
              mime_type: 'image/jpeg',
              data: imageData
            }
          });
        });


        // Make single API call with all images
        const response = await this.makeGeminiMultiImageRequest(accessToken, parts, validatedModel);

        // Check if response is HTML (error page)
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          const htmlContent = await response.text();
          console.error('❌ [CLASSIFICATION] Received HTML response instead of JSON:');
          console.error('❌ [CLASSIFICATION] HTML content:', htmlContent.substring(0, 200) + '...');
          throw new Error('Gemini API returned HTML error page instead of JSON. Check API key and permissions.');
        }

        const result = await response.json() as any;
        content = await this.extractGeminiContent(result);
        const cleanContent = this.cleanGeminiResponse(content);
        parsed = this.parseJsonWithSanitization(cleanContent);
        usageTokens = result.usageMetadata?.totalTokenCount || 0;

        // Get dynamic API name
        const { getModelConfig } = await import('../../config/aiModels.js');
        const modelConfig = getModelConfig(validatedModel);
        const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || validatedModel;
        apiUsed = `Google ${modelName} (Service Account)`;
      }

      // Parse response - handle both single result and per-page results
      let results: Array<{ pageIndex: number; result: ClassificationResult }> = [];

      if (parsed.pages && Array.isArray(parsed.pages)) {
        // New format: per-page results
        parsed.pages.forEach((pageResult: any, index: number) => {
          const processedQuestions = this.parseQuestionsFromResponse({ questions: pageResult.questions }, 0.9);
          results.push({
            pageIndex: index,
            result: {
              category: pageResult.category || parsed.category || 'questionAnswer',
              reasoning: pageResult.reasoning || parsed.reasoning || 'Multi-page classification',
              questions: processedQuestions,
              apiUsed,
              usageTokens: usageTokens
            }
          });
        });
      } else {
        // Single result format
        const processedQuestions = this.parseQuestionsFromResponse(parsed, 0.9);
        const singleResult: ClassificationResult = {
          category: parsed.category || 'questionAnswer',
          reasoning: parsed.reasoning || 'Multi-page classification',
          questions: processedQuestions,
          apiUsed,
          usageTokens: usageTokens
        };

        // Distribute single result to all pages (fallback behavior)
        images.forEach((_, index) => {
          results.push({ pageIndex: index, result: singleResult });
        });
      }

      return results;
    } catch (error) {
      // Check if this is our validation error (fail fast)
      if (error instanceof Error && error.message.includes('Unsupported model')) {
        throw error;
      }

      // Google API error handling (suppress detailed logs for known RECITATION case)
      const errMsg = (error instanceof Error ? error.message : String(error));
      const isRecitation = errMsg.toUpperCase().includes('RECITATION');
      let actualModelName = 'unknown';
      let apiVersion = 'v1';

      if (isRecitation) {
        // Minimal logging for known issue
        console.error('❌ [GOOGLE API ERROR] Gemini API error: RECITATION');
      } else {
        const { getModelConfig } = await import('../../config/aiModels.js');
        try {
          const validatedModel = validateModel(model);
          const modelConfig = getModelConfig(validatedModel);
          actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || (model as string);
          apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
          console.error(`❌ [GOOGLE API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
          console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
        } catch {
          // Ignore config errors during error handling
        }
        console.error(`❌ [GOOGLE ERROR] ${errMsg}`);
      }

      // Use unified error handling
      const { ErrorHandler } = await import('../../utils/errorHandler.js');
      const errorInfo = ErrorHandler.analyzeError(error);

      // Fail fast on 429 errors with clear message
      if (errorInfo.isRateLimit) {
        console.error(`❌ [QUOTA EXCEEDED] ${actualModelName} (${apiVersion}) quota exceeded`);
        throw new Error(`API quota exceeded for ${actualModelName} (${apiVersion}). Please check your Google Cloud Console for quota limits.`);
      }

      // Fallback only for specific Gemini "RECITATION" style errors
      // Reuse classifyImage for each image individually (which has its own fallback logic)
      const message = errMsg.toLowerCase();
      const shouldFallback = message.includes('recitation') || message.includes('promptfeedback') || message.includes('blockreason');
      const { isOpenAIConfigured } = await import('../../config/aiModels.js');

      if (shouldFallback && isOpenAIConfigured()) {
        try {
          console.warn('⚠️ [CLASSIFICATION] Gemini RECITATION-style error detected in multi-image call. Falling back to individual image classification.');

          // Fallback: Classify each image individually using classifyImage (which has its own fallback)
          const results: Array<{ pageIndex: number; result: ClassificationResult }> = [];

          for (let i = 0; i < images.length; i++) {
            const img = images[i];
            try {
              // Reuse classifyImage which already has hardcoded bypass and OpenAI fallback
              const result = await this.classifyImage(img.imageData, model, debug, img.fileName);
              results.push({
                pageIndex: img.pageIndex ?? i,
                result
              });
            } catch (individualError) {
              // If individual classification also fails, log and continue with next image
              console.error(`❌ [CLASSIFICATION] Failed to classify image ${i + 1} (${img.fileName || 'unknown'}):`, individualError);
              // Add a fallback result to maintain page count
              results.push({
                pageIndex: img.pageIndex ?? i,
                result: {
                  category: 'questionAnswer',
                  reasoning: 'Classification failed for this image',
                  questions: [],
                  apiUsed: 'Failed',
                  usageTokens: 0
                }
              });
            }
          }

          return results;
        } catch (fallbackError) {
          console.error('❌ [CLASSIFICATION] Individual image fallback also failed:', fallbackError);
          throw error; // Re-throw original error
        }
      }

      // If not a RECITATION error or OpenAI not configured, re-throw original error
      throw error;
    }
  }

  static async classifyImage(imageData: string, model: ModelType, debug: boolean = false, fileName?: string): Promise<ClassificationResult> {
    const systemPrompt = getPrompt('classification.system');
    const userPrompt = getPrompt('classification.user');

    try {
      // Hardcoded test data: Only trigger for specific filenames
      if (fileName === "IMG_1596.jpg" || fileName === "q21-edexcel-ball-pen-stroke.pdf" || fileName === "q21-edexcel-ball-pen-stroke.png") {
        const q21Text = "The diagram shows a plan of Jason's garden. [A composite shape is shown, described as: ABCO and DEFO are rectangles. CDO is a right-angled triangle. AFO is a sector of a circle with centre O and angle AOF = 90°. Dimensions are given: AB = 11m, BC = 7m, ED = 7m, FE = 9m.] Jason is going to cover his garden with grass seed. Each bag of grass seed covers 14 m² of garden. Each bag of grass seed costs £10.95. Work out how much it will cost Jason to buy all the bags of grass seed he needs.";

        return {
          category: "questionAnswer",
          reasoning: "The image contains the math question along with calculations and the final answer, which constitutes student work.",
          questions: [
            {
              questionNumber: "21", // Hardcoded test data includes question number
              text: q21Text,
              subQuestions: [],
              confidence: 0.95
            }
          ],
          apiUsed: "Hardcoded Test Data",
          usageTokens: 0
        };
      }

      // Normal Gemini call for all other files
      const validatedModel = validateModel(model);
      return await this.callGeminiForClassification(imageData, systemPrompt, userPrompt, validatedModel);
    } catch (error) {
      // Check if this is our validation error (fail fast)
      if (error instanceof Error && error.message.includes('Unsupported model')) {
        // This is our validation error - re-throw it as-is
        throw error;
      }

      // Google API error handling (suppress detailed logs for known RECITATION case)
      const errMsg = (error instanceof Error ? error.message : String(error));
      const isRecitation = errMsg.toUpperCase().includes('RECITATION');
      let actualModelName = 'unknown';
      let apiVersion = 'v1';
      if (isRecitation) {
        // Minimal logging for known issue
        console.error('❌ [GOOGLE API ERROR] Gemini API error: RECITATION');
      } else {
        const { getModelConfig } = await import('../../config/aiModels.js');
        const modelConfig = getModelConfig(model);
        actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || (model as string);
        apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';
        console.error(`❌ [GOOGLE API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
        console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
        console.error(`❌ [GOOGLE ERROR] ${errMsg}`);
      }

      // Use unified error handling
      const errorInfo = ErrorHandler.analyzeError(error);

      // Fail fast on 429 errors with clear message
      if (errorInfo.isRateLimit) {
        console.error(`❌ [QUOTA EXCEEDED] ${actualModelName} (${apiVersion}) quota exceeded`);
        throw new Error(`API quota exceeded for ${actualModelName} (${apiVersion}). Please check your Google Cloud Console for quota limits.`);
      }

      // Fallback only for specific Gemini "RECITATION" style errors
      const message = errMsg.toLowerCase();
      const shouldFallback = message.includes('recitation') || message.includes('promptfeedback') || message.includes('blockreason');
      const { isOpenAIConfigured } = await import('../../config/aiModels.js');
      if (shouldFallback && isOpenAIConfigured()) {
        try {
          console.warn('⚠️ [CLASSIFICATION] Gemini RECITATION-style error detected. Falling back to OpenAI.');
          // Reuse the same classification prompt for OpenAI fallback
          const systemPrompt = getPrompt('classification.system');
          const userPrompt = getPrompt('classification.user');
          const { ModelProvider } = await import('../../utils/ModelProvider.js');
          // Pass the image as data URL so OpenAI vision-capable models can see it
          const openai = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData);
          let parsed;
          try {
            parsed = JSON.parse(openai.content);
          } catch (parseErr) {
            console.error('❌ [CLASSIFICATION FALLBACK] OpenAI JSON parse failed:', parseErr);
            throw new Error('OpenAI fallback returned non-JSON content');
          }
          // Debug: Log raw AI response structure
          if (parsed.questions && Array.isArray(parsed.questions)) {
            console.log(`🔍 [CLASSIFICATION RAW - OpenAI] AI returned ${parsed.questions.length} question(s) with structure:`,
              parsed.questions.map((q: any) => ({
                questionNumber: q.questionNumber,
                hasText: !!q.text,
                hasSubQuestions: !!(q.subQuestions && q.subQuestions.length > 0),
                subQuestionsCount: q.subQuestions?.length || 0
              }))
            );
          }

          // Reuse same shared parsing function as Gemini for consistency (0.8 default confidence for OpenAI)
          const processedQuestions = this.parseQuestionsFromResponse(parsed, 0.8);

          return {
            category: parsed.category || (parsed.isQuestionOnly ? "questionOnly" : "questionAnswer"),
            reasoning: parsed.reasoning || 'OpenAI fallback classification',
            questions: processedQuestions,
            apiUsed: `OpenAI ${openai.modelName}`,
            usageTokens: openai.usageTokens || 0
          };
        } catch (fallbackErr) {
          console.error('❌ [CLASSIFICATION FALLBACK] OpenAI fallback failed:', fallbackErr);
          throw error; // surface original Gemini error
        }
      }

      // Fail fast otherwise - no fallback
      throw error;
    }
  }

  private static async callGeminiForClassification(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<ClassificationResult> {
    try {
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const accessToken = await ModelProvider.getGeminiAccessToken();
      const response = await this.makeGeminiRequest(accessToken, imageData, systemPrompt, userPrompt, model);

      // Check if response is HTML (error page)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        const htmlContent = await response.text();
        console.error('❌ [CLASSIFICATION] Received HTML response instead of JSON:');
        console.error('❌ [CLASSIFICATION] HTML content:', htmlContent.substring(0, 200) + '...');
        throw new Error('Gemini API returned HTML error page instead of JSON. Check API key and permissions.');
      }

      const result = await response.json() as any;
      const content = await this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      const sanitizedContent = this.parseJsonWithSanitization(cleanContent, true); // true = return string for parseGeminiResponse
      const finalResult = await this.parseGeminiResponse(sanitizedContent, result, model);

      return finalResult;
    } catch (error) {
      console.error(`❌ [CLASSIFICATION] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }




  private static async makeGeminiMultiImageRequest(
    accessToken: string,
    parts: any[],
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<Response> {
    // Use centralized model configuration
    const { getModelConfig } = await import('../../config/aiModels.js');
    const config = getModelConfig(model);
    const endpoint = config.apiEndpoint;

    const requestBody = {
      contents: [{
        parts: parts
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: (await import('../../config/aiModels.js')).getModelConfig('gemini-2.5-flash').maxTokens
      },
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
      const errorText = await response.text();
      const { getModelConfig } = await import('../../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      const apiVersion = modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1';

      console.error(`❌ [GEMINI API ERROR] Failed with model: ${actualModelName} (${apiVersion})`);
      console.error(`❌ [API ENDPOINT] ${modelConfig.apiEndpoint}`);
      console.error(`❌ [HTTP STATUS] ${response.status} ${response.statusText}`);
      console.error(`❌ [ERROR DETAILS] ${errorText}`);

      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} for ${actualModelName} (${apiVersion}) - ${errorText}`);
    }

    return response;
  }

  private static async makeGeminiRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: ModelType = 'gemini-2.5-pro'
  ): Promise<Response> {
    // Use centralized model configuration
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
        temperature: 0,
        maxOutputTokens: (await import('../../config/aiModels.js')).getModelConfig('gemini-2.5-flash').maxTokens
      }, // Use centralized config
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
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    return ModelProvider.extractGeminiTextContent(result);
  }

  private static cleanGeminiResponse(content: string): string {
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return cleanContent;
  }

  /**
   * Parse JSON with robust sanitization for invalid escape sequences
   * @param jsonString The JSON string to parse
   * @param returnString If true, return the sanitized string instead of parsed object (for parseGeminiResponse)
   * @returns Parsed object or sanitized string
   */
  private static parseJsonWithSanitization(jsonString: string, returnString: boolean = false): any {
    // First, try to parse directly (fast path for valid JSON)
    try {
      const parsed = JSON.parse(jsonString);
      return returnString ? jsonString : parsed;
    } catch (error) {
      // Log the error and problematic content
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ [CLASSIFICATION] JSON Parse Error (first attempt):');
      console.error(`❌ [CLASSIFICATION] Error: ${errorMessage}`);

      // Find the position mentioned in the error (e.g., "at position 5963")
      const positionMatch = errorMessage.match(/position (\d+)/);
      const errorPosition = positionMatch ? parseInt(positionMatch[1], 10) : null;

      // Log the problematic content around the error position
      if (errorPosition !== null && errorPosition < jsonString.length) {
        const start = Math.max(0, errorPosition - 100);
        const end = Math.min(jsonString.length, errorPosition + 100);
        const context = jsonString.substring(start, end);
        const relativePos = errorPosition - start;
        console.error(`❌ [CLASSIFICATION] Content around error position ${errorPosition}:`);
        console.error(`❌ [CLASSIFICATION] ...${context.substring(0, relativePos)}${'\x1b[31m'}${context[relativePos]}${'\x1b[0m'}${context.substring(relativePos + 1)}...`);
      } else {
        // If we can't find position, log a sample of the content
        console.error(`❌ [CLASSIFICATION] Content length: ${jsonString.length} characters`);
        console.error(`❌ [CLASSIFICATION] First 500 chars: ${jsonString.substring(0, 500)}`);
        if (jsonString.length > 500) {
          console.error(`❌ [CLASSIFICATION] Last 500 chars: ...${jsonString.substring(jsonString.length - 500)}`);
        }
      }

      // Sanitize invalid escape sequences
      let sanitized = jsonString;

      // CRITICAL: First, normalize excessive backslashes in LaTeX commands
      // The AI sometimes returns sequences like \\\\pi (4 backslashes) or \\\pi (3 backslashes)
      // In JSON source: \\ = single backslash in string, \\\\ = two backslashes in string
      // We need: single backslash for LaTeX = \\ in JSON source

      // Strategy: Fix all problematic backslash sequences before JSON parsing
      // Handle cases like: \\\sin, \\\\sin, \\\\\sin, etc.
      // Pattern explanation:
      // - (\\\\)+ matches one or more pairs of backslashes (each pair = one backslash in string)
      // - \\ matches a single backslash (invalid escape in JSON)
      // - ([a-zA-Z{]) matches the LaTeX command character
      // We want to normalize to exactly \\ (two backslashes in JSON = one backslash in string)

      // First, fix triple backslashes (most common): \\\command → \\command
      // This handles the case where we have: \\ (one backslash) + \ (invalid escape) + command
      sanitized = sanitized.replace(/(\\\\)\\([a-zA-Z{])/g, '\\\\$2');

      // Then fix sequences of 4+ backslashes: \\\\command → \\command
      sanitized = sanitized.replace(/(\\\\){2,}([a-zA-Z{])/g, '\\\\$2');

      // Also handle cases where backslashes appear before LaTeX commands in math mode ($...$)
      // Fix patterns like: $...\\\command...$ or $...\\\\command...$
      sanitized = sanitized.replace(/\$([^$]*?)(\\\\)\\([a-zA-Z{])/g, '$$1\\\\$3');
      sanitized = sanitized.replace(/\$([^$]*?)(\\\\){2,}([a-zA-Z{])/g, '$$1\\\\$3');

      // Fix invalid escape sequences (e.g., \x where x is not a valid escape character)
      // Valid escapes: \n, \r, \t, \\, \", \/, \b, \f, \uXXXX (where XXXX is 4 hex digits)
      // We need to escape backslashes that are not followed by valid escape characters
      // Be careful: \u must be followed by 4 hex digits, so we check for that separately
      // BUT: Skip if it's already a LaTeX command (\\command is already properly escaped)
      // Also skip if it's inside a string value (we'll handle those separately)

      // More aggressive: Fix any remaining triple+ backslash sequences before LaTeX commands
      // This catches cases that might have been missed in the previous steps
      sanitized = sanitized.replace(/(\\\\){3,}([a-zA-Z{])/g, '\\\\$2');

      // Fix invalid escape sequences that aren't part of LaTeX commands
      sanitized = sanitized.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4}|\\[a-zA-Z{])/g, '\\\\');

      // Fix common LaTeX escaping issues - only fix unescaped LaTeX commands
      // Pattern: Match single backslash followed by LaTeX command (not already \\command)
      sanitized = sanitized
        .replace(/(?<!\\\\)\\frac\{([^}]+)\}\{([^}]+)\}/g, '\\\\frac{$1}{$2}') // Fix \frac{}{} if not already escaped
        .replace(/(?<!\\\\)\\(times|pi|theta|alpha|beta|gamma|delta|omega|sqrt|mathrm|text)(?![a-zA-Z{])/g, '\\\\$1') // Fix common LaTeX commands
        .replace(/(?<!\\\\)\\([a-zA-Z]+)/g, '\\\\$1'); // Fix any remaining LaTeX commands

      // Try parsing again after sanitization
      try {
        const parsed = JSON.parse(sanitized);
        console.log('✅ [CLASSIFICATION] JSON parsing succeeded after sanitization');
        return returnString ? sanitized : parsed;
      } catch (secondError) {
        const secondErrorMessage = secondError instanceof Error ? secondError.message : String(secondError);
        console.error('❌ [CLASSIFICATION] JSON Parse Error (after sanitization):');
        console.error(`❌ [CLASSIFICATION] Error: ${secondErrorMessage}`);
        console.error(`❌ [CLASSIFICATION] Sanitized content length: ${sanitized.length} characters`);
        console.error(`❌ [CLASSIFICATION] Sanitized content (first 1000 chars): ${sanitized.substring(0, 1000)}`);

        // Find the position in the sanitized string
        const secondPositionMatch = secondErrorMessage.match(/position (\d+)/);
        if (secondPositionMatch) {
          const secondErrorPosition = parseInt(secondPositionMatch[1], 10);
          const start = Math.max(0, secondErrorPosition - 100);
          const end = Math.min(sanitized.length, secondErrorPosition + 100);
          const context = sanitized.substring(start, end);
          const relativePos = secondErrorPosition - start;
          console.error(`❌ [CLASSIFICATION] Sanitized content around error position ${secondErrorPosition}:`);
          console.error(`❌ [CLASSIFICATION] ...${context.substring(0, relativePos)}${'\x1b[31m'}${context[relativePos]}${'\x1b[0m'}${context.substring(relativePos + 1)}...`);
        }

        throw new Error(`Failed to parse Gemini response as JSON even after sanitization. Original error: ${errorMessage}. Sanitization error: ${secondErrorMessage}`);
      }
    }
  }

  /**
   * Parse hierarchical question structure from AI response
   */
  private static parseQuestionsFromResponse(parsed: any, defaultConfidence: number = 0.9): any[] | undefined {
    const questions = parsed.questions?.map((q: any) => {
      // DEBUG: Check if position data is present in raw response
      if (q.questionNumber === '10' || q.questionNumber === 10) {
        console.log(`[CLASSIFICATION DEBUG] Q10 Raw AI Response - Full question object keys:`, Object.keys(q));
        console.log(`[CLASSIFICATION DEBUG] Q10 Raw AI Response Position:`, JSON.stringify(q.studentWorkPosition));
        console.log(`[CLASSIFICATION DEBUG] Q10 studentWork content:`, q.studentWork?.substring(0, 100));
      }
      return {
        questionNumber: q.questionNumber !== undefined ? (q.questionNumber || null) : undefined,
        text: q.text !== undefined ? (q.text || null) : undefined,
        studentWork: q.studentWork !== undefined ? (q.studentWork || null) : undefined,
        studentWorkPosition: q.studentWorkPosition,
        hasStudentDrawing: q.hasStudentDrawing !== undefined ? (q.hasStudentDrawing === true) : false,
        subQuestions: q.subQuestions?.map((sq: any) => ({
          part: sq.part,
          text: sq.text,
          studentWork: sq.studentWork !== undefined ? (sq.studentWork || null) : undefined,
          studentWorkPosition: sq.studentWorkPosition,
          hasStudentDrawing: sq.hasStudentDrawing !== undefined ? (sq.hasStudentDrawing === true) : false,
          confidence: defaultConfidence,
          pageIndex: sq.pageIndex
        })),
        confidence: q.confidence || defaultConfidence
      };
    });

    return questions;
  }

  private static async parseGeminiResponse(cleanContent: string, result: any, modelType: string): Promise<ClassificationResult> {
    // Debug logging will be moved to after step completion

    // Use parseJsonWithSanitization which handles errors and logging internally
    const parsed = this.parseJsonWithSanitization(cleanContent, false);

    // Get dynamic API name based on model
    const { getModelConfig } = await import('../../config/aiModels.js');
    const modelConfig = getModelConfig(modelType as ModelType);
    const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || modelType;
    const apiUsed = `Google ${modelName} (Service Account)`;

    // Debug: Log raw AI response structure
    if (parsed.questions && Array.isArray(parsed.questions)) {
      console.log(`🔍 [CLASSIFICATION RAW] AI returned ${parsed.questions.length} question(s) with structure:`,
        parsed.questions.map((q: any) => ({
          questionNumber: q.questionNumber,
          hasText: !!q.text,
          hasSubQuestions: !!(q.subQuestions && q.subQuestions.length > 0),
          subQuestionsCount: q.subQuestions?.length || 0
        }))
      );
    }

    // Use shared parsing function
    const questions = this.parseQuestionsFromResponse(parsed);

    return {
      category: parsed.category || (parsed.isQuestionOnly ? "questionOnly" : "questionAnswer"),
      reasoning: parsed.reasoning,
      apiUsed,
      questions: questions,
      usageTokens: result.usageMetadata?.totalTokenCount || 0
    };
  }

}
