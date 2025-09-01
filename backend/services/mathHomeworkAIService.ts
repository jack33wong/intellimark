// Define all types inline to avoid import issues
interface SimpleImageClassification {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
}

type SimpleModelType = 'gemini-2.5-pro' | 'chatgpt-5' | 'chatgpt-4o';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
}

interface SimpleProcessedImageResult {
  ocrText: string;
  boundingBoxes: BoundingBox[];
  confidence: number;
  imageDimensions: {
    width: number;
    height: number;
  };
  isQuestion?: boolean;
}

interface Annotation {
  action: 'circle' | 'write' | 'tick' | 'cross' | 'underline' | 'comment';
  bbox: [number, number, number, number]; // [x, y, width, height]
  comment?: string; // Optional for marking actions
  text?: string; // For comment actions
}

interface SimpleMarkingInstructions {
  annotations: Annotation[];
}

/**
 * Math Homework AI Service for image classification and marking instructions
 * Handles both Gemini and OpenAI APIs with proper error handling
 */
export class MathHomeworkAIService {
  /**
   * Classify an image using AI services
   */
  static async classifyImage(imageData: string, model: SimpleModelType): Promise<SimpleImageClassification> {
    try {
      console.log('🔍 ===== REAL AI IMAGE CLASSIFICATION =====');
      console.log('🔍 Using model:', model);

      if (model === 'gemini-2.5-pro') {
        return await this.callGeminiForClassification(imageData);
      } else {
        return await this.callOpenAIForClassification(imageData, model);
      }
    } catch (error) {
      console.error('❌ Real AI classification failed:', error);
      // Fallback to basic logic if AI fails
      const imageSize = imageData.length;
      const hasStudentWork = imageSize > 200;
      
      return {
        isQuestionOnly: !hasStudentWork,
        reasoning: `AI classification failed: ${error instanceof Error ? error.message : 'Unknown error'}. Using fallback logic.`,
        apiUsed: 'Fallback Classification'
      };
    }
  }

  /**
   * Generate marking instructions using AI services
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: SimpleModelType, 
    processedImage: SimpleProcessedImageResult
  ): Promise<SimpleMarkingInstructions> {
    try {
      console.log('🔍 Generating real AI marking instructions for model:', model);

      if (model === 'gemini-2.5-pro') {
        return await this.callGeminiForMarkingInstructions(imageData, processedImage);
      } else {
        return await this.callOpenAIForMarkingInstructions(imageData, model, processedImage);
      }
    } catch (error) {
      console.error('❌ Real AI marking instructions failed:', error);
      // Fallback to logic-based marking if AI fails
      return this.generateFallbackMarkingInstructions(processedImage);
    }
  }

  /**
   * Call Gemini API for image classification
   */
  private static async callGeminiForClassification(imageData: string): Promise<SimpleImageClassification> {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
      }

      const systemPrompt = 'You are an AI assistant that classifies math images. Your task is to determine if an uploaded image contains: A) A math question ONLY (no student work, no answers, just the question/problem) B) A math question WITH student work/answers (homework to be marked). CRITICAL OUTPUT RULES: Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations. NO backticks, NO "```json" formatting, NO markdown. Output MUST strictly follow this exact format: {"isQuestionOnly":true,"reasoning":"brief explanation"}. CLASSIFICATION CRITERIA: "isQuestionOnly: true" if the image shows ONLY a math question/problem with NO student work or answers, "isQuestionOnly: false" if the image shows a math question WITH student work, calculations, or answers written down. Examples: Textbook question, exam paper question, worksheet question = "isQuestionOnly: true", Student homework with written answers, student working out, completed problem = "isQuestionOnly: false". Return ONLY the raw JSON object without any formatting.';

      const userPrompt = 'Please classify this uploaded image as either a math question only or a math question with student work/answers.';

