import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import { normalizeLatexDelimiters } from '../../utils/TextNormalizationUtils.js';

// ========================= START: NORMALIZED DATA STRUCTURE =========================
interface NormalizedMarkingScheme {
  marks: any[];           // The marking scheme array
  totalMarks: number;     // Total marks for the question
  questionNumber: string; // Question identifier
  questionLevelAnswer?: string; // Question-level answer (e.g., "H", "F", "J" for letter-based answers)
  marksWithAnswers?: string[]; // Array of answers for each mark (for grouped sub-questions like Q12i, 12ii, 12iii)
}

// ========================= START: NORMALIZATION FUNCTION =========================
function normalizeMarkingScheme(input: any): NormalizedMarkingScheme | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  
  // ========================= SINGLE IMAGE PIPELINE FORMAT =========================
  if (input.markingScheme && typeof input.markingScheme === 'string') {
    try {
      const parsed = JSON.parse(input.markingScheme);
      
      // Extract question-level answer if it exists
      const questionLevelAnswer = input.answer || input.match?.answer || parsed.answer || undefined;
      
      const normalized = {
        marks: parsed.marks || [],
        totalMarks: input.match?.marks || 0,
        questionNumber: input.match?.questionNumber || '1',
        questionLevelAnswer: questionLevelAnswer
      };
      
      return normalized;
    } catch (error) {
      return null;
    }
  }
  
  // ========================= UNIFIED PIPELINE FORMAT =========================
  if (input.questionMarks && input.totalMarks !== undefined) {
    
    // Extract marks array from questionMarks.marks
    const marksArray = input.questionMarks.marks || [];
    
    // Extract question-level answer if it exists (for letter-based answers like "H", "F", "J")
    const questionLevelAnswer = input.answer || input.questionMarks.answer || undefined;
    
    // Extract sub-question-specific answers for grouped sub-questions (e.g., Q12i="H", 12ii="F", 12iii="J")
    // Check multiple possible locations where sub-question answers might be stored
    let marksWithAnswers: string[] | undefined = undefined;
    const questionNumber = input.questionNumber || '?';
    
    if (input.subQuestionAnswers && Array.isArray(input.subQuestionAnswers) && input.subQuestionAnswers.length > 0) {
      // Filter out empty strings and ensure we have valid answers
      const validAnswers = input.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '' && a.toLowerCase() !== 'cao');
      if (validAnswers.length > 0) {
        marksWithAnswers = validAnswers;
        console.log(`[MARKING INSTRUCTION] Q${questionNumber}: Found ${validAnswers.length} sub-question answer(s): ${validAnswers.join(', ')}`);
      }
    } else if (input.questionMarks?.subQuestionAnswers && Array.isArray(input.questionMarks.subQuestionAnswers) && input.questionMarks.subQuestionAnswers.length > 0) {
      const validAnswers = input.questionMarks.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '' && a.toLowerCase() !== 'cao');
      if (validAnswers.length > 0) {
        marksWithAnswers = validAnswers;
        console.log(`[MARKING INSTRUCTION] Q${questionNumber}: Found ${validAnswers.length} sub-question answer(s): ${validAnswers.join(', ')}`);
      }
    }
    
    // Only log if no answers found (to reduce noise)
    if (!marksWithAnswers && (input.subQuestionAnswers || input.questionMarks?.subQuestionAnswers)) {
      console.log(`[MARKING INSTRUCTION] Q${questionNumber}: No valid sub-question answers found (filtered out empty/cao values)`);
    }
    
    const normalized = {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer,
      marksWithAnswers: marksWithAnswers
    };
    
    
    return normalized;
  }
  
  // ========================= UNIFIED PIPELINE FORMAT (duplicate check) =========================
  if (input.questionMarks && input.totalMarks !== undefined && !Array.isArray(input.questionMarks)) {
    // This is a duplicate path - already handled above, but keep for safety
    const questionLevelAnswer = input.answer || input.questionMarks.answer || undefined;
    
    const normalized = {
      marks: [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer
    };
    return normalized;
  }
  
  // ========================= FALLBACK: MATCH OBJECT FORMAT =========================
  if (input.match?.markingScheme?.questionMarks) {
    // Handle the new structure where marks are in questionMarks.marks
    let marksArray = [];
    if (input.match.markingScheme.questionMarks.marks) {
      marksArray = input.match.markingScheme.questionMarks.marks;
    } else if (Array.isArray(input.match.markingScheme.questionMarks)) {
      marksArray = input.match.markingScheme.questionMarks;
    }
    
    // Extract question-level answer if it exists
    const questionLevelAnswer = input.answer || input.match.answer || input.match.markingScheme.answer || undefined;
    
    const normalized = {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.match.marks || 0,
      questionNumber: input.match.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer
    };
    
    return normalized;
  }
  
  return null;
}
// ========================== END: NORMALIZATION FUNCTION ==========================

