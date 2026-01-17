/**
 * Centralized AI Prompts Configuration
 * 
 * This file contains all AI prompts used throughout the application.
 * Edit prompts here for easy maintenance and consistency.
 */

import { normalizeLatexDelimiters } from '../utils/TextNormalizationUtils.js';

// Static Import for all AI prompts (Bundled by esbuild or directly loaded by tsx)
import classification_light_system_prompt from './prompts/classification_light_system_prompt.js';
import classification_mapper_system_prompt from './prompts/classification_mapper_system_prompt.js';
import classification_system_prompt from './prompts/classification_system_prompt.js';
import contextual_system_prompt from './prompts/contextual_system_prompt.js';
import marking_basic_system_prompt from './prompts/marking_basic_system_prompt.js';
import marking_scheme_explanation_system_prompt from './prompts/marking_scheme_explanation_system_prompt.js';
import marking_scheme_system_prompt from './prompts/marking_scheme_system_prompt.js';
import master_summary_system_prompt from './prompts/master_summary_system_prompt.js';
import model_answer_system_prompt from './prompts/model_answer_system_prompt.js';
import question_only_system_prompt from './prompts/question_only_system_prompt.js';
import question_only_user_prompt from './prompts/question_only_user_prompt.js';
import similar_questions_system_prompt from './prompts/similar_questions_system_prompt.js';



// Force valid structure for all system prompts
// Note: System prompts are loaded synchronously at startup
// Trigger restart 7

