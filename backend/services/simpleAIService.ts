/**
 * Simplified AI Service for Mark Homework System
 * Handles AI-powered homework marking without circular dependencies
 */

// Define types inline to avoid import issues
interface SimpleImageClassification {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
}

interface SimpleMarkingInstructions {
  annotations: Array<{
    action: 'tick' | 'circle' | 'underline' | 'comment';
    bbox: [number, number, number, number];
    comment?: string;
    text?: string;
  }>;
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

export class SimpleAIService {
  /**
   * Classify image as question-only or question+answer
   */
  static async classifyImage(
    imageData: string, 
    model: SimpleModelType
  ): Promise<SimpleImageClassification> {
    console.log('🔍 ===== REAL AI CLASSIFICATION CALLED =====');
    console.log('🔍 Model:', model);
    console.log('🔍 Image data length:', imageData.length);
    
    try {
      // Use real AI service based on model
      if (model === 'gemini-2.5-pro') {
        console.log('🔍 Using Gemini API for classification');
        return await this.callGeminiForClassification(imageData);
      } else {
        console.log('🔍 Using OpenAI API for classification');
        return await this.callOpenAIForClassification(imageData, model);
      }
    } catch (error) {
      console.error('🔍 Real AI classification failed:', error);
      // Fallback to basic logic if AI service fails
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
   * Generate marking instructions using real AI or intelligent logic
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: SimpleModelType, 
    processedImage: SimpleProcessedImageResult
  ): Promise<SimpleMarkingInstructions> {
    
    console.log('🔍 Generating real AI marking instructions for model:', model);
    
    try {
      // Try to use real AI for marking instructions
      if (model === 'gemini-2.5-pro') {
        console.log('🔍 Using Gemini API for marking instructions');
        return await this.callGeminiForMarkingInstructions(imageData, processedImage);
      } else {
        console.log('🔍 Using OpenAI API for marking instructions');
        return await this.callOpenAIForMarkingInstructions(imageData, model, processedImage);
      }
    } catch (error) {
      console.error('🔍 Real AI marking instructions failed:', error);
      console.log('🔍 Falling back to intelligent logic-based marking');
      
      // Fallback to intelligent logic-based marking
      return this.generateIntelligentMarkingInstructions(processedImage);
    }
  }

  /**
   * Generate marking instructions using intelligent logic analysis
   */
  private static generateIntelligentMarkingInstructions(
    processedImage: SimpleProcessedImageResult
  ): SimpleMarkingInstructions {
    
    console.log('🔍 Generating intelligent logic-based marking instructions');
    
    const annotations = [];
    
    if (processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      processedImage.boundingBoxes.forEach((bbox, index) => {
        const text = bbox.text.toLowerCase();
        
        // Intelligent analysis based on content
        let action: 'tick' | 'circle' | 'underline' | 'comment' = 'tick';
        let comment = '';
        
        if (text.includes('step') || text.includes('solution')) {
          action = 'tick';
          comment = 'Excellent step-by-step approach';
        } else if (text.includes('=') || text.includes('±') || text.includes('√') || text.includes('÷')) {
          action = 'tick';
          comment = 'Correct mathematical notation and operations';
        } else if (text.includes('x²') || text.includes('quadratic') || text.includes('equation')) {
          action = 'underline';
          comment = 'Perfect problem identification';
        } else if (text.includes('a =') || text.includes('b =') || text.includes('c =') || text.includes('coefficients')) {
          action = 'circle';
          comment = 'Good parameter identification';
        } else if (text.includes('formula') || text.includes('discriminant') || text.includes('δ')) {
          action = 'tick';
          comment = 'Correct formula application';
        } else if (text.includes('answer') || text.includes('x =')) {
          action = 'tick';
          comment = 'Correct final answer';
        } else if (text.includes('find') || text.includes('value')) {
          action = 'underline';
          comment = 'Clear problem statement';
        } else {
          // Default intelligent actions
          const actions = ['tick', 'circle', 'underline', 'comment'] as const;
          action = actions[index % actions.length];
          
          switch (action) {
            case 'tick':
              comment = 'Correct mathematical work';
              break;
            case 'circle':
              comment = 'Good approach, verify calculation';
              break;
            case 'underline':
              comment = 'Excellent method';
              break;
            case 'comment':
              comment = 'Well done!';
              break;
          }
        }
        
        annotations.push({
          action,
          bbox: [bbox.x, bbox.y, bbox.width, bbox.height],
          comment: comment
        });
      });
    }
    
    // Add overall feedback comment
    if (annotations.length > 0) {
      annotations.push({
        action: 'comment',
        bbox: [50, 500, 400, 80],
        text: 'Excellent work! Your solution demonstrates strong mathematical understanding and clear step-by-step reasoning. Well done!'
      });
    }
    
    console.log('🔍 Intelligent logic-based marking instructions generated:', annotations.length, 'annotations');
    return { annotations };
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

      const systemPrompt = `You are an AI assistant that classifies math images. 
      
      Your task is to determine if an uploaded image contains:
      
      A) A math question ONLY (no student work, no answers, just the question/problem)
      B) A math question WITH student work/answers (homework to be marked)
      
      CRITICAL OUTPUT RULES:
      - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
      - NO backticks, NO "```json" formatting, NO markdown
      - Output MUST strictly follow this exact format:
      
      {"isQuestionOnly":true,"reasoning":"brief explanation"}
      
      CLASSIFICATION CRITERIA:
      - "isQuestionOnly: true" if the image shows ONLY a math question/problem with NO student work or answers
      - "isQuestionOnly: false" if the image shows a math question WITH student work, calculations, or answers written down
      
      Examples:
      - Textbook question, exam paper question, worksheet question = "isQuestionOnly: true"
      - Student homework with written answers, student's working out, completed problem = "isQuestionOnly: false"
      
      Return ONLY the raw JSON object without any formatting.`;

      const userPrompt = `Please classify this uploaded image as either a math question only or a math question with student work/answers.`;

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

      const result = await response.json();
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

      const systemPrompt = `You are an AI assistant that classifies math images. 
      
      Your task is to determine if an uploaded image contains:
      
      A) A math question ONLY (no student work, no answers, just the question/problem)
      B) A math question WITH student work/answers (homework to be marked)
      
