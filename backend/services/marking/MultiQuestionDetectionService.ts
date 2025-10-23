/**
 * Multi-Question Detection Service
 * 
 * This service uses external AI APIs to detect multiple questions in OCR results
 * and segment student work by question boundaries.
 * 
 * Features:
 * - External AI API integration (Gemini)
 * - Multi-question detection and segmentation
 * - Simple error handling
 */

import { ModelProvider } from '../../utils/ModelProvider.js';
import { getPrompt } from '../../config/prompts.js';
import { ModelType } from '../../types/index.js';

// Types for multi-question detection
export interface MathBlock {
  id: string;
  text: string;
  mathpixLatex?: string;
  googleVisionText?: string;
  confidence: number;
  mathpixConfidence?: number;
  mathLikenessScore: number;
  coordinates: { x: number; y: number; width: number; height: number };
  suspicious?: boolean;
  pageIndex?: number;
  globalBlockId?: string;
  isHandwritten?: boolean;
}

export interface QuestionSegment {
  questionNumber: string;
  questionText: string;
  startBlockIndex: number;
  endBlockIndex: number;
  confidence: number;
  sourcePages: number[];
}

export interface TextSegment {
  text: string;
  type: 'question_text' | 'student_work';
  confidence: number;
}

export interface MultiQuestionDetectionResult {
  success: boolean;
  segments: TextSegment[];
  totalSegments: number;
  processingTimeMs: number;
  error?: string;
}

export interface MultiQuestionDetectionOptions {
  model?: ModelType;
  debug?: boolean;
}

export class MultiQuestionDetectionService {
  private static readonly DEFAULT_OPTIONS: MultiQuestionDetectionOptions = {
    model: 'auto',
    debug: false
  };