export const AI_PROMPTS = {
  // ============================================================================
  // CLASSIFICATION SERVICE PROMPTS
  // ============================================================================

  classification: {
    mapper: {
      system: (imageCount: number) => classification_mapper_system_prompt.replace('{{IMAGE_COUNT}}', imageCount.toString()),
      user: (imageCount: number) => `Scan these ${imageCount} pages and list question numbers.`
    },

    // Light classification (OCR-only for questionOnly pages - NO POSITIONS)
    light: {
      system: classification_light_system_prompt,
      user: `Extract all printed question text from the image. Ignore handwriting.`
    },

    // Heavy classification (full extraction with POSITIONS for questionAnswer pages)
    heavy: {
      system: classification_system_prompt,
      user: `Please classify this uploaded image and extract ALL question text and student work.
    
    CRITICAL INSTRUCTION:
    Transcribe student work EXACTLY as written.
    - Do NOT simplify fractions (e.g., write "4+3+1" NOT "8").
    - Do NOT perform arithmetic.
    - Do NOT correct spelling or grammar.
    - Capture every single character, number, and symbol verbatim.`
    }
  },


  // ============================================================================
  // AI MARKING SERVICE PROMPTS
  // ============================================================================

  marking: {
    // Question-only mode (when student asks for help with a question)
    questionOnly: {
      system: question_only_system_prompt,

      user: (message: string, markingScheme: string) => question_only_user_prompt
        .replace('{{QUESTION_TEXT}}', message)
        .replace('{{MARKING_SCHEME}}', markingScheme)
    },



    // Contextual response (for follow-up chat)
    contextual: {
      system: contextual_system_prompt,

      user: (message: string, contextPrompt: string) => `Math problem: "${message}"${contextPrompt}`
    }
  },



  // ============================================================================
  // MARKING INSTRUCTION SERVICE PROMPTS
  // ============================================================================

  markingInstructions: {
    // Basic marking (without marking scheme)
    basic: {
      system: marking_basic_system_prompt,

      user: (ocrText: string, classificationStudentWork?: string | null) => `Here is the OCR TEXT:

       ${ocrText}
       
       ${classificationStudentWork ? `\nSTUDENT WORK (STRUCTURED):\n${classificationStudentWork}\n` : ''}
       
       Please analyze this work and generate appropriate marking annotations.Focus on mathematical correctness, method accuracy.Do not generate any feedback text.`
    },

    withMarkingScheme: {
      system: (isGeneric: boolean = false) => marking_scheme_system_prompt(isGeneric),

      user: (
        questionNumber: string,
        markingScheme: string,
        classificationStudentWork: string,
        rawOcrBlocks?: any[],
        questionText?: string | null,
        subQuestionPageMap?: Record<string, number>,
        generalMarkingGuidance?: string,
        isGeneric: boolean = false
      ) => `
# MARKING TASK: Question ${questionNumber}

${questionText ? `## QUESTION TEXT
${questionText}
` : ''}

${generalMarkingGuidance ? `## GENERAL MARKING GUIDANCE (CHIEF EXAMINER INSTRUCTION)
${generalMarkingGuidance}

` : ''}

## MARKING SCHEME
${markingScheme}

${!isGeneric ? `
> [!IMPORTANT]
> The number of annotations you generate MUST BE EXACTLY EQUAL to the number of marks available in the MARKING SCHEME.
> - If the marking scheme has 4 potential marks (e.g., M1, M1, A1, B1), you MUST return exactly 4 annotations.
> - Do NOT omit marks that were not awarded; return them as 0 (e.g., M0, A0) to ensure the count matches exactly.
` : `
> [!IMPORTANT]
> This is a GENERIC marking pool. 
> - Discover the actual total marks from the student paper (e.g. "Total 4 marks").
> - ONLY return annotations for the marks actually identified/needed.
> - Do NOT generate filler annotations to "coverage" the entire M1-M8 pool.
`}

## STUDENT WORK (STRUCTURED)
${classificationStudentWork}
${subQuestionPageMap && Object.keys(subQuestionPageMap).length > 0 ? `
## PAGE ASSIGNMENT CONSTRAINTS (HIGHEST PRIORITY)
You MUST respect the page assignments provided below. The images passed to you correspond to these Page Index values (marked with "--- Page Index X ---" labels above the images):
${Object.entries(subQuestionPageMap).map(([part, pageIdx]) => `- Sub-question ${part}: Page ${pageIdx}`).join('\n')}

Do NOT search for work on other pages for these sub-questions, even if you see a question header there. Focus ONLY on the assigned page.
` : ''}
 
${rawOcrBlocks && rawOcrBlocks.length > 0 ? (() => {
          const landmarks = rawOcrBlocks.filter(b => b.isPrinted);
          // ✅ SHOW EVERYTHING: Pass ALL blocks to student work section to catch mixed content
          // The System Prompt's "Mixed Content Strategy" will handle filtering
          const studentWork = rawOcrBlocks;

          let blocksSection = `## RAW OCR BLOCKS (SPATIALLY FILTERED)\nUse these IDs to map the student's work.\n\n`;

          if (landmarks.length > 0) {
            blocksSection += `### 📍 LANDMARKS (REFERENCE ONLY)\n// These are texts that match the Question Prompt. Do NOT grade these.\n`;
            blocksSection += landmarks.map(b => `[${b.id}]: "${b.text.replace(/\n/g, ' ')}"`).join('\n') + `\n\n`;
          }

          if (studentWork.length > 0) {
            blocksSection += `### 📝 POTENTIAL STUDENT WORK (GRADING TARGETS)\n// These blocks were found in the answer zone.\n// NOTE: Mathpix "type" flags are ignored. Determine logic context yourself.\n`;
            blocksSection += studentWork.map(b => `[${b.id}]: "${b.text.replace(/\n/g, ' ')}"`).join('\n') + `\n\n`;
          }

          return blocksSection;
        })() : `
## NO RAW OCR BLOCKS AVAILABLE
Please use the placeholder IDs from STUDENT WORK (e.g., \`line_1\`, \`line_2\`) for the \`line_id\` field.
`}
`,
    },

    // ============================================================================
    // MODEL ANSWER SERVICE PROMPTS (Call #2)
    // ============================================================================

    modelAnswer: {
      system: model_answer_system_prompt,

      user: (questionText: string, schemeText: string, totalMarks?: number, questionNumber?: string) => {
        // schemeText must be plain text (FULL marking scheme - all sub-questions combined, same format as stored in detectedQuestion)
        // Fail-fast if it looks like JSON (old format)
        if (schemeText.trim().startsWith('{') || schemeText.trim().startsWith('[')) {
          throw new Error(`[MODEL ANSWER PROMPT] Invalid marking scheme format: expected plain text, got JSON.Please clear old data and create new sessions.`);
        }

        const marksInfo = totalMarks ? `\n ** TOTAL MARKS:** ${totalMarks} ` : '';

        return `** QUESTION NUMBER:** ${questionNumber || 'Unknown'}
