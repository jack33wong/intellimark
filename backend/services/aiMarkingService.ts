/**
 * AI Marking Service
 * Handles AI-powered homework marking with image classification and annotation generation
 */

// Define types inline to avoid import issues
interface SimpleImageClassification {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
}

type SimpleModelType = 'gemini-2.5-pro' | 'chatgpt-5' | 'chatgpt-4o';

interface SimpleProcessedImageResult {
  ocrText: string;
  boundingBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    confidence?: number;
  }>;
  confidence: number;
  imageDimensions: {
    width: number;
    height: number;
  };
  isQuestion?: boolean;
}

interface SimpleAnnotation {
  action: 'circle' | 'write' | 'tick' | 'cross' | 'underline' | 'comment';
  bbox: [number, number, number, number]; // [x, y, width, height]
  comment?: string; // Optional for marking actions
  text?: string; // For comment actions
}

interface SimpleMarkingInstructions {
  annotations: SimpleAnnotation[];
}

export class AIMarkingService {
  /**
   * Classify image as question-only or question+answer
   */
  static async classifyImage(
    imageData: string, 
    model: SimpleModelType
  ): Promise<SimpleImageClassification> {
    console.log('🔍 ===== CLASSIFY IMAGE METHOD CALLED =====');
    console.log('🔍 Model:', model);
    console.log('🔍 Image data length:', imageData.length);
    
    const compressedImage = await this.compressImage(imageData);
    console.log('🔍 Image compressed, length:', compressedImage.length);
    
    const systemPrompt = `You are an AI assistant that classifies math images. 
    
    Your task is to determine if an uploaded image contains:
    
    A) A math question ONLY (no student work, no answers, just the question/problem)
    B) A math question WITH student work/answers (homework to be marked)
    
    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:
    
    {
      "isQuestionOnly": true/false,
      "reasoning": "brief explanation of your classification"
    }
    
    CLASSIFICATION CRITERIA:
    - "isQuestionOnly: true" if the image shows ONLY a math question/problem with NO student work or answers
    - "isQuestionOnly: false" if the image shows a math question WITH student work, calculations, or answers written down
    
    Examples:
    - Textbook question, exam paper question, worksheet question = "isQuestionOnly: true"
    - Student homework with written answers, student's working out, completed problem = "isQuestionOnly: false"
    
    Return ONLY the JSON object.`;

    const userPrompt = `Please classify this uploaded image as either a math question only or a math question with student work/answers.`;

    try {
      console.log('🔍 ===== CALLING AI CLASSIFICATION =====');
      if (model === 'gemini-2.5-pro') {
        console.log('🔍 Using Gemini API');
        return await this.callGeminiForClassification(compressedImage, systemPrompt, userPrompt);
      } else {
        console.log('🔍 Using OpenAI API');
        return await this.callOpenAIForClassification(compressedImage, systemPrompt, userPrompt, model);
      }
    } catch (error) {
      console.error('🔍 Classification failed:', error);
      // Default to false (assume it's homework to be marked) if classification fails
      return { 
        isQuestionOnly: false, 
        reasoning: 'Classification failed, defaulting to homework marking',
        apiUsed: 'Fallback' 
      };
    }
  }