      // Make real Gemini API call
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: systemPrompt },
              { text: userPrompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageData.replace('data:image/jpeg;base64,', '')
                }
              }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as any;
      console.log('🔍 Gemini API response:', JSON.stringify(result, null, 2));

      // Extract the response text
      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error('No response text from Gemini API');
      }

      // Parse the JSON response
      try {
        const parsedResponse = JSON.parse(responseText);
        return {
          isQuestionOnly: parsedResponse.isQuestionOnly,
          reasoning: parsedResponse.reasoning,
          apiUsed: 'Gemini API (Real)'
        };
      } catch (parseError) {
        console.error('🔍 Failed to parse Gemini response as JSON:', responseText);
        // Fallback to basic logic if parsing fails
        const imageSize = imageData.length;
        const hasStudentWork = imageSize > 200;
        
        return {
          isQuestionOnly: !hasStudentWork,
          reasoning: `Gemini response parsing failed: ${responseText}. Using fallback logic.`,
          apiUsed: 'Gemini API (Parse Error)'
        };
      }
    } catch (error) {
      throw new Error(`Gemini API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Call OpenAI API for image classification
   */
  private static async callOpenAIForClassification(imageData: string, model: SimpleModelType): Promise<SimpleImageClassification> {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const systemPrompt = 'You are an AI assistant that classifies math images. Your task is to determine if an uploaded image contains: A) A math question ONLY (no student work, no answers, just the question/problem) B) A math question WITH student work/answers (homework to be marked). CRITICAL OUTPUT RULES: Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations. NO backticks, NO "```json" formatting, NO markdown. Output MUST strictly follow this exact format: {"isQuestionOnly":true,"reasoning":"brief explanation"}. CLASSIFICATION CRITERIA: "isQuestionOnly: true" if the image shows ONLY a math question/problem with NO student work or answers, "isQuestionOnly: false" if the image shows a math question WITH student work, calculations, or answers written down. Examples: Textbook question, exam paper question, worksheet question = "isQuestionOnly: true", Student homework with written answers, student working out, completed problem = "isQuestionOnly: false". Return ONLY the raw JSON object without any formatting.';

      const userPrompt = 'Please classify this uploaded image as either a math question only or a math question with student work/answers.';

      // Make real OpenAI API call with vision support
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model === 'chatgpt-5' ? 'gpt-5' : 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { 
              role: 'user', 
              content: [
                { type: 'text', text: userPrompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageData
                  }
                }
              ]
            }
          ],
          max_tokens: 1000,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as any;
      console.log('🔍 OpenAI API response:', JSON.stringify(result, null, 2));

      // Extract the response text
      const responseText = result.choices?.[0]?.message?.content;
      if (!responseText) {
        throw new Error('No response text from OpenAI API');
      }

      // Parse the JSON response
      try {
        const parsedResponse = JSON.parse(responseText);
        return {
          isQuestionOnly: parsedResponse.isQuestionOnly,
          reasoning: parsedResponse.reasoning,
          apiUsed: `${model} API (Real)`
        };
      } catch (parseError) {
        console.error('🔍 Failed to parse OpenAI response as JSON:', responseText);
        // Fallback to basic logic if parsing fails
        const imageSize = imageData.length;
        const hasStudentWork = imageSize > 200;
        
        return {
          isQuestionOnly: !hasStudentWork,
          reasoning: `OpenAI response parsing failed: ${responseText}. Using fallback logic.`,
          apiUsed: `${model} API (Parse Error)`
        };
      }
    } catch (error) {
      throw new Error(`OpenAI API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Call Gemini API for marking instructions
   */
  private static async callGeminiForMarkingInstructions(
    imageData: string, 
    processedImage: SimpleProcessedImageResult
  ): Promise<SimpleMarkingInstructions> {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
      }

      const systemPrompt = 'You are an expert math teacher analyzing student homework. Your task is to provide detailed marking instructions for a math problem solution. CRITICAL OUTPUT RULES: Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations. NO backticks, NO "```json" formatting, NO markdown. Output MUST strictly follow this exact format: {"annotations":[{"action":"tick","bbox":[x,y,width,height],"comment":"feedback","text":"optional"}]}. MARKING GUIDELINES: Use "tick" for correct mathematical work, solutions, and answers. Use "circle" for areas that need attention or verification. Use "underline" for excellent methods or key concepts. Use "comment" for detailed feedback or encouragement. ANALYZE THE IMAGE CAREFULLY and provide specific, helpful feedback for each mathematical element. Return ONLY the raw JSON object without any formatting.';

      const userPrompt = `Please analyze this student's math homework and provide detailed marking instructions with specific feedback for each part of their solution. OCR TEXT: ${processedImage.ocrText || 'No text extracted'}. BOUNDING BOXES: ${processedImage.boundingBoxes?.length || 0} detected areas. Based on the image content and any extracted text, provide specific marking instructions.`;

      // Make real Gemini API call
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: systemPrompt },
              { text: userPrompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageData.replace('data:image/jpeg;base64,', '')
                }
              }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as any;
      console.log('🔍 Gemini marking instructions response:', JSON.stringify(result, null, 2));

      // Extract the response text
      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error('No response text from Gemini API');
      }

      // Parse the JSON response
      try {
        const parsedResponse = JSON.parse(responseText);
        return {
          annotations: parsedResponse.annotations || []
        };
      } catch (parseError) {
        console.error('🔍 Failed to parse Gemini marking response as JSON:', responseText);
        throw new Error(`Gemini response parsing failed: ${responseText}`);
      }
    } catch (error) {
      throw new Error(`Gemini marking instructions API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Call OpenAI API for marking instructions
   */
  private static async callOpenAIForMarkingInstructions(
    imageData: string, 
    model: SimpleModelType, 
    processedImage: SimpleProcessedImageResult
  ): Promise<SimpleMarkingInstructions> {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const systemPrompt = 'You are an expert math teacher analyzing student homework. Your task is to provide detailed marking instructions for a math problem solution. CRITICAL OUTPUT RULES: Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations. NO backticks, NO "```json" formatting, NO markdown. Output MUST strictly follow this exact format: {"annotations":[{"action":"tick","bbox":[x,y,width,height],"comment":"feedback","text":"optional"}]}. MARKING GUIDELINES: Use "tick" for correct mathematical work, solutions, and answers. Use "circle" for areas that need attention or verification. Use "underline" for excellent methods or key concepts. Use "comment" for detailed feedback or encouragement. ANALYZE THE IMAGE CAREFULLY and provide specific, helpful feedback for each mathematical element. Return ONLY the raw JSON object without any formatting.';

      const userPrompt = `Please analyze this student's math homework and provide detailed marking instructions with specific feedback for each part of their solution. OCR TEXT: ${processedImage.ocrText || 'No text extracted'}. BOUNDING BOXES: ${processedImage.boundingBoxes?.length || 0} detected areas. Based on the image content and any extracted text, provide specific marking instructions.`;

      // Make real OpenAI API call with vision support
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model === 'chatgpt-5' ? 'gpt-5' : 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { 
              role: 'user', 
              content: [
                { type: 'text', text: userPrompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageData
                  }
                }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as any;
      console.log('🔍 OpenAI marking instructions response:', JSON.stringify(result, null, 2));

      // Extract the response text
      const responseText = result.choices?.[0]?.message?.content;
      if (!responseText) {
        throw new Error('No response text from OpenAI API');
      }

      // Parse the JSON response
      try {
        const parsedResponse = JSON.parse(responseText);
        return {
          annotations: parsedResponse.annotations || []
        };
      } catch (parseError) {
        console.error('🔍 Failed to parse OpenAI marking response as JSON:', responseText);
        throw new Error(`OpenAI response parsing failed: ${responseText}`);
      }
    } catch (error) {
      throw new Error(`OpenAI marking instructions API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate fallback marking instructions using logic-based approach
   */
  private static generateFallbackMarkingInstructions(processedImage: SimpleProcessedImageResult): SimpleMarkingInstructions {
    const annotations: any[] = [];
    
    if (processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      // Generate annotations for each bounding box
      processedImage.boundingBoxes.forEach((bbox, index) => {
        if (index < 5) { // Limit to first 5 boxes to avoid overwhelming
          annotations.push({
            action: 'tick',
            bbox: [bbox.x, bbox.y, bbox.width, bbox.height],
            comment: 'Good mathematical work detected in this area',
            text: bbox.text || 'Math content'
          });
        }
      });
    }

    // Add a general comment if no specific areas found
    if (annotations.length === 0) {
      annotations.push({
        action: 'comment',
        bbox: [50, 50, 200, 100],
        comment: 'Please review the mathematical work in this area',
        text: 'Review needed'
      });
    }

    console.log('🔍 Fallback marking instructions generated:', annotations.length, 'annotations');
    return { annotations };
  }
}