** QUESTION:**
  ${questionText}${marksInfo}

** MARKING SCHEME:**
  ${schemeText}

** WHAT WE PASS TO YOU:**
  - The question text above is already formatted with proper numbering and labels:
  * Main question has number prefix(e.g., "5. Sophie drives...")
  * Sub - questions have labels(e.g., "a) Work out...", "b) Is your answer...")
    * The format is: "{number}. {main question text}\\n\\n{part}) {sub-question text}\\n\\n{part}) {sub-question text}"
      - The marking scheme includes marks for ALL sub - questions combined.

** WHAT WE EXPECT IN YOUR RESPONSE:**
  1. ** Start with "Question ${questionNumber || 'X'}" header ** (use the exact number provided above: ${questionNumber || 'X'}, do NOT infer it from the question text).

2. ** Wrap EACH question text part SEPARATELY in its own < span class="model_question" >...</span> tag:**
  - The question text we pass to you has format: "5. Sophie drives...\n\na) Work out...\n\nb) Is your answer..."
    - ** Main question text:** Remove the "5. " prefix, then wrap the question text in <span class="model_question" > Sophie drives...</span>
      - ** Each sub - question:** Keep the "a)", "b)" label and wrap the entire sub - question text(including label) in its own < span class="model_question" > a) Work out...</span>
        - Example format:
     * <span class="model_question" > Sophie drives a distance of 513 kilometres...</span>
  * <span class="model_question" > a) Work out an estimate...</span>
    * [Model answer for a) with mark codes]
     * <span class="model_question" > b) Is your answer...</span>
  * [Model answer for b) with mark codes]

3. ** After each wrapped sub - question, provide model answers:**
  - For each sub - question, provide the model answer with mark codes(do NOT repeat the sub - question text)
