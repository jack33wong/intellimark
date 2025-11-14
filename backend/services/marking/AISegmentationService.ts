/**
 * AI Segmentation Service
 * Uses AI to map OCR blocks to classification student work and merge best results
 */

import type { ModelType } from '../../types/index.js';
import type { PageOcrResult, MathBlock, MarkingTask } from '../../types/markingRouter.js';
import type { ClassificationResult } from './ClassificationService.js';
import { getPrompt } from '../../config/prompts.js';
import { getModelConfig, validateModel } from '../../config/aiModels.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';

export function segmentOcrResultsByQuestion(
  allPagesOcrData: PageOcrResult[],
  classificationResult: ClassificationResult,
  detectedSchemesMap: Map<string, any>,
  pageDimensions?: Map<number, { width: number; height: number }>,
  model: ModelType = 'auto'
): Promise<MarkingTask[]> {
  // Fail fast: Validate inputs
  if (!allPagesOcrData || allPagesOcrData.length === 0) {
    throw new Error('[AI SEGMENTATION] No OCR data provided');
  }
  
  if (!classificationResult || !classificationResult.questions || classificationResult.questions.length === 0) {
    throw new Error('[AI SEGMENTATION] No classification questions found. Classification must succeed before segmentation.');
  }
  
  if (!detectedSchemesMap || detectedSchemesMap.size === 0) {
    throw new Error('[AI SEGMENTATION] No marking schemes detected. Question detection must succeed before segmentation.');
  }

  return performAISegmentation(allPagesOcrData, classificationResult, detectedSchemesMap, pageDimensions, model);
}