  /**
   * Detect multiple questions in OCR results
   * 
   * @param mathBlocks - Array of OCR math blocks
   * @param questionText - Extracted question text for context
   * @param options - Configuration options
   * @returns Multi-question detection result
   */
  static async detectMultipleQuestions(
    mathBlocks: MathBlock[],
    questionText?: string,
    options: MultiQuestionDetectionOptions = {}
  ): Promise<MultiQuestionDetectionResult> {
    const startTime = Date.now();
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    try {
      // Validate input
      if (!mathBlocks || mathBlocks.length === 0) {
        throw new Error('No math blocks provided');
      }

      if (opts.debug) {
        console.log(`🔍 [MULTI-Q DETECTION] Starting detection for ${mathBlocks.length} blocks`);
        console.log(`🔍 [MULTI-Q DETECTION] Question text: ${questionText ? `"${questionText.substring(0, 100)}..."` : 'None'}`);
      }

      // Prepare input for AI API
      const inputBlocks = this.prepareBlocksForAI(mathBlocks);
      
      // Call external AI API
      const aiResponse = await this.callExternalAI(inputBlocks, questionText, opts.model!);
      
      // Parse AI response
      const segments = this.parseAIResponse(aiResponse);
      
      if (opts.debug) {
        console.log(`✅ [MULTI-Q DETECTION] Detected ${segments.length} segments`);
        segments.forEach((s, i) => {
          console.log(`  Segment ${i + 1}: ${s.type} (confidence: ${s.confidence.toFixed(2)}) - "${s.text.substring(0, 50)}..."`);
        });
      }

      return {
        success: true,
        segments: segments,
        totalSegments: segments.length,
        processingTimeMs: Date.now() - startTime
      };

    } catch (error) {
      console.error('❌ [MULTI-Q DETECTION] Error:', error);
      
      return {
        success: false,
        segments: [],
        totalSegments: 0,
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Prepare math blocks for AI API input
   */
  private static prepareBlocksForAI(mathBlocks: MathBlock[]): any[] {
    return mathBlocks.map((block, index) => ({
      id: index,
      text: block.mathpixLatex || block.googleVisionText || '',
      isHandwritten: block.isHandwritten || false,
      coordinates: block.coordinates,
      pageIndex: block.pageIndex || 0,
      confidence: block.confidence
    }));
  }

  /**
   * Call external AI API for multi-question detection
   */
  private static async callExternalAI(
    inputBlocks: any[],
    questionText: string | undefined,
    model: ModelType
  ): Promise<string> {
    const systemPrompt = getPrompt('multiQuestionDetection.system');
    const userPrompt = getPrompt('multiQuestionDetection.user', {
      extractedQuestionText: questionText || 'No question text provided',
      inputBlocks: JSON.stringify(inputBlocks, null, 2)
    });

    // Debug: Log what we're sending to AI
    console.log(`🔍 [AI DEBUG] Sending ${inputBlocks.length} blocks to AI:`);
    inputBlocks.forEach((block, i) => {
      console.log(`  Block ${i}: "${block.text?.substring(0, 100)}..." (handwritten: ${block.isHandwritten})`);
    });
    console.log(`🔍 [AI DEBUG] Question text: "${questionText?.substring(0, 100)}..."`);

    try {
      const response = await ModelProvider.callGeminiText(
        systemPrompt,
        userPrompt,
        model,
        true // forceJsonResponse
      );

      return response.content;
    } catch (error) {
      console.error('❌ [MULTI-Q DETECTION] AI API call failed:', error);
      throw new Error(`AI API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse AI response into text segments
   */
  private static parseAIResponse(aiResponse: string): TextSegment[] {
    try {
      // Extract JSON from AI response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.segments || !Array.isArray(parsed.segments)) {
        throw new Error('Invalid AI response format: missing segments array');
      }

      return parsed.segments.map((s: any) => ({
        text: s.text || '',
        type: s.type === 'student_work' ? 'student_work' : 'question_text',
        confidence: Math.max(0, Math.min(1, s.confidence || 0.5))
      }));

    } catch (error) {
      console.error('❌ [MULTI-Q DETECTION] Failed to parse AI response:', error);
      throw new Error(`Failed to parse AI response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate and enhance question segments
   */
  private static validateAndEnhanceQuestions(
    questions: QuestionSegment[],
    mathBlocks: MathBlock[]
  ): QuestionSegment[] {
    // Remove invalid questions
    const validQuestions = questions.filter(q => 
      q.startBlockIndex >= 0 && 
      q.endBlockIndex < mathBlocks.length &&
      q.startBlockIndex <= q.endBlockIndex &&
      q.confidence > 0.1
    );

    // Sort by start block index
    validQuestions.sort((a, b) => a.startBlockIndex - b.startBlockIndex);

    // Ensure no overlapping questions
    const nonOverlappingQuestions: QuestionSegment[] = [];
    let lastEndIndex = -1;

    for (const question of validQuestions) {
      if (question.startBlockIndex > lastEndIndex) {
        nonOverlappingQuestions.push(question);
        lastEndIndex = question.endBlockIndex;
      }
    }

    // Enhance with source pages
    return nonOverlappingQuestions.map(q => ({
      ...q,
      sourcePages: [...new Set(
        mathBlocks.slice(q.startBlockIndex, q.endBlockIndex + 1)
          .map(block => block.pageIndex || 0)
      )].sort((a, b) => a - b)
    }));
  }

  /**
   * Test the service with sample data
   */
  static async testService(): Promise<boolean> {
    try {
      const sampleBlocks: MathBlock[] = [
        {
          id: '0',
          text: 'Q1: Solve for x',
          mathpixLatex: 'Q1: Solve for x',
          googleVisionText: 'Q1: Solve for x',
          confidence: 0.9,
          mathLikenessScore: 0.1,
          coordinates: { x: 0, y: 0, width: 100, height: 20 },
          pageIndex: 0,
          globalBlockId: 'block_0',
          isHandwritten: false
        },
        {
          id: '1',
          text: 'x + 5 = 10',
          mathpixLatex: 'x + 5 = 10',
          googleVisionText: 'x + 5 = 10',
          confidence: 0.8,
          mathLikenessScore: 0.8,
          coordinates: { x: 0, y: 25, width: 80, height: 20 },
          pageIndex: 0,
          globalBlockId: 'block_1',
          isHandwritten: true
        }
      ];

      const result = await this.detectMultipleQuestions(sampleBlocks, 'Q1: Solve for x', { debug: true });
      
      console.log('🧪 [MULTI-Q DETECTION] Test result:', result);
      return result.success && result.totalSegments > 0;
      
    } catch (error) {
      console.error('❌ [MULTI-Q DETECTION] Test failed:', error);
      return false;
    }
  }
}