// Import the formatting function from prompts.ts
import { formatMarkingSchemeAsBullets } from '../../config/prompts.js';

export interface MarkingInputs {
  imageData: string;
  model: ModelType;
  processedImage: ProcessedImageResult;
  questionDetection?: any;
  questionMarks?: any;
  totalMarks?: number;
  questionNumber?: string;
  questionText?: string | null; // Question text from fullExamPapers (source for question detection)
}

export class MarkingInstructionService {
  /**
   * Execute complete marking flow - moved from LLMOrchestrator
   */
  static async executeMarking(inputs: MarkingInputs): Promise<MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string }> {
    const { imageData: _imageData, model, processedImage, questionDetection, questionText } = inputs;


    // OCR processing completed - all OCR cleanup now done in Stage 3 OCRPipeline

    try {
      // Get cleaned OCR data from OCRPipeline (now includes all OCR cleanup)
      const cleanDataForMarking = (processedImage as any).cleanDataForMarking;
      // ========================= START OF FIX =========================
      // Use the plain text OCR text that was passed in, not the JSON format from OCR service
      const cleanedOcrText = (processedImage as any).ocrText || (processedImage as any).cleanedOcrText;
      // ========================== END OF FIX ==========================
      const unifiedLookupTable = (processedImage as any).unifiedLookupTable;
      
      if (!cleanDataForMarking || !cleanDataForMarking.steps || cleanDataForMarking.steps.length === 0) {
        throw new Error('Cannot generate annotations without steps - OCR cleanup failed in OCRPipeline');
      }

      // Step 1: Generate raw annotations from cleaned OCR text
      // Normalize the marking scheme data to a standard format
      const normalizedScheme = normalizeMarkingScheme(questionDetection);
      
      // Extract raw OCR blocks and classification for enhanced marking
      const rawOcrBlocks = (processedImage as any).rawOcrBlocks;
      const classificationStudentWork = (processedImage as any).classificationStudentWork;
      
      const annotationData = await this.generateFromOCR(
        model,
        cleanedOcrText, // Use the plain text directly instead of JSON
        normalizedScheme, // Pass the normalized scheme instead of raw questionDetection
        questionDetection?.match, // Pass exam info for logging
        questionText, // Pass question text from fullExamPapers
        rawOcrBlocks, // Pass raw OCR blocks for enhanced marking
        classificationStudentWork // Pass classification student work for enhanced marking
      );
      
      // Handle case where AI returns 0 annotations (e.g., no valid student work, wrong blocks assigned)
      if (!annotationData.annotations || !Array.isArray(annotationData.annotations)) {
        throw new Error('AI failed to generate valid annotations array');
      }
      
      if (annotationData.annotations.length === 0) {
        console.warn(`[MARKING INSTRUCTION] ⚠️ AI returned 0 annotations - likely no valid student work or wrong blocks assigned`);
        // Return empty annotations instead of throwing - allows pipeline to continue
        return {
          annotations: [],
          usage: { llmTokens: annotationData.usageTokens || 0 },
          cleanedOcrText: cleanedOcrText,
          studentScore: annotationData.studentScore || { score: 0, total: 0 }
        };
      }

      // ========================= START: ANNOTATION ENRICHMENT =========================
      // Enrich annotations with bbox coordinates for single image pipeline
      
      const enrichedAnnotations = annotationData.annotations.map(anno => {
        const aiStepId = (anno as any).step_id?.trim();
        if (!aiStepId) {
          return null;
        }
        
        // Find matching step in cleanDataForMarking.steps
        // Try exact match first (check both unified_step_id and globalBlockId)
        let matchingStep = cleanDataForMarking.steps.find((step: any) => 
          step.unified_step_id?.trim() === aiStepId || step.globalBlockId?.trim() === aiStepId
        );
        
        // If not found, try flexible matching (handle step_1 vs q8_step_1, etc.)
        if (!matchingStep && aiStepId) {
          // Extract step number from AI step_id (e.g., "step_2" -> "2", "q8_step_2" -> "2")
          const stepNumMatch = aiStepId.match(/step[_\s]*(\d+)/i);
          if (stepNumMatch && stepNumMatch[1]) {
            const stepNum = parseInt(stepNumMatch[1], 10);
            // Match by step index (1-based)
            if (stepNum > 0 && stepNum <= cleanDataForMarking.steps.length) {
              matchingStep = cleanDataForMarking.steps[stepNum - 1];
            }
          }
        }
        
        // If still not found, check if AI is using OCR block ID format (block_X_Y)
        if (!matchingStep && aiStepId && aiStepId.startsWith('block_')) {
          matchingStep = cleanDataForMarking.steps.find((step: any) => 
            step.globalBlockId?.trim() === aiStepId
          );
        }
        
        if (matchingStep && matchingStep.bbox) {
          // Get pageIndex from matchingStep, but treat -1 as invalid and use fallback
          let pageIndex = matchingStep.pageIndex;
          if (pageIndex == null || pageIndex < 0) {
            // Try to get pageIndex from rawOcrBlocks if available
            if (rawOcrBlocks && rawOcrBlocks.length > 0) {
              // Find the OCR block that matches this step
              const matchingBlock = rawOcrBlocks.find((block: any) => 
                block.id === matchingStep.globalBlockId || 
                (matchingStep.globalBlockId && block.id?.trim() === matchingStep.globalBlockId.trim())
              );
              if (matchingBlock && matchingBlock.pageIndex != null && matchingBlock.pageIndex >= 0) {
                pageIndex = matchingBlock.pageIndex;
              } else {
                // Use first block's pageIndex as fallback
                pageIndex = rawOcrBlocks[0]?.pageIndex ?? 0;
              }
            } else {
              pageIndex = 0; // Default fallback
            }
          }
          
          return {
            ...anno,
            bbox: matchingStep.bbox as [number, number, number, number],
            pageIndex: pageIndex
          };
        } else {
          return null;
        }
      }).filter(anno => anno !== null);
      
      // ========================== END: ANNOTATION ENRICHMENT ==========================
      
      const result: MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; studentScore?: any } = { 
        annotations: enrichedAnnotations, // ✅ Return enriched annotations with bbox coordinates
        usage: { llmTokens: annotationData.usageTokens || 0 },
        cleanedOcrText: cleanedOcrText,
        studentScore: annotationData.studentScore
      };
      
      return result;
    } catch (error) {
      console.error('❌ Marking flow failed:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      // Throw the real error instead of failing silently
      throw new Error(`Marking flow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Use shared normalization helper from TextNormalizationUtils

  static async generateFromOCR(
    model: ModelType,
    ocrText: string,
    normalizedScheme?: NormalizedMarkingScheme | null,
    examInfo?: any,
    questionText?: string | null,
    rawOcrBlocks?: Array<{ id: string; text: string; pageIndex: number; coordinates?: { x: number; y: number } }>,
    classificationStudentWork?: string | null
  ): Promise<{ annotations: string; studentScore?: any; usageTokens: number }> {
    // Parse and format OCR text if it's JSON
    let formattedOcrText = ocrText;
    try {
      const parsedOcr = JSON.parse(ocrText);
      if (parsedOcr.question && parsedOcr.steps) {
        // Format the OCR text nicely and normalize LaTeX delimiters
        formattedOcrText = `Question: ${parsedOcr.question}\n\nStudent's Work:\n${parsedOcr.steps.map((step: any, index: number) => {
          const normalizedText = normalizeLatexDelimiters(step.cleanedText || step.text || '');
          // Use simplified step ID format (e.g., [step_1], [step_2])
          const simplifiedStepId = `step_${index + 1}`;
          return `${index + 1}. [${simplifiedStepId}] ${normalizedText}`;
        }).join('\n')}`;
      }
    } catch (error) {
      // If parsing fails, normalize the original text
      formattedOcrText = normalizeLatexDelimiters(ocrText);
    }

    // ========================= START: USE SINGLE PROMPT =========================
    // Use the centralized prompt from prompts.ts
    const { AI_PROMPTS } = await import('../../config/prompts.js');
    
    // Determine which prompt to use based on whether we have a meaningful marking scheme
    const hasMarkingScheme = normalizedScheme !== null && 
                            normalizedScheme !== undefined && 
                            normalizedScheme.marks.length > 0;
    
    if (normalizedScheme) {
    }
    
    let systemPrompt: string;
    let userPrompt: string;
    
    if (hasMarkingScheme) {
      // Use the withMarkingScheme prompt
      const prompt = AI_PROMPTS.markingInstructions.withMarkingScheme;
      systemPrompt = prompt.system;
      
      // Format marking scheme for the prompt using normalized data
      let schemeJson = '';
      try {
        // Convert normalized scheme to JSON format for the prompt
        // Include question-level answer if available
        const schemeData: any = { marks: normalizedScheme.marks };
        if (normalizedScheme.questionLevelAnswer) {
          schemeData.questionLevelAnswer = normalizedScheme.questionLevelAnswer;
        }
        // Include sub-question-specific answers if available (for grouped sub-questions)
        if (normalizedScheme.marksWithAnswers && normalizedScheme.marksWithAnswers.length > 0) {
          schemeData.marksWithAnswers = normalizedScheme.marksWithAnswers;
        }
        schemeJson = JSON.stringify(schemeData, null, 2);
      } catch (error) {
        schemeJson = '{}';
      }
      
      // Get total marks from normalized scheme
      const totalMarks = normalizedScheme.totalMarks;
      
      // Call user prompt with enhanced parameters (raw OCR blocks and classification)
      userPrompt = prompt.user(formattedOcrText, schemeJson, totalMarks, questionText, rawOcrBlocks, classificationStudentWork);
    } else {
      // Use the basic prompt
      const prompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = prompt.system;
      userPrompt = prompt.user(formattedOcrText);
    }
    
    // ========================== END: USE SINGLE PROMPT ==========================

    // Extract question number for logging
    const questionNumber = normalizedScheme?.questionNumber || examInfo?.questionNumber || 'Unknown';

    // Log what's being sent to AI for debugging with better formatting
    // Color codes
    const GREEN = '\x1b[32m';      // Question header, Marking scheme
    const MAGENTA = '\x1b[35m';    // Question text
    const YELLOW = '\x1b[33m';     // Classification student work
    const CYAN = '\x1b[36m';       // OCR blocks
    const RESET = '\x1b[0m';
    
    // Add empty newline before each question (separates questions)
    console.log('');
    console.log(`${GREEN}📝 [AI PROMPT] Q${questionNumber}${RESET}`);
    
    // 1. Question Text
    if (questionText) {
      console.log(`${MAGENTA}Question Text:${RESET}`);
      console.log(MAGENTA + questionText + RESET);
    }
    
    // 2. Classification Student Work (formatted for AI)
    if (classificationStudentWork && rawOcrBlocks && rawOcrBlocks.length > 0) {
      // Recreate the classificationLines format that's sent to AI (same logic as in prompts.ts)
      let lines = classificationStudentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
      const expandedLines: string[] = [];
      lines.forEach(line => {
        const dollarMatches = line.match(/\$/g);
        const hasMultipleSteps = dollarMatches && dollarMatches.length >= 4;
        if (hasMultipleSteps) {
          const parts: string[] = [];
          let lastIndex = 0;
          const regex = /\$[^$]+\$/g;
          let match;
          while ((match = regex.exec(line)) !== null) {
            if (match.index > lastIndex) {
              const beforeText = line.substring(lastIndex, match.index).trim();
              if (beforeText) parts.push(beforeText);
            }
            parts.push(match[0]);
            lastIndex = regex.lastIndex;
          }
          if (lastIndex < line.length) {
            const afterText = line.substring(lastIndex).trim();
            if (afterText) parts.push(afterText);
          }
          let currentStep = '';
          parts.forEach((part) => {
            if (part.startsWith('$')) {
              if (currentStep.trim()) expandedLines.push(currentStep.trim());
              currentStep = part;
            } else {
              if (part.match(/^\d+[\.\)]/) && currentStep.trim()) {
                expandedLines.push(currentStep.trim());
                currentStep = part;
              } else {
                currentStep += (currentStep ? ' ' : '') + part;
              }
            }
          });
          if (currentStep.trim()) expandedLines.push(currentStep.trim());
        } else {
          expandedLines.push(line);
        }
      });
      const classificationLines = expandedLines.map((line, idx) => {
        const stepId = `step_${idx + 1}`;
        return `${idx + 1}. [${stepId}] ${line.trim()}`;
      }).join('\n').trim();
      
      console.log(`${YELLOW}Classification Student Work:${RESET}`);
      console.log(YELLOW + classificationLines + RESET);
    }
    
    // 3. OCR Blocks (formatted for AI)
    if (rawOcrBlocks && rawOcrBlocks.length > 0) {
      // Format OCR blocks similar to how they appear in the prompt
      const ocrBlocksFormatted = rawOcrBlocks.map((block, idx) => {
        const stepId = `step_${idx + 1}`;
        const text = block.text.substring(0, 100) + (block.text.length > 100 ? '...' : '');
        return `${idx + 1}. [${stepId}] ${text}`;
      }).join('\n');
      
      console.log(`${CYAN}OCR Blocks:${RESET}`);
      console.log(CYAN + ocrBlocksFormatted + RESET);
    }
    
    // 4. Marking Scheme
    if (hasMarkingScheme) {
      // Recreate schemeJson for logging (same logic as above to ensure consistency)
      let schemeJsonForLogging = '';
      try {
        const schemeData: any = { marks: normalizedScheme.marks };
        if (normalizedScheme.questionLevelAnswer) {
          schemeData.questionLevelAnswer = normalizedScheme.questionLevelAnswer;
        }
        if (normalizedScheme.marksWithAnswers && normalizedScheme.marksWithAnswers.length > 0) {
          schemeData.marksWithAnswers = normalizedScheme.marksWithAnswers;
        }
        schemeJsonForLogging = JSON.stringify(schemeData, null, 2);
      } catch (error) {
        schemeJsonForLogging = '{}';
      }
      
      // Convert JSON marking scheme to clean bulleted list format for logging
      const schemePlainText = formatMarkingSchemeAsBullets(schemeJsonForLogging);
      
      console.log(`${GREEN}Marking Scheme:${RESET}`);
      console.log(GREEN + schemePlainText + RESET);
    }

    let aiResponseString = ''; // Declare outside try block for error logging
    
    try {
      // Use the provided model parameter
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, true);
      
      aiResponseString = res.content;
      const usageTokens = res.usageTokens;


      // Parse the AI response (Add robust parsing/cleanup)
      let jsonString = aiResponseString;
      const jsonMatch = aiResponseString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
           jsonString = jsonMatch[1];
      }

      // Sanitize JSON string to handle unescaped characters
      // The AI may return single backslashes in LaTeX that need to be escaped for JSON
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(jsonString);
      } catch (error) {
        // If parsing fails, fix common JSON issues
        let fixedJson = jsonString;
        
        // Fix 1: Missing closing brace before comma (e.g., "reasoning": "...",\n,\n{)
        // Pattern: field value followed by newline, comma, newline, opening brace
        // Should be: field value, closing brace, comma, newline, opening brace
        // Handle various indentation levels and values that may contain escaped quotes
        fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
          // Preserve the indentation of the comma line
          const indentMatch = match.match(/\n(\s*),\s*\n/);
          const indent = indentMatch ? indentMatch[1] : '    ';
          // Value is already properly escaped in JSON, use as-is
          return `"${field}": "${value}"\n${indent}},\n${indent}{`;
        });
        
        // Fix 2: Unescaped backslashes in string values
        // Replace single backslashes that aren't followed by valid escape characters
        // Valid escapes: \", \\, \n, \r, \t, \b, \f, \uXXXX
        fixedJson = fixedJson.replace(/\\(?![\\"/nrtbfu])/g, '\\\\');
        
        try {
          parsedResponse = JSON.parse(fixedJson);
        } catch (secondError) {
          // Fix 3: More aggressive backslash escaping
          fixedJson = jsonString.replace(/\\/g, '\\\\');
          // But then un-escape the ones that should stay as single (like \n, \", etc.)
          fixedJson = fixedJson.replace(/\\\\n/g, '\\n');
          fixedJson = fixedJson.replace(/\\\\"/g, '\\"');
          fixedJson = fixedJson.replace(/\\\\r/g, '\\r');
          fixedJson = fixedJson.replace(/\\\\t/g, '\\t');
          fixedJson = fixedJson.replace(/\\\\b/g, '\\b');
          fixedJson = fixedJson.replace(/\\\\f/g, '\\f');
          
          // Fix 4: Missing closing brace before comma (retry after backslash fixes)
          fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
            // Preserve the indentation of the comma line
            const indentMatch = match.match(/\n(\s*),\s*\n/);
            const indent = indentMatch ? indentMatch[1] : '    ';
            // Value is already properly escaped in JSON, use as-is
            return `"${field}": "${value}"\n${indent}},\n${indent}{`;
          });
          
          try {
            parsedResponse = JSON.parse(fixedJson);
          } catch (thirdError) {
            console.error("❌ JSON parsing failed after fix attempts. Error:", thirdError);
            console.error("❌ Problematic JSON section (first 500 chars):", fixedJson.substring(0, 500));
            throw thirdError;
          }
        }
      }

      // Extract question number for logging
      const questionNumber = normalizedScheme?.questionNumber || examInfo?.questionNumber || 'Unknown';

      // Log clean AI response with better formatting
      console.log(`🤖 [AI RESPONSE] Q${questionNumber} - Clean response received:`);
      console.log('  - Annotations count:', '\x1b[35m' + (parsedResponse.annotations?.length || 0) + '\x1b[0m'); // Magenta color
      console.log('  - Student score:', '\x1b[32m' + (parsedResponse.studentScore?.scoreText || 'None') + '\x1b[0m'); // Green color
      console.log('  - Usage tokens:', '\x1b[33m' + usageTokens + '\x1b[0m'); // Yellow color
      
      // Log individual annotations for debugging (especially for answers like 18.6)
      if (parsedResponse.annotations && parsedResponse.annotations.length > 0) {
        console.log('  - Annotations:');
        parsedResponse.annotations.forEach((ann: any, idx: number) => {
          const action = ann.action || 'unknown';
          const text = ann.text || '';
          const textMatch = ann.textMatch || '';
          const stepId = ann.step_id || 'MISSING';
          const reasoning = ann.reasoning || '';
          const actionColor = action === 'tick' ? '\x1b[32m' : action === 'cross' ? '\x1b[31m' : '\x1b[0m';
          const resetColor = '\x1b[0m';
          const shortMatch = textMatch.length > 50 ? textMatch.substring(0, 50) + '...' : textMatch;
          const stepIdColor = stepId === 'MISSING' ? '\x1b[31m' : '\x1b[36m'; // Red if missing, cyan if present
          console.log(`    ${idx + 1}. ${actionColor}${action}${resetColor} ${text ? `[${text}]` : ''} ${stepIdColor}step_id="${stepId}"${resetColor} "${shortMatch}"${reasoning ? ` - ${reasoning}` : ''}`);
        });
        // Log step_id summary
        const stepIds = parsedResponse.annotations.map((a: any) => a.step_id || 'MISSING');
        const missingCount = stepIds.filter((id: string) => id === 'MISSING').length;
        if (missingCount > 0) {
          console.log(`  ⚠️ ${missingCount}/${parsedResponse.annotations.length} annotations missing step_id`);
        }
      } else {
        console.log('  ⚠️ No annotations in parsed response');
      }

      // Return the correct MarkingInstructions structure
      const markingResult = {
          annotations: parsedResponse.annotations || [], // Default to empty array if missing
          studentScore: parsedResponse.studentScore || null,
          usageTokens
      };
      
      return markingResult;

    } catch (error) {
         console.error("❌ Error calling AI for marking instructions or parsing response:", error);
         // Log the raw response string if parsing failed
         if (error instanceof SyntaxError) {
             console.error("❌ RAW AI RESPONSE STRING that failed to parse:", aiResponseString);
         }
         throw new Error(`AI marking instruction generation failed: ${error instanceof Error ? error.message : 'Unknown AI error'}`);
    }
  }
}
