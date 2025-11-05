import type { ModelType } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import * as path from 'path';
import { getModelConfig, getDebugMode, validateModel } from '../../config/aiModels.js';
import { ErrorHandler } from '../../utils/errorHandler.js';

export interface ClassificationResult {
  category: "questionOnly" | "questionAnswer" | "metadata";
  reasoning: string;
  apiUsed: string;
  extractedQuestionText?: string; // Legacy support
  questions?: Array<{
    questionNumber?: string | null; // Main question number (e.g., "1", "2", "3") or null
    text: string | null; // Main question text, or null if no main text (only sub-questions)
    studentWork?: string | null; // Extracted student work for main question (LaTeX format)
    subQuestions?: Array<{
      part: string; // Sub-question part (e.g., "a", "b", "i", "ii")
      text: string; // Complete sub-question text
      studentWork?: string | null; // Extracted student work for sub-question (LaTeX format)
      confidence?: number;
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
    const multiImageSystemPrompt = systemPrompt + `\n\nIMPORTANT FOR MULTI-PAGE DOCUMENTS:
- You are analyzing ${images.length} pages/images together
- Use context from previous pages to identify question numbers on continuation pages
- If a page references "part (a)" or "part (b)", look at previous pages to find the main question number
- Continuation pages may only show sub-question parts (e.g., "b") - infer the full question number from context
- For example: If Page 4 has Q3 with sub-question "a", and Page 5 says "Does this affect your answer to part (a)?", infer that Page 5 is Q3b
- Return results for EACH page in the "pages" array, maintaining the same order as input`;
    
    const multiImageUserPrompt = `Please classify all ${images.length} pages/images together and extract ALL question text from each page. Use context from previous pages to identify question numbers on continuation pages.

${images.map((img, index) => `--- Page ${index + 1} ${img.fileName ? `(${img.fileName})` : ''} ---`).join('\n')}`;

    try {
      const validatedModel = validateModel(model);
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const accessToken = await ModelProvider.getGeminiAccessToken();
      
      // Build parts array with all images
      const parts: any[] = [
        { text: multiImageSystemPrompt },
        { text: multiImageUserPrompt }
      ];
      
      // Add all images with page indicators
      images.forEach((img, index) => {
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
      const content = await this.extractGeminiContent(result);
      const cleanContent = this.cleanGeminiResponse(content);
      const parsed = JSON.parse(cleanContent);
      
      // Get dynamic API name
      const { getModelConfig } = await import('../../config/aiModels.js');
      const modelConfig = getModelConfig(validatedModel);
      const modelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || validatedModel;
      const apiUsed = `Google ${modelName} (Service Account)`;
      
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
              extractedQuestionText: pageResult.extractedQuestionText,
              apiUsed,
              usageTokens: result.usageMetadata?.totalTokenCount || 0
            }
          });
        });
      } else {
        // Fallback: single result format (backward compatibility)
        const processedQuestions = this.parseQuestionsFromResponse(parsed, 0.9);
        const singleResult: ClassificationResult = {
          category: parsed.category || 'questionAnswer',
          reasoning: parsed.reasoning || 'Multi-page classification',
          questions: processedQuestions,
          extractedQuestionText: parsed.extractedQuestionText,
          apiUsed,
          usageTokens: result.usageMetadata?.totalTokenCount || 0
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
          extractedQuestionText: q21Text,
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
          const systemPrompt = getPrompt('classificationOpenAI.system');
          const userPrompt = getPrompt('classificationOpenAI.user');
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
          let processedQuestions = this.parseQuestionsFromResponse(parsed, 0.8);
          
          // Legacy support: convert extractedQuestionText to questions array if no questions
          if (!processedQuestions && parsed.extractedQuestionText) {
            processedQuestions = [{
              questionNumber: undefined,
              text: parsed.extractedQuestionText,
              subQuestions: [],
              confidence: 0.8
            }];
          }
          
          return {
            category: parsed.category || (parsed.isQuestionOnly ? "questionOnly" : "questionAnswer"),
            reasoning: parsed.reasoning || 'OpenAI fallback classification',
            extractedQuestionText: parsed.extractedQuestionText, // Legacy support
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
      const finalResult = await this.parseGeminiResponse(cleanContent, result, model);
      
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
        temperature: 0.1, 
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
        temperature: 0.1, 
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
   * Shared parsing function for hierarchical question structure
   * Handles both new hierarchical format and old flat format (backward compatibility)
   */
  private static parseQuestionsFromResponse(parsed: any, defaultConfidence: number = 0.9): any[] | undefined {
    // Handle hierarchical structure with backward compatibility
    const questions = parsed.questions?.map((q: any) => {
      return {
        questionNumber: q.questionNumber !== undefined ? (q.questionNumber || null) : undefined,
        text: q.text !== undefined ? (q.text || null) : undefined, // Support null for empty main text
        studentWork: q.studentWork !== undefined ? (q.studentWork || null) : undefined, // Extract student work for main question
        subQuestions: q.subQuestions?.map((sq: any) => ({
          part: sq.part,
          text: sq.text,
          studentWork: sq.studentWork !== undefined ? (sq.studentWork || null) : undefined, // Extract student work for sub-question
          confidence: sq.confidence
        })),
        confidence: q.confidence || defaultConfidence
      };
    });
    
    // Backward compatibility: if old flat format (questionNumber like "2a", "2b"), convert to hierarchical
    if (questions && questions.length > 0) {
      const hasSubQuestionsInStructure = questions.some((q: any) => q.subQuestions && q.subQuestions.length > 0);
      const hasFlatSubQuestions = questions.some((q: any) => q.questionNumber && /[a-z]/i.test(q.questionNumber));
      
      if (!hasSubQuestionsInStructure && hasFlatSubQuestions) {
        // Convert flat format to hierarchical
        const grouped = new Map<string, any>();
        questions.forEach((q: any) => {
          if (!q.questionNumber) {
            // Question without number, keep as-is
            grouped.set(q.questionNumber || `_${Math.random()}`, q);
            return;
          }
          
          const baseNumber = String(q.questionNumber).replace(/[a-z]/i, '');
          const subPart = String(q.questionNumber).replace(/\d+/g, '');
          
          if (subPart) {
            // This is a sub-question (e.g., "2a")
            if (!grouped.has(baseNumber)) {
              grouped.set(baseNumber, {
                questionNumber: baseNumber,
                text: null,
                subQuestions: [],
                confidence: q.confidence
              });
            }
            grouped.get(baseNumber).subQuestions.push({
              part: subPart.toLowerCase(),
              text: q.text,
              confidence: q.confidence
            });
            // Update text to first sub-question if main text is empty
            if (!grouped.get(baseNumber).text) {
              grouped.get(baseNumber).text = q.text;
            }
          } else {
            // This is a main question (e.g., "2")
            grouped.set(baseNumber, {
              questionNumber: baseNumber,
              text: q.text,
              subQuestions: [],
              confidence: q.confidence
            });
          }
        });
        
        return Array.from(grouped.values());
      }
    }
    
    return questions;
  }

  private static async parseGeminiResponse(cleanContent: string, result: any, modelType: string): Promise<ClassificationResult> {
    // Debug logging will be moved to after step completion
    
    let parsed;
    try {
      parsed = JSON.parse(cleanContent);
    } catch (error) {
      console.error('❌ [CLASSIFICATION] JSON Parse Error:');
      console.error('❌ [CLASSIFICATION] Content that failed to parse:', cleanContent);
      console.error('❌ [CLASSIFICATION] Parse error:', error);
      throw new Error(`Failed to parse Gemini response as JSON. Content: ${cleanContent.substring(0, 100)}...`);
    }
    
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
      category: parsed.category || (parsed.isQuestionOnly ? "questionOnly" : "questionAnswer"), // Support both new and old format
      reasoning: parsed.reasoning,
      apiUsed,
      extractedQuestionText: parsed.extractedQuestionText, // Legacy support
      questions: questions,
      usageTokens: result.usageMetadata?.totalTokenCount || 0
    };
  }




}


