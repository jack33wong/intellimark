/**
 * AI Marking Service
 * Handles AI-powered homework marking with image classification and annotation generation
 */

import { 
  MarkingInstructions, 
  ImageClassification, 
  ModelType,
  ProcessedImageResult 
} from '../types';
import { getModelConfig } from '../config/aiModels';

export class AIMarkingService {
  /**
   * Classify image as question-only or question+answer
   */
  static async classifyImage(
    imageData: string, 
    model: ModelType
  ): Promise<ImageClassification> {
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
   * Generate chat response for question-only images with fallback logic
   */
  static async generateChatResponse(
    imageData: string, 
    message: string, 
    model: ModelType,
    isInitialQuestion: boolean = false
  ): Promise<{ response: string; apiUsed: string }> {
    console.log('🔍 ===== GENERATING CHAT RESPONSE =====');
    console.log('🔍 Message:', message);
    console.log('🔍 Model:', model);
    console.log('🔍 Is Initial Question:', isInitialQuestion);
    
    const compressedImage = await this.compressImage(imageData);
    
    // Enhanced prompts based on whether it's the initial question or follow-up
    const systemPrompt = isInitialQuestion 
      ? `You are a helpful GCSE Maths tutor. When a student uploads a math question image, provide a clear, step-by-step explanation of how to solve it. Be encouraging and explain each step thoroughly. Use LaTeX for mathematical expressions when appropriate.`
      : `You are a helpful GCSE Maths tutor. Continue helping the student with their math question. Provide clear explanations, step-by-step solutions, and encouragement. Use LaTeX for mathematical expressions when appropriate.`;

    const userPrompt = isInitialQuestion 
      ? `I've uploaded a photo of a math question. Please analyze the image and provide a step-by-step explanation of how to solve this problem.`
      : message || 'Please continue helping me with this math question.';

    let reply: string | null = null;
    let apiUsed = '';

    try {
      // Try the user's preferred model first
      if (model === 'chatgpt-5' || model === 'chatgpt-4o') {
        try {
          console.log('🔍 Trying OpenAI first...');
          reply = await this.callOpenAIForChat(compressedImage, systemPrompt, userPrompt, model);
          apiUsed = model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni';
        } catch (chatgptError) {
          console.error('🔍 ChatGPT failed with error:', chatgptError);
          console.error('🔍 Error details:', {
            message: chatgptError instanceof Error ? chatgptError.message : 'Unknown error',
            stack: chatgptError instanceof Error ? chatgptError.stack : 'No stack trace',
            model: model
          });
          console.log('🔍 ChatGPT failed, trying Gemini...');
          reply = await this.callGeminiForChat(compressedImage, systemPrompt, userPrompt);
          apiUsed = 'Google Gemini 2.0 Flash Exp';
        }
      } else {
        // Default to Gemini
        try {
          console.log('🔍 Trying Gemini first...');
          reply = await this.callGeminiForChat(compressedImage, systemPrompt, userPrompt);
          apiUsed = 'Google Gemini 2.0 Flash Exp';
        } catch (geminiError) {
          console.error('🔍 Gemini failed with error:', geminiError);
          console.error('🔍 Error details:', {
            message: geminiError instanceof Error ? geminiError.message : 'Unknown error',
            stack: geminiError instanceof Error ? geminiError.stack : 'No stack trace'
          });
          console.log('🔍 Gemini failed, trying ChatGPT...');
          reply = await this.callOpenAIForChat(compressedImage, systemPrompt, userPrompt, 'chatgpt-4o');
          apiUsed = 'OpenAI GPT-4 Omni';
        }
      }
    } catch (error) {
      console.error('🔍 All AI services failed:', error);
      reply = `I'm having trouble analyzing the image right now. Could you please describe the math question you're working on, and I'll be happy to help you solve it step by step!`;
      apiUsed = 'Fallback Response';
    }

    return { response: reply, apiUsed };
  }

  /**
   * Generate marking instructions for homework images
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: ModelType, 
    processedImage?: ProcessedImageResult
  ): Promise<MarkingInstructions> {
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
    
    Non-Math Example:
    {
      "annotations": [
        {"action": "write", "bbox": [50, 50, 400, 100], "comment": "This is a computer screenshot. Please upload a photo of math homework instead."}
      ]
    }
    
    ========================================================
    
    AVAILABLE ACTIONS: write, tick, cross, underline, comment
    
    IMPORTANT FORMAT & PLACEMENT RULES:
    1. Marking actions (tick, cross, underline):
       - Include ONLY {action, bbox}
       - Mark every line of working, not just the last line
       - Size must match the content being marked (no oversized marks)
       - Marking action should place at the exact positon you are marking (marking may overlap with the original text)
       - Comments may be place in conjunction with marking actions, but MUST FOLLOW the rules below
    
    2. Comment actions:
       - Must use {"action": "comment", "bbox": [...], "text": "..."}
       - Comments must appear in **blank space between lines of work**
       - DO NOT place comments adjacent to or overlapping student text
       
    
    3. Write actions:
       - May include {"action": "write", "bbox": [...], "comment": "..."}
       - Used for overall feedback
    
    4. IMAGE BOUNDARY CONSTRAINTS:
       - Every annotation bbox must satisfy:
         - x >= 0, y >= 0
         - (x + width) <= IMAGE_WIDTH
         - (y + height) <= IMAGE_HEIGHT
       - If placement would exceed boundary, shrink or reposition the bbox BEFORE returning
    
    5. COMMENT SPACING RULES:
       - Leave at least 20px padding between comments and existing text bboxes
       - Leave at least 20px padding between two comment bboxes
       - If no safe space is available inside the image, place the comment at the bottom inside the image with reduced height
       - Insert line breaks when comments is too long

    6. FINAL CHECK BEFORE OUTPUT:
       - Ensure no bbox exceeds the image boundary
       - Ensure no bbox overlaps OCR-detected text
       - Ensure comments are clearly readable in blank areas only
       - If uncertain, place comments lower in the image (stacked at bottom), not at edges
    
    Bounding box format: [x, y, width, height]  
    where (x, y) is top-left corner and you can control the size of marking using (width, height)
    
    Return ONLY the JSON object.`;

    let userPrompt = `Here is an uploaded image. Please:

1. Analyze the image content
2. If it's math homework, provide marking annotations
3. If it's not math homework, provide appropriate feedback

========================================================
`;
    console.log('🔍 ===== PROCESSING HOMEWORK =====');
    console.log('🔍 OCR Text:', processedImage?.ocrText);
    console.log('🔍 Bounding Boxes:', processedImage);
    // Add full OCR text to give AI complete context
    if (processedImage && processedImage.ocrText && processedImage.ocrText.trim()) {
      userPrompt += `\n\nFULL OCR EXTRACTED TEXT from the image:
"${processedImage.ocrText.trim().replace(/"/g, '\\"').replace(/\n/g, '\\n')}"

This is the complete text content detected in the image. Use this to understand what the student has written and what needs to be marked.
========================================================
`;
    }

    // Add bounding box information to the prompt
    if (processedImage && processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      userPrompt += `\n\nHere is the OCR DETECTION RESULTS for the uploaded image (Only LaTex content are shown) - Use these bounding box positions as reference for annotations:`;
      
      processedImage.boundingBoxes.forEach((bbox: any) => {
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
    userPrompt += `\nUse the full OCR text to understand the student's work and provide accurate marking feedback.`;
      userPrompt += `\n\nIMAGE DIMENSIONS: ${processedImage.imageDimensions.width}x${processedImage.imageDimensions.height} pixels`;
      userPrompt += `\nIMPORTANT: All annotations must stay within these dimensions.`;
      userPrompt += `\n(x + width) <= ${processedImage.imageDimensions.width}`;
      userPrompt += `\n(y + height) <= ${processedImage.imageDimensions.height}`;
      userPrompt += `\nIf diagrams, graphs, or math symbols are not detected by OCR, estimate their positions and annotate accordingly.`;
    }
    
    console.log('🔍 Generating marking instructions with prompt:', systemPrompt + userPrompt);
    
    if (model === 'gemini-2.5-pro') {
      return await this.callGeminiForMarking(compressedImage, systemPrompt, userPrompt);
    } else {
      return await this.callOpenAIForMarking(compressedImage, systemPrompt, userPrompt, model);
    }
  }

  /**
   * Call OpenAI API for image classification
   */
  private static async callOpenAIForClassification(
    imageUrl: string, 
    systemPrompt: string, 
    userPrompt: string, 
    model: ModelType
  ): Promise<ImageClassification> {
    console.log('🔍 ===== OPENAI CLASSIFICATION METHOD CALLED =====');
    console.log('🔍 Model:', model);
    
    const openaiApiKey = process.env['OPENAI_API_KEY'];
    
    if (!openaiApiKey) {
      console.error('🔍 OpenAI API key not configured');
      throw new Error('OpenAI API key not configured');
    }
    console.log('🔍 OpenAI API key found');

    const modelConfig = getModelConfig(model);
    const openaiModel = modelConfig.model || 'gpt-4o';
    console.log('🔍 OpenAI model:', openaiModel);

    const requestBody: any = {
      model: openaiModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    };

    // Use the correct parameter name based on the model
    if (openaiModel === 'gpt-5') {
      requestBody.max_completion_tokens = 500;
    } else {
      requestBody.max_tokens = 500;
    }
    console.log('🔍 ===== CLASSIFICATION START =====');
    console.log('🔍 Sending request to OpenAI...');
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('🔍 OpenAI response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json() as any;
      console.error('🔍 OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error('🔍 OpenAI API returned no content');
      throw new Error('OpenAI API returned no content');
    }

    console.log('🔍 OpenAI response content length:', content.length);

    try {
      const result = JSON.parse(content);
      console.log("🔍 OpenAI Classification Response:", result.isQuestionOnly);
      return { 
        isQuestionOnly: result.isQuestionOnly || false,
        reasoning: result.reasoning || 'No reasoning provided',
        apiUsed: model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni'
      };
    } catch (parseError) {
      console.error('🔍 Failed to parse classification response:', parseError);
      return { 
        isQuestionOnly: false, 
        reasoning: 'Failed to parse AI response',
        apiUsed: model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni' 
      };
    }
  }

  /**
   * Call Gemini API for image classification
   */
  private static async callGeminiForClassification(
    imageUrl: string, 
    systemPrompt: string, 
    userPrompt: string
  ): Promise<ImageClassification> {
    const geminiApiKey = process.env['GEMINI_API_KEY'];
    
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured');
    }

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}\n\n${userPrompt}`
            },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: imageUrl.replace('data:image/jpeg;base64,', '')
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 500,
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      throw new Error('Gemini API returned no content');
    }

    try {
      const result = JSON.parse(content);
      return { 
        isQuestionOnly: result.isQuestionOnly || false,
        reasoning: result.reasoning || 'No reasoning provided',
        apiUsed: 'Google Gemini 2.0 Flash Exp'
      };
    } catch (parseError) {
      console.error('Failed to parse classification response:', parseError);
      return { 
        isQuestionOnly: false, 
        reasoning: 'Failed to parse AI response',
        apiUsed: 'Google Gemini 2.0 Flash Exp' 
      };
    }
  }

  /**
   * Call Gemini API for chat response
   */
  private static async callGeminiForChat(
    imageUrl: string, 
    systemPrompt: string, 
    userPrompt: string
  ): Promise<string> {
    console.log('🔍 ===== GEMINI CHAT METHOD CALLED =====');
    
    const geminiApiKey = process.env['GEMINI_API_KEY'];
    
    if (!geminiApiKey) {
      console.error('🔍 Gemini API key not configured');
      throw new Error('Gemini API key not configured');
    }
    console.log('🔍 Gemini API key found');

    const modelConfig = getModelConfig('gemini-2.5-pro');
    const geminiModel = modelConfig.model || 'gemini-2.0-flash-exp';
    console.log('🔍 Gemini model:', geminiModel);

    const requestBody = {
      contents: [{
        parts: [
          { text: systemPrompt },
          { text: userPrompt },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: imageUrl.split(',')[1] // Extract base64 data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: modelConfig.maxTokens || 2048,
        topP: 0.8,
        topK: 40
      }
    };

    console.log('🔍 Sending request to Gemini API...');
    console.log('🔍 Gemini request details:', {
      model: geminiModel,
      maxOutputTokens: modelConfig.maxTokens || 2048,
      temperature: 0.7,
      imageDataLength: imageUrl.length
    });
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as any;
      console.error('🔍 Gemini API error response:', {
        status: response.status,
        statusText: response.statusText,
        errorData: errorData
      });
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorData.error || 'Unknown error'}`);
    }

    const result = await response.json() as any;
    console.log('🔍 Gemini API response received');
    
    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
      const responseText = result.candidates[0].content.parts[0].text;
      console.log('🔍 Gemini chat response generated successfully');
      return responseText;
    } else {
      throw new Error('Invalid response format from Gemini API');
    }
  }

  /**
   * Call OpenAI API for chat response
   */
  private static async callOpenAIForChat(
    imageUrl: string, 
    systemPrompt: string, 
    userPrompt: string, 
    model: ModelType
  ): Promise<string> {
    console.log('🔍 ===== OPENAI CHAT METHOD CALLED =====');
    console.log('🔍 Model:', model);
    
    const openaiApiKey = process.env['OPENAI_API_KEY'];
    
    if (!openaiApiKey) {
      console.error('🔍 OpenAI API key not configured');
      throw new Error('OpenAI API key not configured');
    }
    console.log('🔍 OpenAI API key found');

    const modelConfig = getModelConfig(model);
    const openaiModel = modelConfig.model || 'gpt-4o';
    console.log('🔍 OpenAI model:', openaiModel);

    const requestBody: any = {
      model: openaiModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      temperature: 0.7,
    };

    // Use the correct parameter name based on the model
    if (openaiModel === 'gpt-5') {
      requestBody.max_completion_tokens = modelConfig.maxTokens || 2048;
    } else {
      requestBody.max_tokens = modelConfig.maxTokens || 2048;
    }

    console.log('🔍 Sending request to OpenAI API...');
    console.log('🔍 OpenAI request details:', {
      model: openaiModel,
      maxTokens: openaiModel === 'gpt-5' ? 'max_completion_tokens' : 'max_tokens',
      tokenValue: modelConfig.maxTokens || 2048,
      temperature: 0.7,
      messageCount: 2,
      imageDataLength: imageUrl.length
    });
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as any;
      console.error('🔍 OpenAI API error response:', {
        status: response.status,
        statusText: response.statusText,
        errorData: errorData
      });
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const result = await response.json() as any;
    console.log('🔍 OpenAI API response received');
    
    if (result.choices && result.choices[0] && result.choices[0].message) {
      const responseText = result.choices[0].message.content;
      console.log('🔍 OpenAI chat response generated successfully');
      return responseText;
    } else {
      throw new Error('Invalid response format from OpenAI API');
    }
  }

  /**
   * Call OpenAI API for marking instructions
   */
  private static async callOpenAIForMarking(
    imageUrl: string, 
    systemPrompt: string, 
    userPrompt: string, 
    model: ModelType
  ): Promise<MarkingInstructions> {
    const openaiApiKey = process.env['OPENAI_API_KEY'];
    
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const modelConfig = getModelConfig(model);
    const openaiModel = modelConfig.model || 'gpt-4o';

    console.log('🔍 OpenAI API Request - Model Selection:', { 
      userSelectedModel: model, 
      openaiModel: openaiModel,
      isChatGPT: true
    });
    
    const requestBody: any = {
      model: openaiModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    };

    // Use the correct parameter name based on the model
    if (openaiModel === 'gpt-5') {
      requestBody.max_completion_tokens = 8000;
    } else {
      requestBody.max_tokens = 8000;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json() as any;
      
      if (errorData.error?.code === 'invalid_api_key') {
        throw new Error('Invalid OpenAI API key. Please check your API key configuration.');
      } else if (errorData.error?.message) {
        throw new Error(`OpenAI API error: ${errorData.error.message}`);
      } else {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('OpenAI API returned no content');
    }

    console.log('🔍 Raw AI Response:', content.substring(0, 500) + '...');
    
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      const extractedJson = jsonMatch[1];
      console.log('🔍 Extracted JSON from markdown:', extractedJson.substring(0, 300) + '...');
      try {
        return JSON.parse(extractedJson);
      } catch (parseError) {
        console.error('🔍 JSON Parse Error (extracted):', parseError);
        console.error('🔍 Problematic JSON:', extractedJson);
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        throw new Error(`Failed to parse AI response JSON: ${errorMessage}`);
      }
    }
    
    console.log('🔍 Attempting to parse raw content as JSON...');
    try {
      return JSON.parse(content);
    } catch (parseError) {
      console.error('🔍 JSON Parse Error (raw):', parseError);
      console.error('🔍 Problematic content:', content.substring(0, 500));
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse AI response JSON: ${errorMessage}`);
    }
  }

  /**
   * Call Gemini API for marking instructions
   */
  private static async callGeminiForMarking(
    imageUrl: string, 
    systemPrompt: string, 
    userPrompt: string
  ): Promise<MarkingInstructions> {
    const geminiApiKey = process.env['GEMINI_API_KEY'];
    
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured');
    }

    console.log('🔍 Gemini API Request - Model Selection:', { 
      userSelectedModel: 'gemini', 
      geminiModel: 'gemini-2.0-flash-exp',
      isGemini: true
    });

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}\n\n${userPrompt}`
            },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: imageUrl.replace('data:image/jpeg;base64,', '')
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 8000,
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error('Gemini API error:', response.status, response.statusText);
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      throw new Error('Gemini API returned no content');
    }

    console.log('🔍 Raw Gemini Response:', content.substring(0, 500) + '...');
    
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      const extractedJson = jsonMatch[1];
      console.log('🔍 Extracted JSON from markdown:', extractedJson.substring(0, 300) + '...');
      try {
        return JSON.parse(extractedJson);
      } catch (parseError) {
        console.error('🔍 JSON Parse Error (extracted):', parseError);
        console.error('🔍 Problematic JSON:', extractedJson);
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        throw new Error(`Failed to parse Gemini response JSON: ${errorMessage}`);
      }
    }
    
    console.log('🔍 Attempting to parse raw content as JSON...');
    try {
      return JSON.parse(content);
    } catch (parseError) {
      console.error('🔍 JSON Parse Error (raw):', parseError);
      console.error('🔍 Problematic content:', content.substring(0, 500));
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse Gemini response JSON: ${errorMessage}`);
    }
  }

  /**
   * Compress image for API calls
   */
  private static async compressImage(imageData: string): Promise<string> {
    if (!imageData || typeof imageData !== 'string') {
      throw new Error('Invalid image data format');
    }

    if (!imageData.startsWith('data:image/')) {
      throw new Error('Invalid image data URL format');
    }

    const match = imageData.match(/^data:image\/([a-z]+);base64,(.+)$/i);
    if (!match) {
      throw new Error('Failed to parse image data URL');
    }

    const [, , base64Data] = match;
    
    if (!base64Data || base64Data === 'test') {
      throw new Error('Invalid base64 image data');
    }

    if (base64Data.length < 50) {
      throw new Error('Image data too small');
    }

    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64Data)) {
      throw new Error('Invalid base64 format');
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    if (imageBuffer.length === 0) {
      throw new Error('Failed to create image buffer');
    }

    if (imageBuffer.length < 100) {
      return imageData;
    }

    // For now, return the original image data
    // In a full implementation, you would use Sharp to compress
    return imageData;
  }
}