  /**
   * Generate marking instructions for homework images
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: SimpleModelType, 
    processedImage?: SimpleProcessedImageResult
  ): Promise<SimpleMarkingInstructions> {
    const compressedImage = await this.compressImage(imageData);

    const systemPrompt = `You are an AI assistant analyzing images. 
    You will receive an image and your task is to:
    
    1. Analyze the image content using the provided OCR text and bounding box data
    2. Provide marking annotations if it's math homework, or general feedback if not
    
    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow the format shown below
    - Use the provided OCR text to understand exactly what the student has written
    - Use bounding box positions to place annotations accurately without overlapping text
    
    ==================== EXAMPLE OUTPUT ====================
    
    Math Homework Example:
    {
      "annotations": [
        {"action": "tick", "bbox": [50, 80, 200, 150]},
        {"action": "comment", "bbox": [50, 180, 200, 50], "text": "Correct solution"},
      ]
    }
    
    ==================== OUTPUT FORMAT ====================
    
    {
      "annotations": [
        {
          "action": "tick|cross|circle|underline|comment",
          "bbox": [x, y, width, height],
          "text": "comment text (only for comment action)"
        }
      ]
    }
    
    ANNOTATION RULES:
    - Use "tick" for correct answers
    - Use "cross" for incorrect answers  
    - Use "circle" to highlight important parts
    - Use "underline" to emphasize key concepts
    - Use "comment" to provide feedback or explanations
    - Position bbox coordinates to avoid overlapping with existing text
    - Keep comments concise and helpful
    
    Return ONLY the JSON object.`;

    const userPrompt = `Please analyze this image and provide marking annotations. 
    
    OCR TEXT: ${processedImage?.ocrText || 'No OCR text available'}
    BOUNDING BOXES: ${processedImage?.boundingBoxes ? JSON.stringify(processedImage.boundingBoxes) : 'No bounding boxes available'}
    
    Generate appropriate marking annotations based on the content.`;

    try {
      if (model === 'gemini-2.5-pro') {
        return await this.callGeminiForMarkingInstructions(compressedImage, systemPrompt, userPrompt);
      } else {
        return await this.callOpenAIForMarkingInstructions(compressedImage, systemPrompt, userPrompt, model);
      }
    } catch (error) {
      console.error('❌ AI marking instructions failed:', error);
      // Fallback to basic marking if AI fails
      return this.generateFallbackMarkingInstructions(processedImage);
    }
  }

  /**
   * Call Gemini API for image classification
   */
  private static async callGeminiForClassification(
    imageData: string, 
    systemPrompt: string, 
    userPrompt: string
  ): Promise<SimpleImageClassification> {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
      }

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
                  data: imageData.split(',')[1] // Remove data:image/jpeg;base64, prefix
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1000,
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;
      const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!content) {
        throw new Error('No content in Gemini response');
      }

      // Parse JSON response
      const parsed = JSON.parse(content);
      return {
        isQuestionOnly: parsed.isQuestionOnly,
        reasoning: parsed.reasoning,
        apiUsed: 'Google Gemini 2.0 Flash Exp'
      };

    } catch (error) {
      console.error('❌ Gemini classification failed:', error);
      throw error;
    }
  }

  /**
   * Call OpenAI API for image classification
   */
  private static async callOpenAIForClassification(
    imageData: string, 
    systemPrompt: string, 
    userPrompt: string, 
    model: SimpleModelType
  ): Promise<SimpleImageClassification> {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
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
      const content = result.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      // Parse JSON response
      const parsed = JSON.parse(content);
      return {
        isQuestionOnly: parsed.isQuestionOnly,
        reasoning: parsed.reasoning,
        apiUsed: model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni'
      };

    } catch (error) {
      console.error('❌ OpenAI classification failed:', error);
      throw error;
    }
  }

  /**
   * Call Gemini API for marking instructions
   */
  private static async callGeminiForMarkingInstructions(
    imageData: string, 
    systemPrompt: string, 
    userPrompt: string
  ): Promise<SimpleMarkingInstructions> {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
      }

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
                  data: imageData.split(',')[1] // Remove data:image/jpeg;base64, prefix
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2000,
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;
      const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!content) {
        throw new Error('No content in Gemini response');
      }

      // Parse JSON response
      const parsed = JSON.parse(content);
      return {
        annotations: parsed.annotations || []
      };

    } catch (error) {
      console.error('❌ Gemini marking instructions failed:', error);
      throw error;
    }
  }

  /**
   * Call OpenAI API for marking instructions
   */
  private static async callOpenAIForMarkingInstructions(
    imageData: string, 
    systemPrompt: string, 
    userPrompt: string, 
    model: SimpleModelType
  ): Promise<SimpleMarkingInstructions> {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
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
        throw new Error(`OpenAI marking instructions API call failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as any;
      const content = result.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      // Parse JSON response
      const parsed = JSON.parse(content);
      return {
        annotations: parsed.annotations || []
      };

    } catch (error) {
      console.error('❌ OpenAI marking instructions failed:', error);
      throw error;
    }
  }

  /**
   * Generate fallback marking instructions when AI fails
   */
  private static generateFallbackMarkingInstructions(
    processedImage?: SimpleProcessedImageResult
  ): SimpleMarkingInstructions {
    const annotations: SimpleAnnotation[] = [];
    
    if (processedImage?.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      // Add a simple comment annotation
      const firstBox = processedImage.boundingBoxes[0];
      annotations.push({
        action: 'comment',
        bbox: [firstBox.x, firstBox.y, firstBox.width, firstBox.height],
        text: 'Please review this work'
      });
    }
    
    return { annotations };
  }

  /**
   * Compress image data to reduce API payload size
   */
  private static async compressImage(imageData: string): Promise<string> {
    // For now, return the original image data
    // In a production environment, you might want to implement actual image compression
    return imageData;
  }
}