async function performAISegmentation(
  allPagesOcrData: PageOcrResult[],
  classificationResult: ClassificationResult,
  detectedSchemesMap: Map<string, any>,
  pageDimensions?: Map<number, { width: number; height: number }>,
  model: ModelType = 'auto'
): Promise<MarkingTask[]> {
  // 1. Prepare OCR blocks with IDs
  const ocrBlocks: Array<{ id: string; text: string; pageIndex: number; coordinates?: { x: number; y: number }; originalBlock: MathBlock }> = [];
  let blockCounter = 0;

  allPagesOcrData.forEach((pageResult) => {
    const mathBlocks = pageResult.ocrData?.mathBlocks || [];
    mathBlocks.forEach((block) => {
      const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
      if (blockText.length > 0) {
        ocrBlocks.push({
          id: `block_${blockCounter++}`,
          text: blockText,
          pageIndex: pageResult.pageIndex,
          coordinates: block.coordinates ? { x: block.coordinates.x, y: block.coordinates.y } : undefined,
          originalBlock: block
        });
      }
    });
  });

  if (ocrBlocks.length === 0) {
    console.warn('[AI SEGMENTATION] No OCR blocks found');
    return [];
  }

  // 2. Prepare classification questions with student work and question text
  const classificationQuestions: Array<{ questionNumber: string; questionText?: string | null; studentWork?: string | null; subQuestions?: Array<{ part: string; questionText?: string | null; studentWork?: string | null }> }> = [];
  
  // Build question number to scheme map for question text lookup
  const questionToSchemeMap = new Map<string, string>();
  detectedSchemesMap.forEach((scheme, schemeKey) => {
    const qNum = schemeKey.split('_')[0];
    questionToSchemeMap.set(qNum, schemeKey);
  });
  
  (classificationResult.questions || []).forEach((q: any) => {
    if (q.questionNumber) {
      const qNum = String(q.questionNumber);
      // Get question text from classification or scheme
      let questionText = q.text || null;
      if (!questionText) {
        // Try to get from scheme
        const schemeKey = questionToSchemeMap.get(qNum);
        if (schemeKey) {
          const scheme = detectedSchemesMap.get(schemeKey);
          questionText = scheme?.databaseQuestionText || scheme?.questionText || null;
        }
      }
      
      classificationQuestions.push({
        questionNumber: qNum,
        questionText: questionText,
        studentWork: q.studentWork || null,
        subQuestions: q.subQuestions ? q.subQuestions.map((sq: any) => {
          const subQNum = `${qNum}${sq.part || ''}`;
          // Get sub-question text
          let subQText = sq.text || null;
          if (!subQText) {
            const subQSchemeKey = questionToSchemeMap.get(subQNum);
            if (subQSchemeKey) {
              const subQScheme = detectedSchemesMap.get(subQSchemeKey);
              subQText = subQScheme?.databaseQuestionText || subQScheme?.questionText || null;
            }
          }
          return {
            part: sq.part || '',
            questionText: subQText,
            studentWork: sq.studentWork || null
          };
        }) : undefined
      });
    }
  });

  if (classificationQuestions.length === 0) {
    console.warn('[AI SEGMENTATION] No classification questions found');
    return [];
  }

  // 3. Call AI to map and merge

  const systemPrompt = getPrompt('aiSegmentation.system');
  const ocrBlocksForPrompt = ocrBlocks.map(b => ({
    id: b.id,
    text: b.text,
    pageIndex: b.pageIndex,
    coordinates: b.coordinates
  }));
  const userPrompt = getPrompt('aiSegmentation.user', ocrBlocksForPrompt, classificationQuestions);
  
  // Log prompt size estimate
  const promptSizeEstimate = systemPrompt.length + userPrompt.length;
  const promptSizeTokens = Math.ceil(promptSizeEstimate / 4); // Rough estimate: 1 token ≈ 4 chars
  console.log(`[AI SEGMENTATION] Prompt size:`);
  console.log(`[AI SEGMENTATION]   System prompt: ${systemPrompt.length} chars (~${Math.round(systemPrompt.length / 4)} tokens)`);
  console.log(`[AI SEGMENTATION]   User prompt: ${userPrompt.length} chars (~${Math.round(userPrompt.length / 4)} tokens)`);
  console.log(`[AI SEGMENTATION]   Total: ${promptSizeEstimate} chars (~${promptSizeTokens} tokens)`);
  
  // Get max tokens from model config (64000 for gemini-2.5-flash)
  const validatedModel = validateModel(model);
  const modelConfig = getModelConfig(validatedModel);
  const maxOutputTokens = modelConfig.maxTokens || 64000;
  console.log(`[AI SEGMENTATION]   Max output tokens: ${maxOutputTokens}`);
  console.log(`[AI SEGMENTATION] ============================================\n`);

  try {
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    const accessToken = await ModelProvider.getGeminiAccessToken();
    const endpoint = modelConfig.apiEndpoint;
    
    const requestBody = {
      contents: [{
        parts: [
          { text: systemPrompt },
          { text: userPrompt }
        ]
      }],
      generationConfig: {
        temperature: 0.0, // Zero temperature for maximum consistency and speed
        topK: 20, // Further reduced for faster generation
        topP: 0.7, // Further reduced for faster, more focused generation
        maxOutputTokens: Math.min(maxOutputTokens, 32000), // Cap at 32k for speed (actual output typically < 10k tokens)
      },
      safetySettings: [
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
      ]
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Segmentation API error: ${response.status} ${errorText}`);
    }

    // Check if response is HTML (error page)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      const htmlContent = await response.text();
      console.error('❌ [AI SEGMENTATION] Received HTML response instead of JSON:');
      console.error('❌ [AI SEGMENTATION] HTML content:', htmlContent.substring(0, 200) + '...');
      throw new Error('Gemini API returned HTML error page instead of JSON. Check API key and permissions.');
    }

    const data = await response.json();
    
    // Use ModelProvider's extraction method (same as ClassificationService)
    const aiResponse = await ModelProvider.extractGeminiTextContent(data);
    const parsedResponse = parseAISegmentationResponse(aiResponse);

    // 4. Convert AI response to MarkingTask[]
    return convertToMarkingTasks(
      parsedResponse,
      ocrBlocks,
      classificationResult,
      detectedSchemesMap,
      pageDimensions
    );
  } catch (error) {
    console.error('[AI SEGMENTATION] Error:', error);
    throw error;
  }
}


function parseAISegmentationResponse(response: string): {
  mappings: Array<{
    questionNumber: string;
    ocrBlockId: string;
    classificationLine: string;
    mergedContent: string;
    source: string;
    confidence: number;
  }>;
  unmappedBlocks?: Array<{
    ocrBlockId: string;
    reason: string;
  }>;
} {
  // Try to extract JSON from response (may have markdown code blocks)
  let jsonText = response.trim();
  
  // Remove markdown code blocks if present
  if (jsonText.includes('```json')) {
    jsonText = jsonText.split('```json')[1].split('```')[0].trim();
  } else if (jsonText.includes('```')) {
    jsonText = jsonText.split('```')[1].split('```')[0].trim();
  }

  // Check for truncated JSON (common when maxOutputTokens is exceeded)
  // Look for incomplete JSON structure
  const isTruncated = !jsonText.endsWith('}') && !jsonText.endsWith(']');
  
  if (isTruncated) {
    console.warn('[AI SEGMENTATION] Response appears truncated. Attempting to recover partial JSON...');
    
    // Strategy 1: Find the last complete mapping object (ends with })
    let lastCompleteMapping = jsonText.lastIndexOf('}');
    
    // Strategy 2: If cut off mid-string, find the last complete field
    if (lastCompleteMapping === -1 || lastCompleteMapping < jsonText.length - 100) {
      // Look for last complete field pattern: "field": "value",
      const fieldPattern = /"([^"]+)":\s*"([^"]*)"\s*,?\s*$/;
      const lastFieldMatch = jsonText.match(/(?:"([^"]+)":\s*"[^"]*"\s*,?\s*)+$/);
      if (lastFieldMatch) {
        // Find position before the incomplete string
        const incompleteStringStart = jsonText.lastIndexOf('"');
        if (incompleteStringStart > 0) {
          // Go back to find the start of this field
          const fieldStart = jsonText.lastIndexOf('"', incompleteStringStart - 1);
          if (fieldStart > 0) {
            // Remove the incomplete field
            lastCompleteMapping = fieldStart - 1; // Before the field name quote
            // Find the comma or opening brace before this field
            while (lastCompleteMapping > 0 && 
                   jsonText[lastCompleteMapping] !== ',' && 
                   jsonText[lastCompleteMapping] !== '{') {
              lastCompleteMapping--;
            }
            if (jsonText[lastCompleteMapping] === ',') {
              lastCompleteMapping--; // Remove the comma too
            }
          }
        }
      }
    }
    
    // Strategy 3: Find last complete mapping entry in array
    if (lastCompleteMapping > 0) {
      const mappingsStart = jsonText.indexOf('"mappings": [');
      if (mappingsStart > 0 && lastCompleteMapping > mappingsStart) {
        // Extract up to the last complete mapping
        let recoveredJson = jsonText.substring(0, lastCompleteMapping + 1);
        
        // Count braces to ensure proper closing
        const openBraces = (recoveredJson.match(/{/g) || []).length;
        const closeBraces = (recoveredJson.match(/}/g) || []).length;
        const openBrackets = (recoveredJson.match(/\[/g) || []).length;
        const closeBrackets = (recoveredJson.match(/\]/g) || []).length;
        
        // Close the mappings array and root object
        if (openBrackets > closeBrackets) {
          recoveredJson += '\n  ]';
        }
        if (openBraces > closeBraces) {
          recoveredJson += '\n}';
        }
        
        jsonText = recoveredJson;
        console.warn(`[AI SEGMENTATION] Recovered ${(jsonText.match(/}/g) || []).length} complete mapping entries from truncated response`);
      }
    }
  }

  try {
    const parsed = JSON.parse(jsonText);
    
    // Convert compact format to full format for backward compatibility
    const mappings = (parsed.mappings || []).map((m: any) => {
      // Handle both compact and full formats
      const questionNumber = m.q || m.questionNumber;
      const ocrBlockId = m.block || m.ocrBlockId;
      const mergedContent = m.content || m.mergedContent;
      const source = m.src ? (m.src === 'o' ? 'ocr' : m.src === 'c' ? 'classification' : 'merged') : m.source;
      const confidence = m.conf !== undefined ? m.conf : m.confidence;
      
      // For classificationLine, use mergedContent (since we removed it from output)
      const classificationLine = m.classificationLine || mergedContent;
      
      return {
        questionNumber,
        ocrBlockId,
        classificationLine,
        mergedContent,
        source: source || 'classification',
        confidence: confidence || 0.9
      };
    });
    
    const unmappedBlocks = (parsed.unmapped || parsed.unmappedBlocks || []).map((u: any) => ({
      ocrBlockId: u.block || u.ocrBlockId,
      reason: u.reason || 'No matching classification line'
    }));
    
    return { mappings, unmappedBlocks: unmappedBlocks.length > 0 ? unmappedBlocks : undefined };
  } catch (error) {
    console.error('[AI SEGMENTATION] Failed to parse JSON:', jsonText);
    throw new Error(`Failed to parse AI segmentation response: ${error}`);
  }
}