- Format: After < span class="model_question" > a) Work out...</span>, provide [model answer for a with mark codes]
  - Then after < span class="model_question" > b) Is your answer...</span>, provide [model answer for b with mark codes]
    - Each sub - question's model answer should be complete and include all required mark codes.
      - ** IMPORTANT:** Do NOT repeat the sub - question text when providing model answers(it's already in the wrapped span above)

        ** IMPORTANT:**
      - The question text we provide has "5. " prefix and "a)", "b)" labels
      - When wrapping, REMOVE the "5. " prefix from main question text(but keep the text itself)
      - When wrapping sub - questions, KEEP the "a)", "b)" labels
      - Do NOT add "Question" prefix to sub - question labels(they already have "a)", "b)" format)
      - Wrap each part separately and provide model answers after each sub - question span

Please generate a model answer that would receive full marks according to the marking scheme.`;
      }
    },

    // ============================================================================
    // SUGGESTED FOLLOW-UP PROMPTS
    // ============================================================================

    markingScheme: {
      system: marking_scheme_explanation_system_prompt,

      user: (questionText: string, schemeText: string) => {
        // schemeText must be plain text (same format as stored in detectedQuestion)
        // Fail-fast if it looks like JSON (old format)
        if (schemeText.trim().startsWith('{') || schemeText.trim().startsWith('[')) {
          throw new Error(`[MARKING SCHEME PROMPT]Invalid marking scheme format: expected plain text, got JSON.Please clear old data and create new sessions.`);
        }

        return `** QUESTION:**
      ${questionText}

      ** MARKING SCHEME:**
      ${schemeText}

Provide a brief explanation of this marking scheme.Keep it simple and concise.`;
      }
    },
    similarquestions: {
      system: similar_questions_system_prompt,

      user: (questionText: string, schemeJson: string, questionCount?: number) => {
        // Convert JSON marking scheme to clean bulleted list format
        const formattedScheme = formatMarkingSchemeAsBullets(schemeJson);

        // Number of similar questions to generate per original question
        const numSimilarQuestionsPerQuestion = 3;

        // Check if multiple questions are provided
        const hasMultipleQuestions = questionCount && questionCount > 1;

        if (hasMultipleQuestions) {
          return `** ORIGINAL QUESTIONS(${questionCount} questions):**
      ${questionText}

      ** MARKING SCHEMES:**
      ${formattedScheme}

      ** CRITICAL INSTRUCTIONS:**
      - You have received ${questionCount} original questions above
      - You MUST generate ${numSimilarQuestionsPerQuestion} similar practice questions for EACH original question
        - Organize your response by original question number in ascending order(Q1, Q2, Q3, etc.)
          - For each original question, clearly label the section: "**Similar Questions for Question X:**"
            - Under each section, list ${numSimilarQuestionsPerQuestion} similar questions numbered 1, 2, 3
              - Format your response as:

** Similar Questions for Question 1:**

  1.[Similar question 1 for Q1]
2.[Similar question 2 for Q1]
3.[Similar question 3 for Q1]

** Similar Questions for Question 2:**

  1.[Similar question 1 for Q2]
2.[Similar question 2 for Q2]
3.[Similar question 3 for Q2]

... (continue for all ${questionCount} questions)

** IMPORTANT:** Generate similar questions for ALL ${questionCount} questions, not just the first one.`;
        } else {
          return `** ORIGINAL QUESTION:**
  ${questionText}

** MARKING SCHEME:**
  ${formattedScheme}

Generate exactly ${numSimilarQuestionsPerQuestion} similar practice questions.Format your response as:

Similar Practice Questions

${Array.from({ length: numSimilarQuestionsPerQuestion }, (_, i) => `${i + 1}. [Question ${i + 1}]`).join('\n')}
`;
        }
      }
    },
  },








  // ============================================================================
  // ANALYSIS SERVICE PROMPTS
  // ============================================================================

  analysis: {
    system: `You are an expert mathematics tutor analyzing student exam performance.

Your task is to analyze marking results and generate a comprehensive performance report.

** Key Responsibilities:**
  1. Analyze overall performance(score, percentage, grade if available)
  2. Identify key strengths and weaknesses
3. ** CRITICAL - Strategic Grade Improvement Analysis(CONCISE):**
  - If grade boundaries are provided, calculate the exact gap to the next higher grade(or marks to perfect if at highest grade)
   - ** ANALYZE QUESTION - BY - QUESTION RESULTS to identify:**
     * Which specific questions the student got wrong or partially correct
  * Patterns of errors(e.g., calculation errors, method errors, presentation issues)
    * Topics / question types where student consistently struggles
      - Provide a single paragraph with 2 - 3 lines of improvement strategy
        - ** MUST reference SPECIFIC question numbers from WEAK QUESTIONS ** - these show actual student weaknesses
          - Identify what the student usually gets wrong based on the data(e.g., "Q12 geometry shows calculation errors", "Q8 algebra shows method mark losses")
            - Advise how to improve based on actual weaknesses identified in the marked results
              - Focus on top 2 - 3 prioritized actions with specific mark potential
                - Be specific but brief: mention exact question numbers, what went wrong, and how to improve
                  - ** FORMAT: One paragraph, 2 - 3 lines maximum.No bullet points or lists.No generic phrases.**

** If a previous analysis report is provided:**
  - Use it as context to understand the student's progress
    - Build upon the previous analysis, highlighting what has improved
      - Identify areas that still need work
        - Show progression and continuity in your analysis

          ** Output Format:**
            You must return a valid JSON object with the following structure:
{
  "performance": {
    "overallScore": "76/80",
      "percentage": 95,
        "grade": "9",
          "summary": "A comprehensive paragraph summarizing overall performance...",
            "gradeAnalysis": "One paragraph (2-3 lines): State gap to next grade, then list 2-3 prioritized improvement actions with mark potential. Format as continuous text, not bullet points."
  },
  "strengths": [
    "Strong understanding of algebra",
    "Excellent problem-solving skills"
  ],
    "weaknesses": [
      "Struggles with geometry concepts",
      "Needs improvement in statistical analysis"
    ]
}

Keep the analysis concise, educational, and actionable.Focus on helping the student improve.`,

    user: (markingData: string, lastAnalysis?: any) => {
      let prompt = `Analyze the following marking results and generate a comprehensive performance report: \n\n${markingData} `;

      // Add strategic grade improvement instruction
      if (markingData.includes('GRADE BOUNDARIES:') || markingData.includes('GRADE IMPROVEMENT ANALYSIS:')) {
        prompt += `\n\nCRITICAL: For the gradeAnalysis field, provide ONE PARAGRAPH(2 - 3 lines maximum) with improvement strategy: \n`;
        prompt += `- Format as continuous text(no bullet points, no lists) \n`;
        prompt += `- First line: State gap to next grade OR if at highest grade, state marks to perfect score\n`;
        prompt += `- ** CRITICAL: Use the EXACT overall score from "OVERALL PERFORMANCE" section(e.g., ${markingData.includes('Average Score:') ? 'use that exact score' : '76/80'}), NOT the sum of question results **\n`;
        prompt += `- Next 1 - 2 lines: MUST analyze WEAK QUESTIONS to identify what student usually gets wrong\n`;
        prompt += `- Be SPECIFIC: Reference actual question numbers from WEAK QUESTIONS section and explain the weakness(e.g., "Q12 geometry shows calculation errors (3/5, +2 marks available) - focus on double-checking arithmetic. Q8 algebra shows method mark losses (4/5, +1 mark) - show all working steps clearly.") \n`;
        prompt += `- Identify patterns: What type of errors does the student make ? (calculation, method, presentation, understanding) \n`;
        prompt += `- Provide targeted advice: How to fix the specific weaknesses identified in the marked results\n`;
        prompt += `- Avoid generic phrases like "various problem-solving questions" or "check for errors" - reference specific Q numbers and actual weaknesses\n`;
        prompt += `- Keep it brief, specific, and actionable - one flowing paragraph only\n`;
      }

      if (lastAnalysis) {
        prompt += `\n\n-- - PREVIOUS ANALYSIS REPORT-- -\n`;
        prompt += `Summary: ${lastAnalysis.performance?.summary || 'N/A'} \n`;
        prompt += `Strengths: ${lastAnalysis.strengths?.join(', ') || 'N/A'} \n`;
        prompt += `Weaknesses: ${lastAnalysis.weaknesses?.join(', ') || 'N/A'} \n`;
        prompt += `\nPlease build upon this previous analysis, highlighting what has improved and what still needs work.Show progression in the student's learning journey.\n`;
      }

      prompt += `\n\nGenerate a comprehensive analysis report in the JSON format specified in the system prompt.`;

      return prompt;
    }
  },
  // ============================================================================
  // MASTER PERFORMANCE SUMMARY PROMPTS
  // ============================================================================
  masterSummary: {
    system: master_summary_system_prompt,
    user: (distilledData: string) => `Here are the distilled results for the exam paper:\n\n${distilledData}\n\nPlease generate a cohesive master performance summary based on this data.`
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert JSON marking scheme to clean bulleted list format
 */
export function formatMarkingSchemeAsBullets(
  schemeJson: string,
  subQuestionNumbers?: string[],
  subQuestionAnswers?: string[]
): string {
  try {
    // Parse the JSON marking scheme
    const scheme = JSON.parse(schemeJson);

    // CRITICAL: Ensure we only process a single question's scheme
    // If scheme is an array, take only the first one (shouldn't happen, but safety check)
    if (Array.isArray(scheme)) {
      console.warn('[formatMarkingSchemeAsBullets] Received array of schemes, using first one only');
      return formatMarkingSchemeAsBullets(JSON.stringify(scheme[0]), subQuestionNumbers, subQuestionAnswers);
    }

    if (!scheme.marks || !Array.isArray(scheme.marks)) {
      return schemeJson; // Return original if not in expected format
    }

    // Get question-level answer if available (for letter-based answers like "H", "F", "J")
    const questionLevelAnswer = scheme.questionLevelAnswer;

    // For grouped sub-questions, check if marks array has sub-question-specific answers
    // Some marking schemes store answers in marks array with index matching sub-question order
    const marksWithAnswers = scheme.marksWithAnswers || subQuestionAnswers || [];

    // Track "cao" replacement statistics
    const caoReplacements = {
      total: 0,
      succeeded: 0,
      failed: 0
    };

    // Helper function to format marks for a single sub-question
    const formatMarksForSubQuestion = (
      marks: any[],
      subQIndex: number,
      subQNum: string
    ): string => {
      const subQBullets = marks.map((mark: any, localIndex: number) => {
        const globalIndex = (subQIndex * marks.length) + localIndex;
        const markCode = mark.mark || 'M1';
        let answer = mark.answer || '';
        const comments = mark.comments || '';

        // If mark answer is "cao", use sub-question-specific answer
        if (answer.toLowerCase() === 'cao') {
          caoReplacements.total++;
          if (marksWithAnswers && marksWithAnswers[subQIndex]) {
            answer = marksWithAnswers[subQIndex];
            caoReplacements.succeeded++;
          } else {
            caoReplacements.failed++;
          }
        }

        // Combine answer and comments
        const fullText = comments ? `${answer} ${comments}` : answer;

        // Convert LaTeX math expressions to clean Markdown + Inline LaTeX format
        let processedText = fullText;
        processedText = normalizeLatexDelimiters(processedText);
        processedText = processedText.replace(/\$/g, '');
        processedText = processedText.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$\\frac{$1}{$2}$');
        processedText = processedText.replace(/\\times/g, '$\\times$');
        processedText = processedText.replace(/\\div/g, '$\\div$');
        processedText = processedText.replace(/\\pi/g, '$\\pi$');
        processedText = processedText.replace(/\\alpha/g, '$\\alpha$');
        processedText = processedText.replace(/\\beta/g, '$\\beta$');
        processedText = processedText.replace(/\\gamma/g, '$\\gamma$');
        processedText = processedText.replace(/\\delta/g, '$\\delta$');
        processedText = processedText.replace(/\\theta/g, '$\\theta$');
        processedText = processedText.replace(/\\lambda/g, '$\\lambda$');
        processedText = processedText.replace(/\\mu/g, '$\\mu$');
        processedText = processedText.replace(/\\sigma/g, '$\\sigma$');
        processedText = processedText.replace(/\\phi/g, '$\\phi$');
        processedText = processedText.replace(/\\omega/g, '$\\omega$');
        processedText = processedText.replace(/\^(\d+)/g, '^$1');
        processedText = processedText.replace(/\\sqrt\{([^}]+)\}/g, '$\\sqrt{$1}$');
        processedText = processedText.replace(/\\approx/g, '$\\approx$');
        processedText = processedText.replace(/\\approxeq/g, '$\\approxeq$');
        processedText = processedText.replace(/\\leq/g, '$\\leq$');
        processedText = processedText.replace(/\\geq/g, '$\\geq$');
        processedText = processedText.replace(/\\neq/g, '$\\neq$');
        processedText = processedText.replace(/\\pm/g, '$\\pm$');
        processedText = processedText.replace(/\\mp/g, '$\\mp$');
        processedText = processedText.replace(/\\infty/g, '$\\infty$');
        processedText = processedText.replace(/\\sum/g, '$\\sum$');
        processedText = processedText.replace(/\\prod/g, '$\\prod$');
        processedText = processedText.replace(/\\int/g, '$\\int$');
        processedText = processedText.replace(/\\/g, '');

        return `- **${markCode}** ${processedText}`;
      });

      return subQBullets.join('\n');
    };

    // If grouped sub-questions, format with labels
    if (subQuestionNumbers && subQuestionNumbers.length > 0) {
      const sections: string[] = [];

      // CRITICAL: Use sub-question-specific marks mapping if available (prevents mix-up of marks between sub-questions)
      // If subQuestionMarks exists, use it directly; otherwise fall back to even splitting for backward compatibility
      const hasSubQuestionMarks = scheme.subQuestionMarks && typeof scheme.subQuestionMarks === 'object';

      subQuestionNumbers.forEach((subQNum, index) => {
        let subQMarks: any[] = [];

        if (hasSubQuestionMarks) {
          // Use sub-question-specific marks from mapping (e.g., "3a" -> [P1, P1, P1, A1], "3b" -> [C1])
          const subQMarksForThisQ = scheme.subQuestionMarks[subQNum];
          if (Array.isArray(subQMarksForThisQ) && subQMarksForThisQ.length > 0) {
            subQMarks = subQMarksForThisQ;
          } else {
            // Fallback: if mapping doesn't have this sub-question, log warning and use empty array
            console.warn(`[formatMarkingSchemeAsBullets] No marks found in subQuestionMarks for ${subQNum}, using empty array`);
          }
        } else {
          // Fallback to even splitting for backward compatibility (when subQuestionMarks not available)
          const marksPerSubQuestion = Math.ceil(scheme.marks.length / subQuestionNumbers.length);
          const startIndex = index * marksPerSubQuestion;
          const endIndex = Math.min(startIndex + marksPerSubQuestion, scheme.marks.length);
          subQMarks = scheme.marks.slice(startIndex, endIndex);
        }

        const subQBullets = formatMarksForSubQuestion(subQMarks, index, subQNum);
        sections.push(`**SUB-QUESTION ${subQNum.toUpperCase()} MARKS:**\n${subQBullets}`);
      });

      return sections.join('\n\n');
    }

    // Single question - format normally
    // For single questions: find all "cao" marks and match them to marksWithAnswers
    let caoMarkIndices: number[] = [];
    // Always find all "cao" marks (not just when marksWithAnswers exists)
    scheme.marks.forEach((mark: any, index: number) => {
      if (mark.answer && mark.answer.toLowerCase() === 'cao') {
        caoMarkIndices.push(index);
      }
    });

    // Convert each mark to a clean Markdown bullet point
    const bullets = scheme.marks.map((mark: any, index: number) => {
      const markCode = mark.mark || 'M1';
      let answer = mark.answer || '';
      const comments = mark.comments || '';

      // If mark answer is "cao" (correct answer only), try to find the actual answer
      if (answer.toLowerCase() === 'cao') {
        caoReplacements.total++;
        let replacementFound = false;

        // Strategy 1: For single questions, match "cao" marks sequentially to marksWithAnswers
        if (marksWithAnswers && marksWithAnswers.length > 0 && caoMarkIndices.length > 0) {
          const caoIndexInList = caoMarkIndices.indexOf(index);
          if (caoIndexInList >= 0 && caoIndexInList < marksWithAnswers.length) {
            answer = marksWithAnswers[caoIndexInList];
            caoReplacements.succeeded++;
            replacementFound = true;
          } else if (caoIndexInList >= 0 && marksWithAnswers.length > 0) {
            // If more "cao" marks than answers, use the last answer for remaining marks
            answer = marksWithAnswers[marksWithAnswers.length - 1];
            caoReplacements.succeeded++;
            replacementFound = true;
          }
        }

        // Strategy 2: Try direct index match (for non-grouped questions or edge cases)
        if (!replacementFound && marksWithAnswers && marksWithAnswers[index]) {
          answer = marksWithAnswers[index];
          caoReplacements.succeeded++;
          replacementFound = true;
        }

        // Strategy 3: Try question-level answer (for single questions, not grouped sub-questions)
        // Use it for the LAST "cao" mark (or any "cao" mark if there's only one)
        if (!replacementFound && questionLevelAnswer) {
          const isLastCaoMark = caoMarkIndices.length > 0 && index === caoMarkIndices[caoMarkIndices.length - 1];
          const isOnlyCaoMark = caoMarkIndices.length === 1 && index === caoMarkIndices[0];
          // Also use it if there's only one mark total (original behavior)
          const isSingleMark = scheme.marks.length === 1;

          if (isLastCaoMark || isOnlyCaoMark || isSingleMark) {
            answer = questionLevelAnswer;
            caoReplacements.succeeded++;
            replacementFound = true;
          }
        }

        if (!replacementFound) {
          caoReplacements.failed++;
        }
      }

      // Combine answer and comments
      const fullText = comments ? `${answer} ${comments}` : answer;

      // Convert LaTeX math expressions to clean Markdown + Inline LaTeX format
      let processedText = fullText;

      // First, normalize LaTeX delimiters using shared helper (ensures consistency with OCR text)
      processedText = normalizeLatexDelimiters(processedText);

      // Then remove $ delimiters so we can rebuild with consistent formatting
      processedText = processedText.replace(/\$/g, '');

      // Convert LaTeX math expressions to clean inline LaTeX with $ delimiters
      // Convert \frac{a}{b} to $\frac{a}{b}$
      processedText = processedText.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$\\frac{$1}{$2}$');

      // Convert \times to $\times$
      processedText = processedText.replace(/\\times/g, '$\\times$');

      // Convert \div to $\div$
      processedText = processedText.replace(/\\div/g, '$\\div$');

      // Convert \pi to $\pi$
      processedText = processedText.replace(/\\pi/g, '$\\pi$');

      // Convert \alpha, \beta, etc. to $\alpha$, $\beta$, etc.
      processedText = processedText.replace(/\\alpha/g, '$\\alpha$');
      processedText = processedText.replace(/\\beta/g, '$\\beta$');
      processedText = processedText.replace(/\\gamma/g, '$\\gamma$');
      processedText = processedText.replace(/\\delta/g, '$\\delta$');
      processedText = processedText.replace(/\\theta/g, '$\\theta$');
      processedText = processedText.replace(/\\lambda/g, '$\\lambda$');
      processedText = processedText.replace(/\\mu/g, '$\\mu$');
      processedText = processedText.replace(/\\sigma/g, '$\\sigma$');
      processedText = processedText.replace(/\\phi/g, '$\\phi$');
      processedText = processedText.replace(/\\omega/g, '$\\omega$');

      // Convert superscripts to $x^2$ format
      processedText = processedText.replace(/\^(\d+)/g, '^$1');

      // Convert square root to $\sqrt{x}$
      processedText = processedText.replace(/\\sqrt\{([^}]+)\}/g, '$\\sqrt{$1}$');

      // Convert approximation symbol to $\approx$
      processedText = processedText.replace(/\\approx/g, '$\\approx$');
      processedText = processedText.replace(/\\approxeq/g, '$\\approxeq$');

      // Convert other common symbols to inline LaTeX
      processedText = processedText.replace(/\\leq/g, '$\\leq$');
      processedText = processedText.replace(/\\geq/g, '$\\geq$');
      processedText = processedText.replace(/\\neq/g, '$\\neq$');
      processedText = processedText.replace(/\\pm/g, '$\\pm$');
      processedText = processedText.replace(/\\mp/g, '$\\mp$');
      processedText = processedText.replace(/\\infty/g, '$\\infty$');
      processedText = processedText.replace(/\\sum/g, '$\\sum$');
      processedText = processedText.replace(/\\prod/g, '$\\prod$');
      processedText = processedText.replace(/\\int/g, '$\\int$');

      // Clean up any remaining backslashes that aren't part of LaTeX commands
      processedText = processedText.replace(/\\/g, '');

      return `- **${markCode}** ${processedText}`;
    });

    return bullets.join('\n');
  } catch (error) {
    // If parsing fails, return the original JSON
    return schemeJson;
  }
}

/**
 * Get a prompt by path (e.g., 'classification.system', 'marking.questionOnly.user')
 */
export function getPrompt(path: string, ...args: any[]): string {
  const keys = path.split('.');
  let prompt: any = AI_PROMPTS;

  for (const key of keys) {
    prompt = prompt[key];
    if (prompt === undefined) {
      throw new Error(`Prompt not found: ${path}`);
    }
  }

  if (typeof prompt === 'function') {
    return prompt(...args);
  }

  return prompt;
}

/**
 * Get all available prompt paths
 */
export function getPromptPaths(): string[] {
  const paths: string[] = [];

  function traverse(obj: any, prefix: string = '') {
    for (const key in obj) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        traverse(obj[key], currentPath);
      } else {
        paths.push(currentPath);
      }
    }
  }

  traverse(AI_PROMPTS);
  return paths;
}

