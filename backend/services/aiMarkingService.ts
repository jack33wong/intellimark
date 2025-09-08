/**
 * AI Marking Service
 * Handles AI-powered homework marking with image classification and annotation generation
 */

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
   * Robust JSON cleaning and validation helper
   */
  private static cleanAndValidateJSON(response: string, expectedArrayKey: string): any {
    let cleanedResponse = response.trim();
    
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      cleanedResponse = jsonMatch[1];
      console.log('🔍 Extracted JSON from markdown:', cleanedResponse);
    }
    
    // Try to fix common JSON issues
    cleanedResponse = cleanedResponse
      .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
      .replace(/([{\[,])\s*([}\]])/g, '$1$2') // Remove commas before closing brackets
      .replace(/(\w+):/g, '"$1":') // Add quotes around unquoted keys
      .replace(/'/g, '"') // Replace single quotes with double quotes
      .replace(/,(\s*})/g, '$1') // Remove trailing commas before closing braces
      .replace(/,(\s*\])/g, '$1') // Remove trailing commas before closing brackets
      .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2') // Fix unescaped backslashes
      .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2') // Fix unescaped backslashes (second pass)
      .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2') // Fix unescaped backslashes (third pass)
      .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2'); // Fix unescaped backslashes (fourth pass)
    
    console.log('🔍 Cleaned JSON:', cleanedResponse);
    
    let result;
    try {
      result = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('❌ JSON Parse Error:', parseError);
      console.error('❌ Raw response:', response);
      console.error('❌ Cleaned response:', cleanedResponse);
      
      // Try one more aggressive cleaning approach
      try {
        const aggressiveClean = cleanedResponse
          .replace(/,(\s*[}\]])/g, '$1')
          .replace(/([{\[,])\s*([}\]])/g, '$1$2')
          .replace(/(\w+):/g, '"$1":')
          .replace(/'/g, '"')
          .replace(/,(\s*})/g, '$1')
          .replace(/,(\s*\])/g, '$1')
          .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2')
          .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2')
          .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2')
          .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2');
        
        console.log('🔍 Aggressive clean attempt:', aggressiveClean);
        result = JSON.parse(aggressiveClean);
      } catch (secondError) {
        throw new Error(`Invalid JSON response from AI: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
      }
    }
    
    // Validate the result structure
    if (!result[expectedArrayKey] || !Array.isArray(result[expectedArrayKey])) {
      throw new Error(`AI response missing ${expectedArrayKey} array`);
    }
    
    return result;
  }
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
    
    const systemPrompt = `You are an AI assistant that classifies math images and extracts question text. 
    
    Your task is to:
    1. Determine if an uploaded image contains:
       A) A math question ONLY (no student work, no answers, just the question/problem)
       B) A math question WITH student work/answers (homework to be marked)
    2. Extract the main question text from the image
    
    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:
    
    {
      "isQuestionOnly": true/false,
      "reasoning": "brief explanation of your classification",
      "extractedQuestionText": "the main question text extracted from the image"
    }
    
    CLASSIFICATION CRITERIA:
    - "isQuestionOnly: true" if the image shows ONLY a math question/problem with NO student work or answers
    - "isQuestionOnly: false" if the image shows a math question WITH student work, calculations, or answers written down
    
    QUESTION TEXT EXTRACTION:
    - Extract the main question/problem statement
    - Include any given information, variables, or constraints
    - Preserve mathematical notation and formatting
    - If multiple questions, extract the primary one
    - If no clear question, return "Unable to extract question text"
    
    Examples:
    - Textbook question, exam paper question, worksheet question = "isQuestionOnly: true"
    - Student homework with written answers, student's working out, completed problem = "isQuestionOnly: false"
    
    Return ONLY the JSON object.`;

    const userPrompt = `Please classify this uploaded image and extract the question text. Analyze the image to determine if it contains only a math question or if it includes student work/answers, and extract the main question text from the image.`;

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
        apiUsed: 'Fallback',
        extractedQuestionText: 'Unable to extract question text - AI service failed'
      };
    }
  }

  /**
   * LLM Call 1: Extrapolate bbox coordinates from Google Vision OCR into per-line coordinates
   */
  static async extrapolatePerLineCoordinates(
    model: SimpleModelType,
    processedImage: SimpleProcessedImageResult
  ): Promise<{
    lines: string; // Raw AI response as string
  }> {

    const systemPrompt = `You are an AI assistant that analyzes OCR bounding boxes and extrapolates per-line coordinates.

    Your task is to:
    1. Take the provided OCR bounding boxes from Google Vision
    2. Analyze the text content and layout
    3. Extrapolate individual line coordinates from the bounding boxes
    4. Return structured per-line data with accurate coordinates

    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:

    {
      "lines": [
        {
          "lineNumber": 1,
          "text": "extracted line text",
          "bbox": [x, y, width, height],
          "confidence": 0.95
        }
      ]
    }

    EXTRAPOLATION RULES:
    - If a bounding box contains multiple lines, split it into individual lines
    - Estimate line positions based on text content and typical line spacing
    - Preserve the original bounding box area but subdivide it logically
    - Use the original confidence score for all derived lines
    - Ensure no overlapping coordinates between lines
    - Maintain proper text-to-coordinate mapping

    Return ONLY the JSON object.`;

    let userPrompt = `Here are the OCR bounding boxes from Google Vision that need to be extrapolated into per-line coordinates:

