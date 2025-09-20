/**
 * AI Marking Service
 * Handles AI-powered homework marking with image classification and annotation generation
 */

import * as path from 'path';

// Define types inline to avoid import issues
interface SimpleImageClassification {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
  extractedQuestionText?: string;
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
  reasoning?: string; // LLM-provided explanation
}

interface SimpleMarkingInstructions {
  annotations: SimpleAnnotation[];
}

// Minimal local types to pass question detection + mark scheme context without importing
interface SimpleMarkingScheme {
  id: string;
  examDetails: {
    board: string;
    qualification: string;
    paperCode: string;
    tier: string;
    paper: string;
    date: string;
  };
  questionMarks?: any;
  totalQuestions: number;
  totalMarks: number;
  confidence?: number;
}

interface SimpleExamPaperMatch {
  board: string;
  qualification: string;
  paperCode: string;
  year: string;
  questionNumber?: string;
  confidence?: number;
  markingScheme?: SimpleMarkingScheme;
}

interface SimpleQuestionDetectionResult {
  found: boolean;
  match?: SimpleExamPaperMatch;
  message?: string;
}

export class AIMarkingService {
  /**
   * Classify image as question-only or question+answer
   */
  static async classifyImage(
    imageData: string, 
    model: SimpleModelType
  ): Promise<SimpleImageClassification> {
    const { ClassificationService } = await import('./ai/ClassificationService');
    return ClassificationService.classifyImage(imageData, model);
  }

  // Legacy per-line annotation generation removed

  // Legacy per-line coordinate calculation removed


  /**
   * NEW LLM2: Generate marking annotations based on final OCR text only (no coordinates)
   */
  static async generateMarkingAnnotationsFromText(
    model: SimpleModelType,
    ocrText: string,
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<{
    annotations: string; // Raw AI response as string
  }> {
    const { MarkingInstructionService } = await import('./ai/MarkingInstructionService');
    return MarkingInstructionService.generateFromOCR(model, ocrText, questionDetection);
  }


  /**
   * Generate marking instructions for homework images
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: SimpleModelType, 
    processedImage?: SimpleProcessedImageResult,
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<SimpleMarkingInstructions> {
    const { LLMOrchestrator } = await import('./ai/LLMOrchestrator');
    return LLMOrchestrator.executeMarking({
      imageData,
      model,
      processedImage: processedImage || ({} as SimpleProcessedImageResult),
      questionDetection
    });
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
    
    const compressedImage = await this.compressImage(imageData);
    
    const systemPrompt = isQuestionOnly
      ? `You are an AI tutor helping students with math problems.
      
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
      
      Return a helpful, educational response that guides the student.`
      : `You are an expert math tutor reviewing a student's question AND their attempted answer in an image.
      
      Your task is to:
      - Understand the original question in the image
      - Read the student’s working and answer if present
      - Give targeted, constructive feedback that helps them improve
      - Point out mistakes and explain why they’re mistakes
      - Ask specific follow-up questions that deepen understanding
      - When appropriate, outline the next step rather than giving the final answer
      - Use precise mathematical notation and keep a supportive tone`;

    const userPrompt = isQuestionOnly
      ? `Student message: "${message}"
      
      Please help the student with this math question. Provide guidance, hints, and encouragement.`
      : `Student message: "${message}"
      
      If the image contains student work, base your feedback on their steps. Provide brief, actionable feedback and one or two targeted follow-up questions.`;

    try {
      if (model === 'gemini-2.5-pro') {
        return await this.callGeminiForChatResponse(compressedImage, systemPrompt, userPrompt);
      } else {
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
    } else if (chatHistory.length > 0) {
      contextPrompt = `\n\nPrevious conversation context:\n${chatHistory.slice(-3).map(item => `${item.role}: ${item.content}`).join('\n')}`;
    }

    const userPrompt = `Student message: "${message}"${contextPrompt}
    
    Please provide a helpful response that continues our conversation.`;

    try {
      const { ModelProvider } = await import('./ai/ModelProvider');
      let response;
      if (model === 'gemini-2.5-pro') {
        response = await ModelProvider.callGeminiText(systemPrompt, userPrompt);
      } else {
        response = await ModelProvider.callOpenAIText(systemPrompt, userPrompt, model as any);
      }
      // Extract content from the response object
      return response.content;
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
      const accessToken = await this.getGeminiAccessToken();
      const response = await this.makeGeminiChatRequest(accessToken, imageData, systemPrompt, userPrompt);
      const result = await response.json() as any;
      const content = this.extractGeminiChatContent(result);
      
      return {
        response: content,
        apiUsed: 'Google Gemini 2.0 Flash Exp (Service Account)'
      };
    } catch (error) {
      console.error('❌ Gemini chat response failed:', error);
      throw error;
    }
  }

  private static async getGeminiAccessToken(): Promise<string> {
    const { GoogleAuth } = await import('google-auth-library');
    
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || './intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json';
    
    const auth = new GoogleAuth({
      keyFile,
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/generative-language.retriever'
      ]
    });
    
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    
    if (!accessToken.token) {
      throw new Error('Failed to get access token from service account');
    }
    
    return accessToken.token;
  }

  private static async makeGeminiChatRequest(
    accessToken: string,
    imageData: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<Response> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
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

    return response;
  }

  private static extractGeminiChatContent(result: any): string {
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error('No content in Gemini response');
    }

    return content;
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
                    url: typeof imageData === 'string' ? imageData : String(imageData)
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

  // Text-only response helpers removed; use ModelProvider instead

  /**
   * Compress image data to reduce API payload size
   */
  private static async compressImage(imageData: string): Promise<string> {
    const { ImageUtils } = await import('./ai/ImageUtils');
    return ImageUtils.compressImage(imageData);
  }
}