function convertToMarkingTasks(
  aiResponse: {
    mappings: Array<{
      questionNumber: string;
      ocrBlockId: string;
      classificationLine: string;
      mergedContent: string;
      source: string;
      confidence: number;
    }>;
    unmappedBlocks?: Array<{ ocrBlockId: string; reason: string }>;
  },
  ocrBlocks: Array<{ id: string; originalBlock: MathBlock; pageIndex: number }>,
  classificationResult: ClassificationResult,
  detectedSchemesMap: Map<string, any>,
  pageDimensions?: Map<number, { width: number; height: number }>
): MarkingTask[] {
  // Create map from OCR block ID to original block
  // Also create reverse map from block coordinates to AI block ID for lookup
  const blockIdToBlock = new Map<string, { block: MathBlock; pageIndex: number; globalBlockId: string }>();
  ocrBlocks.forEach(b => {
    // Store both the AI-generated ID and the coordinate-based ID for lookup
    const globalBlockId = `${b.pageIndex}_${b.originalBlock.coordinates?.x}_${b.originalBlock.coordinates?.y}`;
    blockIdToBlock.set(b.id, { block: b.originalBlock, pageIndex: b.pageIndex, globalBlockId });
    // Also allow lookup by coordinate-based ID (fallback)
    if (!blockIdToBlock.has(globalBlockId)) {
      blockIdToBlock.set(globalBlockId, { block: b.originalBlock, pageIndex: b.pageIndex, globalBlockId });
    }
  });

  // Group mappings by question number
  const mappingsByQuestion = new Map<string, Array<{
    block: MathBlock;
    pageIndex: number;
    classificationLine: string;
    mergedContent: string;
    source: string; // Track source for logging
    confidence: number;
  }>>();

    aiResponse.mappings.forEach(mapping => {
      // Check if this is a drawing entry (has [DRAWING] in mergedContent or classificationLine)
      const isDrawing = mapping.mergedContent?.includes('[DRAWING]') || mapping.classificationLine?.includes('[DRAWING]');
      
      // Handle invalid or missing block IDs
      if (!mapping.ocrBlockId || mapping.ocrBlockId === 'undefined' || mapping.ocrBlockId.trim() === '' || !blockIdToBlock.has(mapping.ocrBlockId)) {
        if (isDrawing) {
        // For drawings, create a synthetic entry even without OCR block
        if (!mappingsByQuestion.has(mapping.questionNumber)) {
          mappingsByQuestion.set(mapping.questionNumber, []);
        }
        // Create a minimal synthetic block for the drawing
        const syntheticBlock: MathBlock = {
          mathpixLatex: '',
          googleVisionText: '',
          coordinates: undefined
        };
        // Try to get pageIndex from classification
        const matchingQuestion = (classificationResult.questions || []).find((q: any) => {
          if (q.questionNumber === mapping.questionNumber) return true;
          if (q.subQuestions && Array.isArray(q.subQuestions)) {
            return q.subQuestions.some((sq: any) => `${q.questionNumber}${sq.part || ''}` === mapping.questionNumber);
          }
          return false;
        });
        const pageIndex = matchingQuestion?.sourceImageIndex ?? 0;
        
        mappingsByQuestion.get(mapping.questionNumber)!.push({
          block: syntheticBlock,
          pageIndex: pageIndex,
          classificationLine: mapping.classificationLine,
          mergedContent: mapping.mergedContent,
          source: mapping.source || 'classification',
          confidence: mapping.confidence
        });
        return; // Skip OCR block lookup for drawings
      } else {
        // Not a drawing and no valid OCR block - skip silently (already filtered above)
        return;
      }
    }

    const blockData = blockIdToBlock.get(mapping.ocrBlockId);
    if (!blockData) {
      console.warn(`[AI SEGMENTATION] Block ${mapping.ocrBlockId} not found in OCR blocks`);
      return;
    }

    if (!mappingsByQuestion.has(mapping.questionNumber)) {
      mappingsByQuestion.set(mapping.questionNumber, []);
    }

    mappingsByQuestion.get(mapping.questionNumber)!.push({
      block: blockData.block,
      pageIndex: blockData.pageIndex,
      classificationLine: mapping.classificationLine,
      mergedContent: mapping.mergedContent,
      source: mapping.source, // Track source
      confidence: mapping.confidence
    });
  });

  // Get classification student work for each question (main and sub-questions)
  const questionToStudentWork = new Map<string, string | null>();
  // Also track which questions have drawings (for creating tasks even without OCR blocks)
  const questionsWithDrawings = new Set<string>();
  
  (classificationResult.questions || []).forEach((q: any) => {
    if (q.questionNumber) {
      const mainQNum = String(q.questionNumber);
      
      // Store main question student work
      let mainStudentWork: string | null = null;
      if (q.studentWork && q.studentWork !== 'null' && q.studentWork.trim().length > 0) {
        mainStudentWork = q.studentWork;
        questionToStudentWork.set(mainQNum, mainStudentWork);
        if (mainStudentWork.includes('[DRAWING]')) {
          questionsWithDrawings.add(mainQNum);
        }
      }
      
      // Store sub-question student work with combined question numbers (e.g., "22a", "22b")
      if (q.subQuestions && Array.isArray(q.subQuestions)) {
        q.subQuestions.forEach((subQ: any) => {
          if (subQ.studentWork && subQ.studentWork !== 'null' && (subQ.studentWork.trim() || subQ.studentWork.includes('[DRAWING]'))) {
            const subQNum = `${mainQNum}${subQ.part || ''}`;
            questionToStudentWork.set(subQNum, subQ.studentWork);
            if (subQ.studentWork.includes('[DRAWING]')) {
              questionsWithDrawings.add(subQNum);
            }
          }
        });
        
        // Also store combined sub-question work under main question number for backward compatibility
        const subQWork = q.subQuestions
          .map((sq: any) => sq.studentWork)
          .filter((sw: any) => sw && sw !== 'null' && (sw.trim() || sw.includes('[DRAWING]')))
          .join('\\n');
        if (subQWork) {
          const combinedWork = mainStudentWork ? `${mainStudentWork}\\n${subQWork}` : subQWork;
          questionToStudentWork.set(mainQNum, combinedWork);
        }
      }
    }
  });
  
  // For questions with drawings that have no mappings, create empty mappings so tasks are created
  questionsWithDrawings.forEach((qNum) => {
    if (!mappingsByQuestion.has(qNum)) {
      mappingsByQuestion.set(qNum, []);
    }
  });

  // Create MarkingTask for each question
  const tasks: MarkingTask[] = [];
  const questionToSchemeMap = new Map<string, string>();

  // Build question to scheme map from detectedSchemesMap
  // Support both main questions (e.g., "22") and sub-questions (e.g., "22a", "22b")
  detectedSchemesMap.forEach((scheme, schemeKey) => {
    // Extract question number from scheme key (e.g., "18_Pearson Edexcel_1MA1/1H" -> "18")
    const baseQNum = getBaseQuestionNumber(schemeKey.split('_')[0]);
    questionToSchemeMap.set(baseQNum, schemeKey);
    // Also support sub-question numbers (e.g., "22a", "22b") by mapping them to the same scheme
    // This allows the AI to return "22a" or "22b" and still find the correct scheme
    const schemeQNum = schemeKey.split('_')[0];
    if (schemeQNum !== baseQNum) {
      // If scheme key has sub-question part, also map it
      questionToSchemeMap.set(schemeQNum, schemeKey);
    }
  });


  mappingsByQuestion.forEach((blocks, questionNumber) => {
    // For sub-questions (e.g., "22a"), try to find scheme by sub-question number first,
    // then fall back to base question number (e.g., "22")
    let schemeKey = questionToSchemeMap.get(questionNumber);
    if (!schemeKey) {
      const baseQNum = getBaseQuestionNumber(questionNumber);
      schemeKey = questionToSchemeMap.get(baseQNum) || questionNumber;
    }
    const markingScheme = detectedSchemesMap.get(schemeKey);
    // For classification student work, try sub-question number first, then base question number
    let classificationStudentWork = questionToStudentWork.get(questionNumber);
    if (!classificationStudentWork) {
      const baseQNum = getBaseQuestionNumber(questionNumber);
      classificationStudentWork = questionToStudentWork.get(baseQNum) || null;
    }

    // Allow tasks with no blocks if they have [DRAWING] entries (drawings don't have OCR text blocks)
    const hasDrawing = classificationStudentWork && classificationStudentWork.includes('[DRAWING]');
    if (blocks.length === 0 && !hasDrawing) {
      console.warn(`[AI SEGMENTATION] No blocks mapped for Q${questionNumber}, skipping`);
      return;
    }
    
    // If no blocks but has drawing, create empty blocks array (drawing will be handled separately)
    if (blocks.length === 0 && hasDrawing) {
      console.log(`[AI SEGMENTATION] Q${questionNumber} has [DRAWING] but no OCR blocks - creating task for drawing only`);
    }

    // Sort blocks by page and Y position
    blocks.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
      const aY = a.block.coordinates?.y;
      const bY = b.block.coordinates?.y;
      if (aY != null && bY != null) return aY - bY;
      return 0;
    });

    // Get source pages from blocks, or from classification if drawing-only
    let sourcePages: number[] = [];
    if (blocks.length > 0) {
      sourcePages = [...new Set(blocks.map(b => b.pageIndex))].sort((a, b) => a - b);
    } else if (hasDrawing) {
      // For drawing-only tasks, try to get pageIndex from classification
      const matchingQuestion = (classificationResult.questions || []).find((q: any) => {
        if (q.questionNumber === questionNumber) return true;
        if (q.subQuestions && Array.isArray(q.subQuestions)) {
          return q.subQuestions.some((sq: any) => `${q.questionNumber}${sq.part || ''}` === questionNumber);
        }
        return false;
      });
      if (matchingQuestion?.sourceImageIndex !== undefined) {
        sourcePages = [matchingQuestion.sourceImageIndex];
      }
    }

    // Create block-to-classification map
    const blockToClassificationMap = new Map<string, { classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>();
    blocks.forEach(({ block, classificationLine, confidence }) => {
      // Use coordinate-based ID format to match original segmentation
      const blockId = `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
      blockToClassificationMap.set(blockId, {
        classificationLine,
        similarity: confidence,
        questionNumber
      });
    });

    // Ensure pageIndex is preserved on blocks
    // If no blocks but has drawing, create an empty array (drawing will be handled by drawing classification)
    const mathBlocksWithPageIndex = blocks.length > 0 
      ? blocks.map(b => {
          const block = b.block;
          // Ensure pageIndex is set on the block object
          if (!(block as any).pageIndex && b.pageIndex != null) {
            (block as any).pageIndex = b.pageIndex;
          }
          return block;
        })
      : []; // Empty array for drawing-only tasks

    // Build final student work with source indicators for logging
    const finalStudentWork: Array<{ content: string; source: string; blockId: string }> = [];
    if (blocks.length > 0) {
      blocks.forEach(({ block, mergedContent, source }) => {
        const blockId = `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
        finalStudentWork.push({
          content: mergedContent,
          source: source || 'classification', // Default to classification if not specified
          blockId
        });
      });
    } else if (hasDrawing && classificationStudentWork) {
      // For drawing-only tasks, use the classification student work directly
      finalStudentWork.push({
        content: classificationStudentWork,
        source: 'classification',
        blockId: 'drawing_only'
      });
    }

    // ANSI color codes
    const GREEN = '\x1b[32m';
    const YELLOW = '\x1b[33m';
    const BLUE = '\x1b[34m';
    const RESET = '\x1b[0m';
    
    // Log final student work per question with reordered format and colors
    console.log(`\n[AI SEGMENTATION RESULT] Q${questionNumber}:`);
    
    // 1. Green Classification (student work only) - first, on new line
    if (classificationStudentWork && classificationStudentWork !== 'null') {
      const classificationPreview = classificationStudentWork.length > 100 ? classificationStudentWork.substring(0, 100) + '...' : classificationStudentWork;
      console.log(`${GREEN}[AI SEGMENTATION RESULT]   Classification: ${classificationPreview}${RESET}`);
    }
    
    // 2. Yellow OCR Blocks
    if (blocks.length > 0) {
      console.log(`${YELLOW}[AI SEGMENTATION RESULT]   Raw OCR Blocks (${blocks.length} blocks):${RESET}`);
      blocks.forEach(({ block, pageIndex }, idx) => {
        const rawOcrText = (block.mathpixLatex || block.googleVisionText || '').trim();
        const coords = block.coordinates ? ` (x=${block.coordinates.x}, y=${block.coordinates.y})` : '';
        const textPreview = rawOcrText.length > 80 ? rawOcrText.substring(0, 80) + '...' : rawOcrText;
        console.log(`${YELLOW}[AI SEGMENTATION RESULT]     ${idx + 1}. [Page ${pageIndex}${coords}]: "${textPreview}"${RESET}`);
      });
    } else if (hasDrawing) {
      console.log(`${YELLOW}[AI SEGMENTATION RESULT]   Raw OCR Blocks: None (drawing-only task)${RESET}`);
    }
    
    // 3. Blue Final Student Work
    console.log(`${BLUE}[AI SEGMENTATION RESULT]   Final Student Work (${finalStudentWork.length} blocks):${RESET}`);
    finalStudentWork.forEach((item, idx) => {
      const sourceLabel = item.source === 'ocr' ? 'OCR' : item.source === 'merged' ? 'MERGED' : 'CLASSIFICATION';
      const contentPreview = item.content.length > 80 ? item.content.substring(0, 80) + '...' : item.content;
      console.log(`${BLUE}[AI SEGMENTATION RESULT]     ${idx + 1}. [${sourceLabel}] ${contentPreview}${RESET}`);
    });
    
    const sourceBreakdown = {
      classification: finalStudentWork.filter(item => item.source === 'classification').length,
      ocr: finalStudentWork.filter(item => item.source === 'ocr').length,
      merged: finalStudentWork.filter(item => item.source === 'merged').length
    };
    console.log(`[AI SEGMENTATION RESULT]   Source Breakdown: Classification=${sourceBreakdown.classification}, OCR=${sourceBreakdown.ocr}, Merged=${sourceBreakdown.merged}`);

    tasks.push({
      questionNumber,
      mathBlocks: mathBlocksWithPageIndex,
      markingScheme: markingScheme || null,
      sourcePages,
      classificationStudentWork,
      pageDimensions,
      blockToClassificationMap,
      aiSegmentationResults: finalStudentWork // Store AI segmentation merged content with source indicators
    });
  });

  console.log(`\n[AI SEGMENTATION] Created ${tasks.length} marking task(s)`);
  return tasks;
}