IMAGE DIMENSIONS: ${processedImage.imageDimensions.width}x${processedImage.imageDimensions.height} pixels

OCR BOUNDING BOXES:
`;

    if (processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      processedImage.boundingBoxes.forEach((bbox: any, index: number) => {
        if (bbox.text && bbox.text.trim()) {
          const confidence = ((bbox.confidence || 0) * 100).toFixed(1);
          const cleanText = bbox.text.trim()
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');

          if (bbox.x !== undefined && bbox.y !== undefined && bbox.width !== undefined && bbox.height !== undefined) {
            userPrompt += `Box ${index + 1}: bbox[${bbox.x},${bbox.y},${bbox.width},${bbox.height}], text: "${cleanText}", confidence: "${confidence}%"\n`;
          }
        }
      });
    }

    userPrompt += `\nPlease extrapolate these bounding boxes into individual line coordinates.`;

    // Console log the prompt for debugging
    console.log('🔍 ===== LLM CALL 1: EXTRAPOLATE PER-LINE COORDINATES =====');
    console.log('🔍 Model:', model);
    console.log('🔍 System Prompt:', systemPrompt);
    console.log('🔍 User Prompt:', userPrompt);

    try {
      let response: string;
      if (model === 'gemini-2.5-pro') {
        response = await this.callGeminiForTextResponse(systemPrompt, userPrompt);
      } else {
        response = await this.callOpenAIForTextResponse(systemPrompt, userPrompt, model);
      }
      
      // Console log the AI response
      //console.log('🔍 AI Response:', response);
      
      // Since we're passing this as string to next LLM, no need to parse JSON
      // Just return the raw response wrapped in the expected format
      const result = {
        lines: response // Pass raw response as string
      };
      
      console.log('✅ Per-line coordinates response received (raw string)');
      console.log('🔍 ===== LLM CALL 1 COMPLETED =====\n');
      return result;
    } catch (error) {
      console.error('❌ Failed to extrapolate per-line coordinates:', error);
      console.log('🔍 ===== LLM CALL 1 FAILED =====\n');
      throw new Error(`Per-line coordinate extrapolation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * LLM Call 2: Generate marking annotations based on per-line coordinates
   */
  static async generateMarkingAnnotations(
    model: SimpleModelType,
    perLineData: { lines: string }, // Raw AI response as string
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<{
    annotations: string; // Raw AI response as string
  }> {

    const systemPrompt = `You are an AI assistant that generates marking annotations for student work.

    Your task is to:
    1. Analyze the student's work line by line
    2. Generate appropriate marking annotations for each line (MULTIPLE ANNOTATIONS PER LINE ALLOWED)
    3. Provide reasoning for each annotation decision

    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:

    {
      "annotations": [
        {
          "lineNumber": 1,
          "action": "tick|cross|comment",
          "text": "M1|M0|A1|A0|B1|B0|C1|C0",
          "reasoning": "Brief explanation of why this annotation was chosen"
        }
      ]
    }

    MULTIPLE ANNOTATIONS PER LINE:
    - You can create MULTIPLE annotations for the same line number
    - Each annotation should have its own entry in the annotations array
    - Different parts of the same line can have different annotations
    - For example, line 1 could have both a "tick" for correct method and a "comment" for "M1"
    - This allows for more granular and detailed marking

    ANNOTATION RULES:
    - Use "tick" for correct answers or working
    - Use "cross" for incorrect answers or errors
    - Use "comment" to show marks achieved (e.g., "M1", "A1", "B1")

    MARKING CRITERIA:
    - Analyze mathematical correctness
    - Check method accuracy
    - Mark should only be awarded when the answer statisfy all the criteria for that mark
    - Consider different aspects of the same line (method, accuracy, presentation)

    EXAMPLES OF MULTIPLE ANNOTATIONS PER LINE:
    - Line 1: "x = 5 + 3 = 8" could have:
      * A "tick" for correct calculation
      * A "comment" for "M1"
    - Line 2: "y = 2x + 1" could have:
      * A "cross" for wrong equation
      * A "comment" for "M0"

    Return ONLY the JSON object.`;

    let userPrompt = `Here is the student's work broken down by lines:

PER-LINE ANALYSIS (RAW AI RESPONSE):
${perLineData.lines}
`;
    console.log('🔍 LLM 2 Promt:', systemPrompt+userPrompt);
    // Add marking scheme context if available
    if (questionDetection && questionDetection.found && questionDetection.match) {
      const match = questionDetection.match;
      if (match.markingScheme) {
        const schemeJson = JSON.stringify(match.markingScheme, null, 2)
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");

        userPrompt += `\nMARK SCHEME (JSON):\n"""${schemeJson}"""\n`;
        userPrompt += `\nApply the marking strictly according to this scheme. Award marks only when criteria are fully satisfied.`;
      }
    }

    userPrompt += `\nPlease generate marking annotations for each line of student work. Remember that you can create MULTIPLE annotations for the same line if different parts of the line deserve different types of feedback or marking.`;

    // Console log the prompt for debugging
    console.log('🔍 ===== LLM CALL 2: GENERATE MARKING ANNOTATIONS =====');
    console.log('🔍 Model:', model);
    console.log('🔍 System Prompt:', systemPrompt);
    console.log('🔍 User Prompt:', userPrompt);

    try {
      let response: string;
      if (model === 'gemini-2.5-pro') {
        response = await this.callGeminiForTextResponse(systemPrompt, userPrompt);
      } else {
        response = await this.callOpenAIForTextResponse(systemPrompt, userPrompt, model);
      }
      
      // Console log the AI response
      console.log('🔍 AI Response:', response);
      
      // Since we're passing this as string to next LLM, no need to parse JSON
      // Just return the raw response wrapped in the expected format
      const result = {
        annotations: response // Pass raw response as string
      };
      
      console.log('✅ Marking annotations response received (raw string)');
      console.log('🔍 ===== LLM CALL 2 COMPLETED =====\n');
      return result;
    } catch (error) {
      console.error('❌ Failed to generate marking annotations:', error);
      console.log('🔍 ===== LLM CALL 2 FAILED =====\n');
      throw new Error(`Marking annotation generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * LLM Call 3: Calculate relative coordinates for annotations
   */
  static async calculateAnnotationCoordinates(
    model: SimpleModelType,
    perLineData: { lines: string }, // Raw AI response as string
    annotationData: { annotations: string } // Raw AI response as string
  ): Promise<{
    annotations: Array<{
      action: 'tick' | 'cross' | 'circle' | 'underline' | 'comment';
      bbox: [number, number, number, number];
      text?: string;
    }>;
  }> {

    const systemPrompt = `You are an AI assistant that calculates precise coordinates for marking annotations.

    Your task is to:
    1. Take per-line coordinates and annotation decisions
    2. Calculate precise bounding box coordinates for each annotation
    3. Position annotations to avoid overlapping with text
    4. Calculate appropriate annotation sizes based on line dimensions
    5. Return final annotation coordinates

    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:

    {
      "annotations": [
        {
          "action": "tick|cross|circle|underline|comment",
          "bbox": [x, y, width, height],
          "text": "Comment text (only for comment action)"
        }
      ]
    }

    POSITIONING RULES:
    - For ticks/crosses: Position to the right of the line text (x = line_x + line_width + 12px)
    - For circles: Circle around the specific text or formula
    - For underlines: Position directly under the text (y = line_y + line_height + 2px)
    - For comments: Position to the right of the line, below the line if needed
    - Ensure annotations don't overlap with each other

    ANNOTATION SIZING RULES:
    - Calculate annotation size based on the line bbox dimensions
    - For ticks/crosses: width = height = line_height * 0.8 (80% of line height)
    - For circles: width = height = line_height * 0.9 (90% of line height)
    - For underlines: width = line_width * 0.8, height = line_height * 0.15 (15% of line height)
    - For comments: width = max(60px, text_length * 8px), height = line_height * 0.7 (70% of line height)

    VERTICAL CENTERING RULES:
    - All annotations should be VERTICALLY CENTERED within the line bbox
    - Calculate y position as: y = line_y + (line_height - annotation_height) / 2
    - This ensures annotations appear in the middle of the line, not at the top
    - For multiple annotations on the same line, space them horizontally but keep them vertically centered

    SPACING RULES:
    - Minimum 8px gap between annotations on the same line
    - For multiple annotations per line, distribute them horizontally with equal spacing
    - If line is too short for all annotations, place some below the line (y = line_y + line_height + 8px)

    Return ONLY the JSON object.`;

    let userPrompt = `Here are the per-line coordinates and annotation decisions:

PER-LINE COORDINATES (RAW AI RESPONSE):
${perLineData.lines}

ANNOTATION DECISIONS (RAW AI RESPONSE):
${annotationData.annotations}

Please calculate precise coordinates for each annotation. Remember to:
- Calculate appropriate sizes based on the line bbox dimensions
- Position annotations VERTICALLY CENTERED within each line
- Ensure proper spacing between multiple annotations on the same line
- Use the sizing rules provided in the system prompt`;

    // Console log the prompt for debugging
    console.log('🔍 ===== LLM CALL 3: CALCULATE ANNOTATION COORDINATES =====');
    console.log('🔍 Model:', model);
    console.log('🔍 System Prompt:', systemPrompt);
    console.log('🔍 User Prompt:', userPrompt);

    try {
      let response: string;
      if (model === 'gemini-2.5-pro') {
        response = await this.callGeminiForTextResponse(systemPrompt, userPrompt);
      } else {
        response = await this.callOpenAIForTextResponse(systemPrompt, userPrompt, model);
      }
      
      // Console log the AI response
      console.log('🔍 AI Response:', response);
      
      // Only parse JSON at the very end since this is the final step
      const result = this.cleanAndValidateJSON(response, 'annotations');
      
      console.log('✅ Annotation coordinates calculated:', result.annotations?.length || 0, 'annotations (sized and vertically centered)');
      console.log('🔍 ===== LLM CALL 3 COMPLETED =====\n');
      return result;
    } catch (error) {
      console.error('❌ Failed to calculate annotation coordinates:', error);
      console.log('🔍 ===== LLM CALL 3 FAILED =====\n');
      throw new Error(`Annotation coordinate calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * NEW 3-STEP LLM FLOW: Complete marking pipeline with 3 LLM calls
   * 1. Classification -> Google Vision OCR -> LLM extrapolate bbox coordinates into per-line
   * 2. LLM create marking annotations based on per-line data
   * 3. LLM calculate relative coordinates for annotations -> SVG overlay
   */
  static async generateMarkingInstructionsWithNewFlow(
    imageData: string,
    model: SimpleModelType,
    processedImage: SimpleProcessedImageResult,
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<SimpleMarkingInstructions> {
    console.log('🔍 ===== NEW 2-STEP LLM FLOW STARTED (LLM1 REMOVED) =====');
    console.log('🔍 Model:', model);
    console.log('🔍 Image data length:', imageData.length);
    console.log('🔍 OCR text length:', processedImage.ocrText?.length || 0);
    console.log('🔍 Math blocks found:', processedImage.boundingBoxes?.length || 0);

    try {
      // Step 1: Generate marking annotations based on final OCR text (LLM2)
      console.log('🔍 ===== STEP 1: GENERATE MARKING ANNOTATIONS (LLM2) =====');
      console.log('🔍 Input: Final OCR text without coordinates');
      const annotationData = await this.generateMarkingAnnotationsFromText(
        model,
        processedImage.ocrText || '',
        questionDetection
      );
      console.log('✅ Step 1 completed - Marking annotations response received');

      // Step 2: Calculate precise coordinates for annotations (LLM3)
      console.log('🔍 ===== STEP 2: CALCULATE ANNOTATION COORDINATES (LLM3) =====');
      console.log('🔍 Input: Annotation decisions + OCR bounding boxes');
      const finalAnnotations = await this.calculateAnnotationCoordinatesFromText(
        model,
        processedImage.ocrText || '',
        processedImage.boundingBoxes || [],
        annotationData
      );
      console.log('✅ Step 2 completed - Final annotations:', finalAnnotations.annotations.length, 'annotations');

      // Convert to SimpleMarkingInstructions format
      const result: SimpleMarkingInstructions = {
        annotations: finalAnnotations.annotations.map(annotation => ({
          action: annotation.action,
          bbox: annotation.bbox,
          ...(annotation.text && { text: annotation.text })
        }))
      };

      console.log('✅ ===== NEW 2-STEP LLM FLOW COMPLETED =====');
      console.log('✅ Total annotations generated:', result.annotations.length);
      console.log('🔍 Final result summary:');
      console.log('  - OCR text length:', processedImage.ocrText?.length || 0, 'characters');
      console.log('  - Math blocks available:', processedImage.boundingBoxes?.length || 0, 'blocks');
      console.log('  - Marking decisions:', annotationData.annotations.length, 'decisions');
      console.log('  - Final annotations:', result.annotations.length, 'annotations');
      console.log('🔍 ===== NEW 2-STEP LLM FLOW SUMMARY =====\n');
      
      return result;

    } catch (error) {
      console.error('❌ New 2-step LLM flow failed:', error);
      
      // Fallback to legacy method if new flow fails
      console.log('🔄 Falling back to legacy marking method...');
      return await this.generateMarkingInstructions(
        imageData,
        model,
        processedImage,
        questionDetection
      );
    }
  }

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

    const systemPrompt = `You are an AI assistant that generates marking annotations for student work.

    Your task is to:
    1. Analyze the student's work from the OCR text
    2. Generate appropriate marking annotations for different parts of the work
    3. Provide reasoning for each annotation decision

    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:

    {
      "annotations": [
        {
          "textMatch": "exact text from OCR that this annotation applies to",
          "action": "tick|cross|comment",
          "text": "M1|M0|A1|A0|B1|B0|C1|C0|comment text",
          "reasoning": "Brief explanation of why this annotation was chosen"
        }
      ]
    }

    ANNOTATION RULES:
    - Use "tick" for correct answers or working
    - Use "cross" for incorrect answers or errors
    - Use "comment" to show marks achieved (e.g., "M1", "A1", "B1") or provide feedback
    - "textMatch" should be the exact text from the OCR that this annotation applies to
    - Be specific with text matches - use unique phrases that can be found in the OCR text

    MARKING CRITERIA:
    - Analyze mathematical correctness
    - Check method accuracy
    - Mark should only be awarded when the answer satisfies all the criteria for that mark
    - Consider different aspects of the same work (method, accuracy, presentation)
    - Look for mathematical expressions, especially those with pipe notation (|v|) for absolute values

    EXAMPLES:
    - For "|v| = 28/5 = 5.6ms^-1" you might create:
      * A "tick" for correct absolute value notation
      * A "tick" for correct calculation
      * A "comment" for "M1" if method is correct
    - For "x = 5 + 3 = 8" you might create:
      * A "tick" for correct calculation
      * A "comment" for "A1" if answer is correct

    Return ONLY the JSON object.`;

    let userPrompt = `Here is the OCR text from the student's work that needs to be marked:

OCR TEXT:
${ocrText}

Please analyze this work and generate appropriate marking annotations. Focus on mathematical correctness, method accuracy, and provide specific text matches for each annotation.`;

    // Add question detection context if available
    if (questionDetection?.match?.markingScheme) {
      userPrompt += `\n\nMARKING SCHEME CONTEXT:
Exam: ${questionDetection.match.board} ${questionDetection.match.qualification} ${questionDetection.match.paperCode} ${questionDetection.match.year}
Total Questions: ${questionDetection.match.markingScheme.totalQuestions}
Total Marks: ${questionDetection.match.markingScheme.totalMarks}`;
    }

    let response: string;
    if (model === 'gemini-2.5-pro') {
      response = await this.callGeminiForTextResponse(systemPrompt, userPrompt);
    } else {
      response = await this.callOpenAIForTextResponse(systemPrompt, userPrompt, model);
    }
    console.log('🔍 LLM2 (Marking Annotations) response received');

    try {
      this.cleanAndValidateJSON(response, 'annotations');
      return { annotations: response }; // Return raw response for LLM3
    } catch (error) {
      console.error('❌ LLM2 JSON parsing failed:', error);
      throw new Error(`LLM2 failed to generate valid marking annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * NEW LLM3: Calculate precise coordinates for annotations based on text matching
   */
  static async calculateAnnotationCoordinatesFromText(
    model: SimpleModelType,
    ocrText: string,
    boundingBoxes: any[],
    annotationData: { annotations: string }
  ): Promise<{
    annotations: SimpleAnnotation[];
  }> {

    const systemPrompt = `You are an AI assistant that calculates precise coordinates for marking annotations.

    Your task is to:
    1. Take marking annotations and OCR text with bounding boxes
    2. Match each annotation to the correct text in the OCR
    3. Calculate precise coordinates for each annotation
    4. Return final annotations with accurate bounding boxes

    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow this format:

    {
      "annotations": [
        {
          "action": "tick|cross|comment",
          "bbox": [x, y, width, height],
          "text": "M1|M0|A1|A0|B1|B0|C1|C0|comment text"
        }
      ]
    }

    COORDINATE CALCULATION RULES:
    - Use the provided bounding boxes to find text matches
    - If text is found in multiple bounding boxes, use the most relevant one
    - If text spans multiple bounding boxes, combine their coordinates
    - Ensure coordinates are within the image bounds
    - Use [x, y, width, height] format where (x,y) is top-left corner

    TEXT MATCHING RULES:
    - Match annotations to the exact text from the OCR
    - Be flexible with whitespace and formatting differences
    - Prioritize mathematical expressions and key terms
    - If exact match not found, use the closest relevant text

    Return ONLY the JSON object.`;

    const userPrompt = `Here are the marking annotations and OCR data:

MARKING ANNOTATIONS:
${annotationData.annotations}

OCR TEXT:
${ocrText}

BOUNDING BOXES:
${JSON.stringify(boundingBoxes, null, 2)}

Please calculate precise coordinates for each annotation by matching the text to the bounding boxes.`;

    let response: string;
    if (model === 'gemini-2.5-pro') {
      response = await this.callGeminiForTextResponse(systemPrompt, userPrompt);
    } else {
      response = await this.callOpenAIForTextResponse(systemPrompt, userPrompt, model);
    }
    console.log('🔍 LLM3 (Coordinate Calculation) response received');

    try {
      const result = this.cleanAndValidateJSON(response, 'annotations');
      return {
        annotations: result.annotations.map((annotation: any) => ({
          action: annotation.action,
          bbox: annotation.bbox,
          ...(annotation.text && { text: annotation.text })
        }))
      };
    } catch (error) {
      console.error('❌ LLM3 JSON parsing failed:', error);
      throw new Error(`LLM3 failed to calculate annotation coordinates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate marking instructions for homework images (LEGACY - kept for backward compatibility)
   */
  static async generateMarkingInstructions(
    imageData: string, 
    model: SimpleModelType, 
    processedImage?: SimpleProcessedImageResult,
    questionDetection?: SimpleQuestionDetectionResult
  ): Promise<SimpleMarkingInstructions> {
    const compressedImage = await this.compressImage(imageData);

    const systemPrompt = `You are an AI assistant analyzing images. 
    You will receive an image and your task is to:
    
    1. Analyze the image content using the provided OCR text and bounding box data
    2. Provide marking and annotations.
    
    CRITICAL OUTPUT RULES:
    - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
    - Output MUST strictly follow the format shown below
    - Use the provided OCR text to understand exactly what the student has written
    - Use bounding box positions [x, y, width, height] to place annotations accurately without overlapping text
    
    ==================== OUTPUT FORMAT ====================
    
    {
      "annotations": [
        {
          "action": "tick|cross|circle|underline|comment",
          "bbox": [x, y, width, height],
          "text": "Comment text (only for comment action)"
        }
      ]
    }
    
    ANNOTATION RULES:
    - Use "tick" for correct answers
    - Use "cross" for incorrect answers  
    - Use "circle" to highlight important parts
    - Use "underline" to emphasize key concepts
    - Use "comment" to show which mark is achieved Eg "M1", "A1", "B1"
   

    POSITIONING RULES:
    ann_x = text_x + text_w + 12 (12 px to the right of the right edge)
    ann_y = text_y + text_h/2 (vertically centered)
    ann_w = ann_h = text_h 
    IF the bbox given are 1 big box, then extrapolate and calculate the positon of each line.
    
    MARKING RULES (IGNORE THIS IF MARK SCHEME IS NOT PROVIDED):
    -Marking annotations must strictly follow the marking scheme.
    Glossary for maark scheme:
    - M Method marks are awarded for a correct method which could lead to a correct answer.
    - A Accuracy marks are awarded when following on from a correct method. It is not necessary to always see the method. This can be implied.
    - B Marks awarded independent of method.
    - Mark schemes should be applied positively. Candidates must be rewarded for what they have shown they can do rather than penalised for omissions.
    - To be awarded marks, the student must have fulfill completely the marking criteria.
    - There will be additional guidance given, read them and apply them to the marking annotations.
    - IMPORTANT: For each mark awarded, add a comment "M1"/ "A1"/ "B1" next to the line that achieve the mark

    Return ONLY the JSON object.`;

    let userPrompt = `Here is an uploaded imageo of a student’s solution.

========================================================
`;

    // Append detected question + marking scheme context if available
    if (questionDetection && questionDetection.found && questionDetection.match) {
      const match = questionDetection.match;
      const schemeJson = match.markingScheme ? JSON.stringify(match.markingScheme, null, 2)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n") : '';

      if (match.markingScheme) {
        userPrompt += `\nMARK SCHEME (JSON):\n"""${schemeJson}"""\n`;
        //userPrompt += `Apply the marking strictly according to this scheme. Award marks only when criteria are fully satisfied, and summarize marks at the bottom of the image.`;
      }
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
      
      ///userPrompt += `\nUse OCR positions as a guide to avoid overlaps and to find blank spaces for comments.`;
      //userPrompt += `\n\nIMAGE DIMENSIONS: ${processedImage.imageDimensions.width}x${processedImage.imageDimensions.height} pixels`;
      userPrompt += `\nIMPORTANT: All annotations must stay within these dimensions.`;
      userPrompt += `\n(x + width) <= ${processedImage.imageDimensions.width}`;
      userPrompt += `\n(y + height) <= ${processedImage.imageDimensions.height}`;
      //userPrompt += `\nComments specificly must start within left haft of image: (x) <= ${processedImage.imageDimensions.width}/2`;
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
        apiUsed: 'Google Gemini 2.0 Flash Exp',
        extractedQuestionText: parsed.extractedQuestionText
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
        apiUsed: model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni',
        extractedQuestionText: parsed.extractedQuestionText
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