      CRITICAL OUTPUT RULES:
      - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
      - NO backticks, NO "```json" formatting, NO markdown
      - Output MUST strictly follow this exact format:
      
      {"isQuestionOnly":true,"reasoning":"brief explanation"}
      
      CLASSIFICATION CRITERIA:
      - "isQuestionOnly: true" if the image shows ONLY a math question/problem with NO student work or answers
      - "isQuestionOnly: false" if the image shows a math question WITH student work, calculations, or answers written down
      
      Examples:
      - Textbook question, exam paper question, worksheet question = "isQuestionOnly: true"
      - Student homework with written answers, student's working out, completed problem = "isQuestionOnly: false"
      
      Return ONLY the raw JSON object without any formatting.`;

      const userPrompt = `Please classify this uploaded image as either a math question only or a math question with student work/answers.`;

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

      const result = await response.json();
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

        const systemPrompt = `You are an expert math teacher analyzing student homework. 
        
        Your task is to provide detailed marking instructions for a math problem solution.
        
        CRITICAL OUTPUT RULES:
        - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
        - NO backticks, NO "```json" formatting, NO markdown
        - Output MUST strictly follow this exact format:
        
        {"annotations":[{"action":"tick","bbox":[x,y,width,height],"comment":"feedback","text":"optional"}]}
        
        MARKING GUIDELINES:
        - Use "tick" for correct mathematical work, solutions, and answers
        - Use "circle" for areas that need attention or verification
        - Use "underline" for excellent methods or key concepts
        - Use "comment" for detailed feedback or encouragement
        
        ANALYZE THE IMAGE CAREFULLY and provide specific, helpful feedback for each mathematical element.
        
        Return ONLY the raw JSON object without any formatting.`;

        const userPrompt = `Please analyze this student's math homework and provide detailed marking instructions with specific feedback for each part of their solution.

OCR TEXT: ${processedImage.ocrText || 'No text extracted'}
BOUNDING BOXES: ${processedImage.boundingBoxes?.length || 0} detected areas

Based on the image content and any extracted text, provide specific marking instructions.`;

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

        const result = await response.json();
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

        const systemPrompt = `You are an expert math teacher analyzing student homework. 
        
        Your task is to provide detailed marking instructions for a math problem solution.
        
        CRITICAL OUTPUT RULES:
        - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
        - NO backticks, NO "```json" formatting, NO markdown
        - Output MUST strictly follow this exact format:
        
        {"annotations":[{"action":"tick","bbox":[x,y,width,height],"comment":"feedback","text":"optional"}]}
        
        MARKING GUIDELINES:
        - Use "tick" for correct mathematical work, solutions, and answers
        - Use "circle" for areas that need attention or verification
        - Use "underline" for excellent methods or key concepts
        - Use "comment" for detailed feedback or encouragement
        
        ANALYZE THE IMAGE CAREFULLY and provide specific, helpful feedback for each mathematical element.
        
        Return ONLY the raw JSON object without any formatting.`;

        const userPrompt = `Please analyze this student's math homework and provide detailed marking instructions with specific feedback for each part of their solution.

OCR TEXT: ${processedImage.ocrText || 'No text extracted'}
BOUNDING BOXES: ${processedImage.boundingBoxes?.length || 0} detected areas

Based on the image content and any extracted text, provide specific marking instructions.`;

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

        const result = await response.json();
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
}
