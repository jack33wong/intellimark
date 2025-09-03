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
        {"action": "comment", "bbox": [50, 180, 200, 50], "text": "Verify this solution step by step"},
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
    - Provide helpful, constructive feedback without unnecessary prefixes
    
    Return ONLY the JSON object.`;

    let userPrompt = `Here is an uploaded image. Please:

1. Analyze the image content
2. If it's math homework, provide marking annotations with helpful feedback
3. If it's not math homework, provide appropriate feedback

========================================================
`;

    // Add bounding box information to the prompt
    if (processedImage && processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      userPrompt += `\n\nHere is the OCR DETECTION RESULTS for the uploaded image (Only LaTex content are shown) - Use these bounding box positions as reference for annotations:`;
      
      processedImage.boundingBoxes.forEach((bbox: any, index: number) => {
        if (bbox.text && bbox.text.trim()) {
          const confidence = ((bbox.confidence || 0) * 100).toFixed(1);
          
          // Clean and escape the text to prevent JSON parsing issues
          const cleanText = bbox.text.trim()
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');

          if (bbox.x !== undefined && bbox.y !== undefined && bbox.width !== undefined && bbox.height !== undefined) {
            userPrompt += `bbox[${bbox.x},${bbox.y},${bbox.width},${bbox.height}], text: "${cleanText}", confidence: "${confidence}%"\n`;
          } else {
            userPrompt += `text: "${cleanText}", confidence: "${confidence}%"\n`;
          }
        }
      });
      
      userPrompt += `\nUse OCR positions as a guide to avoid overlaps and to find blank spaces for comments.`;
      userPrompt += `\n\nIMAGE DIMENSIONS: ${processedImage.imageDimensions.width}x${processedImage.imageDimensions.height} pixels`;
      userPrompt += `\nIMPORTANT: All annotations must stay within these dimensions.`;
      userPrompt += `\n(x + width) <= ${processedImage.imageDimensions.width}`;
      userPrompt += `\n(y + height) <= ${processedImage.imageDimensions.height}`;
      userPrompt += `\nIf diagrams, graphs, or math symbols are not detected by OCR, estimate their positions and annotate accordingly.`;
    }
    console.log('🔍 ===== CALLING AI MARKING INSTRUCTIONS =====');
    console.log('🔍 System prompt:', systemPrompt);
    console.log('🔍 User prompt:', userPrompt);
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
      const apiKey = process.env['GEMINI_API_KEY'];
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
      const apiKey = process.env['OPENAI_API_KEY'];
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
          ...(model === 'chatgpt-5' ? { max_completion_tokens: 2000 } : { max_tokens: 500 }),
        })
      });

      const result = await response.json() as any;
      
      if (!response.ok) {
        throw new Error(`OpenAI API request failed: ${response.status} ${JSON.stringify(result)}`);
      }
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
      const apiKey = process.env['GEMINI_API_KEY'];
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
      const apiKey = process.env['OPENAI_API_KEY'];
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
          ...(model === 'chatgpt-5' ? { max_completion_tokens: 12000 } : { max_tokens: 8000 }),
        })
      });

      const result = await response.json() as any;
      
      if (!response.ok) {
        throw new Error(`OpenAI marking instructions API call failed: ${response.status} ${JSON.stringify(result)}`);
      }

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
      if (firstBox) {
        annotations.push({
          action: 'comment',
          bbox: [firstBox.x, firstBox.y, firstBox.width, firstBox.height],
          text: 'Please review this work'
        });
      }
    }
    
    return { annotations };
  }

  /**
   * Generate chat response for question-only images
   */
  static async generateChatResponse(
    imageData: string,
    message: string,
    model: SimpleModelType,
    isQuestionOnly: boolean = true
  ): Promise<{ response: string; apiUsed: string }> {
    console.log('🔍 ===== GENERATING CHAT RESPONSE =====');
    console.log('🔍 Model:', model);
    console.log('🔍 Message:', message);
    console.log('🔍 Is question only:', isQuestionOnly);
    
    const compressedImage = await this.compressImage(imageData);
    
    const systemPrompt = `You are an AI tutor helping students with math problems. 
    
    You will receive an image of a math question and a message from the student.
    Your task is to provide helpful, educational responses that guide the student toward understanding.
    
    RESPONSE GUIDELINES:
    - Be encouraging and supportive
    - Break down complex problems into steps
    - Ask guiding questions to help the student think
    - Provide hints rather than direct answers when appropriate
    - Use clear mathematical notation
    - Explain concepts in simple terms
    - Encourage the student to show their work
    
    Return a helpful, educational response that guides the student.`;

    const userPrompt = `Student message: "${message}"
    
    Please help the student with this math question. Provide guidance, hints, and encouragement.`;

    try {
      if (model === 'gemini-2.5-pro') {
        console.log('🔍 Using Gemini for chat response');
        return await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt);
      } else {
        console.log('🔍 Using OpenAI for chat response');
        return await this.callOpenAIForChatResponse(compressedImage, systemPrompt, userPrompt, model);
      }
    } catch (error) {
      console.error('❌ Chat response generation failed:', error);
      return {
        response: 'I apologize, but I encountered an error while processing your question. Please try again or rephrase your question.',
        apiUsed: 'Fallback Response'
      };
    }
  }

  /**
   * Generate context summary from chat history
   */
  static async generateContextSummary(chatHistory: any[]): Promise<string> {
    if (chatHistory.length === 0) {
      return '';
    }

    console.log('🔍 Generating context summary for', chatHistory.length, 'messages');

    const conversationText = chatHistory.map(item => 
      `${item.role}: ${item.content}`
    ).join('\n');

    const summaryPrompt = `Please provide a concise summary of the following conversation. Focus on:
1. The main topic/subject being discussed
2. Key questions asked by the user
3. Important information or solutions provided
4. Current state of the conversation

Keep the summary under 200 words and maintain context for future responses.

Conversation:
${conversationText}

Summary:`;

    try {
      const apiKey = process.env['OPENAI_API_KEY'];
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
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that creates concise conversation summaries. Focus on key points and maintain context for future interactions.'
            },
            {
              role: 'user',
              content: summaryPrompt
            }
          ],
          max_tokens: 300,
          temperature: 0.3
        })
      });

      const result = await response.json() as any;
      
      if (!response.ok) {
        throw new Error(`OpenAI API request failed: ${response.status} ${JSON.stringify(result)}`);
      }

      const summary = result.choices?.[0]?.message?.content?.trim() || '';
      console.log('✅ Context summary generated:', summary.substring(0, 100) + '...');
      return summary;
    } catch (error) {
      console.error('❌ Context summary generation failed:', error);
      return '';
    }
  }

  /**
   * Generate contextual response for text-based conversations
   */
  static async generateContextualResponse(
    message: string,
    chatHistory: any[],
    model: SimpleModelType,
    contextSummary?: string
  ): Promise<string> {
    console.log('🔍 ===== GENERATING CONTEXTUAL RESPONSE =====');
    console.log('🔍 Model:', model);
    console.log('🔍 Message:', message);
    console.log('🔍 Chat history length:', chatHistory.length);
    
    const systemPrompt = `You are an AI tutor helping students with math problems. 
    
    You will receive a message from the student and their chat history for context.
    Provide helpful, educational responses that continue the conversation naturally.
    
    RESPONSE GUIDELINES:
    - Reference previous parts of the conversation when relevant
    - Be encouraging and supportive
    - Ask clarifying questions if needed
    - Provide step-by-step guidance
    - Use clear mathematical notation
    - Keep responses concise but helpful`;

    // Use context summary if available, otherwise fall back to recent messages
    let contextPrompt = '';
    if (contextSummary) {
      contextPrompt = `\n\nPrevious conversation summary:\n${contextSummary}`;
      console.log('🔍 Using context summary for response');
    } else if (chatHistory.length > 0) {
      contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-3).map(item => `${item.role}: ${item.content}`).join('\n')}`;
      console.log('🔍 Using recent messages for context');
    }

    const userPrompt = `Student message: "${message}"${contextPrompt}
    
    Please provide a helpful response that continues our conversation.`;

    try {
      if (model === 'gemini-2.5-pro') {
        console.log('🔍 Using Gemini for contextual response');
        return await this.callGeminiForTextResponse(systemPrompt, userPrompt);
      } else {
        console.log('🔍 Using OpenAI for contextual response');
        return await this.callOpenAIForTextResponse(systemPrompt, userPrompt, model);
      }
    } catch (error) {
      console.error('❌ Contextual response generation failed:', error);
      return 'I apologize, but I encountered an error while processing your message. Please try again.';
    }
  }

  /**
   * Call Gemini API for chat response with image
   */
  private static async callGeminiForChatResponse(
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ response: string; apiUsed: string }> {
    try {
      const apiKey = process.env['GEMINI_API_KEY'];
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
                  data: imageData.split(',')[1]
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.7,
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

      return {
        response: content,
        apiUsed: 'Google Gemini 2.0 Flash Exp'
      };

    } catch (error) {
      console.error('❌ Gemini chat response failed:', error);
      throw error;
    }
  }

  /**
   * Call OpenAI API for chat response with image
   */
  private static async callOpenAIForChatResponse(
    imageData: string,
    systemPrompt: string,
    userPrompt: string,
    model: SimpleModelType
  ): Promise<{ response: string; apiUsed: string }> {
    try {
      const apiKey = process.env['OPENAI_API_KEY'];
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
          ...(model === 'chatgpt-5' ? { max_completion_tokens: 4000 } : { max_tokens: 1000 }),
          //temperature: 0.7
        })
      });

      const result = await response.json() as any;
      
      console.log('🔍 OpenAI Chat API Response for', model, ':', JSON.stringify(result, null, 2));
      
      if (!response.ok) {
        throw new Error(`OpenAI API request failed: ${response.status} ${JSON.stringify(result)}`);
      }
      const content = result.choices?.[0]?.message?.content;
      
      if (!content) {
        console.error('❌ No content in OpenAI chat response. Full response:', JSON.stringify(result, null, 2));
        throw new Error('No content in OpenAI response');
      }

      return {
        response: content,
        apiUsed: model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni'
      };

    } catch (error) {
      console.error('❌ OpenAI chat response failed:', error);
      throw error;
    }
  }

  /**
   * Call Gemini API for text-only response
   */
  private static async callGeminiForTextResponse(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    try {
      const apiKey = process.env['GEMINI_API_KEY'];
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
              { text: userPrompt }
            ]
          }],
          generationConfig: {
            temperature: 0.7,
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

      return content;

    } catch (error) {
      console.error('❌ Gemini text response failed:', error);
      throw error;
    }
  }

  /**
   * Call OpenAI API for text-only response
   */
  private static async callOpenAIForTextResponse(
    systemPrompt: string,
    userPrompt: string,
    model: SimpleModelType
  ): Promise<string> {
    try {
      const apiKey = process.env['OPENAI_API_KEY'];
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
            { role: 'user', content: userPrompt }
          ],
          ...(model === 'chatgpt-5' ? { max_completion_tokens: 1000 } : { max_tokens: 1000 }),
          //temperature: 0.7
        })
      });

      const result = await response.json() as any;
      
      if (!response.ok) {
        throw new Error(`OpenAI API request failed: ${response.status} ${JSON.stringify(result)}`);
      }
      const content = result.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      return content;

    } catch (error) {
      console.error('❌ OpenAI text response failed:', error);
      throw error;
    }
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
