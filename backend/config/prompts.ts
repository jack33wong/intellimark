import marking_basic_system_prompt from './prompts/marking_basic_system_prompt.js';
import marking_scheme_system_prompt from './prompts/marking_scheme_system_prompt.js';
import question_only_system_prompt from './prompts/question_only_system_prompt.js';
import question_only_user_prompt from './prompts/question_only_user_prompt.js';
import contextual_system_prompt from './prompts/contextual_system_prompt.js';
import model_answer_system_prompt from './prompts/model_answer_system_prompt.js';
import marking_scheme_explanation_system_prompt from './prompts/marking_scheme_explanation_system_prompt.js';
import similar_questions_system_prompt from './prompts/similar_questions_system_prompt.js';
import master_summary_system_prompt from './prompts/master_summary_system_prompt.js';
import classification_light_system_prompt from './prompts/classification_light_system_prompt.js';
import classification_mapper_system_prompt from './prompts/classification_mapper_system_prompt.js';
import classification_system_prompt from './prompts/classification_system_prompt.js';
import { normalizeLatexDelimiters } from '../utils/TextNormalizationUtils.js';

/**
 * Interface and Types for AI Prompting System
 * All prompts are stored here and resolved by the getPrompt utility.
 * Braces MUST be perfectly balanced to prevent runtime errors.
 */
export const AI_PROMPTS = {
  // ============================================================================
  // CLASSIFICATION SERVICE PROMPTS
  // ============================================================================
  classification: {
    mapper: {
      system: (imageCount: number) => classification_mapper_system_prompt.replace('{{IMAGE_COUNT}}', imageCount.toString()),
      user: (imageCount: number) => `Please scan these ${imageCount} pages and list out every printed question number you see (e.g. 1a, 1b, 2, 3...) in the order they appear.`
    },
    light: {
      system: classification_light_system_prompt,
      user: `Please extract all printed question text from the provided image. Ignore any handwritten marks, annotations, or student work. Respond with ONLY the question text.`
    },
    heavy: {
      system: classification_system_prompt,
      user: `Please classify the image and extract the question text verbatim, including any mathematical expressions in LaTeX.`
    }
  },

  // ============================================================================
  // AI MARKING SERVICE PROMPTS (QUESTION MODE)
  // ============================================================================
  marking: {
    questionOnly: {
      system: question_only_system_prompt,
      user: (message: string, markingScheme: string) => question_only_user_prompt
        .replace('{{QUESTION_TEXT}}', message)
        .replace('{{MARKING_SCHEME}}', markingScheme)
    },
    contextual: {
      system: contextual_system_prompt,
      user: (message: string, contextPrompt: string) => `You are helping a student. Based on the following context, help them with this question: "${message}"\n\nContext:\n${contextPrompt}`
    }
  },

  // ============================================================================
  // MARKING INSTRUCTION SERVICE PROMPTS (MARKING FLOW)
  // ============================================================================
  markingInstructions: {
    withMarkingScheme: {
      system: (isGeneric: boolean = false) => marking_scheme_system_prompt(isGeneric),
      user: (qNum: string, scheme: string, studentWork: string, blocks: any, questionText: string, pageMap: any, guidance: string, isGeneric: boolean) => {
        return `# MARKING TASK: Question ${qNum}
        
## QUESTION TEXT
${questionText}

## MARKING SCHEME
${scheme}

## STUDENT WORK
${studentWork}

## RAW OCR BLOCKS
Use these IDs to map the student's work. Match them yourself based on the Semantic Fidelity Rules.

${Array.isArray(blocks) && blocks.length > 0 ? (
            blocks.map(b => `[${b.id}]: "${(b.text || '').replace(/\n/g, ' ')}"`).join('\n')
          ) : (typeof blocks === 'string' ? blocks : 'No raw OCR blocks available.')}

## PAGE MAP
${JSON.stringify(pageMap)}

${guidance}`;
      }
    },
    basic: {
      system: marking_basic_system_prompt,
      user: (ocrText: string, classificationStudentWork: string) => {
        return `OCR TEXT:\n${ocrText}\n\nCLASSIFICATION STUDENT WORK:\n${classificationStudentWork}`;
      }
    }
  },

  // ============================================================================
  // ANALYSIS SERVICE PROMPTS
  // ============================================================================
  analysis: {
    system: `You are an expert mathematics tutor analyzing student exam performance. 
    Your goal is to provide a structured, strategic analysis of the student's results.
    
    OUTPUT RULES:
    1. Respond with valid JSON only.
    2. Include "performance" object with "overallScore" (string), "percentage" (number), "summary" (string), and "gradeAnalysis" (optional string).
    3. Include "strengths" (array of strings) and "weaknesses" (array of strings).
    4. "summary" should be 3-4 sentences highlighting the main points.
    5. "gradeAnalysis" should focus on strategic mark gains needed for the next grade boundary.`,
    user: (formattedData: string, lastAnalysisReport?: any) => {
      let prompt = `Please analyze the following marking results and grade boundaries:\n\n${formattedData}`;
      if (lastAnalysisReport) {
        prompt += `\n\nPrevious Analysis context for continuity:\n${JSON.stringify(lastAnalysisReport)}`;
      }
      return prompt;
    }
  },

  // ============================================================================
  // MASTER PERFORMANCE SUMMARY PROMPTS
  // ============================================================================
  masterSummary: {
    system: master_summary_system_prompt,
    user: (distilledData: string) => `Generate a master performance summary for this paper based on the following distilled data:\n\n${distilledData}`
  },

  // ============================================================================
  // SUGGESTED FOLLOW-UP PROMPTS (Root Level for Orchestration)
  // ============================================================================
  markingScheme: {
    system: marking_scheme_explanation_system_prompt,
    user: (questionText: string, schemeText: string, questionNumber: string, totalMarks?: number) => {
      return `# TASK DATA
QUESTION NUMBER: ${questionNumber}
MAX MARKS: ${totalMarks || 0}

## QUESTION TEXT
${questionText}

## MARKING SCHEME
${schemeText}

Please provide a clear, pedagogical explanation of the marking scheme for a student. Group sub-questions under the main question header.`;
    }
  },

  modelAnswer: {
    system: model_answer_system_prompt,
    user: (questionText: string, schemeText: string, totalMarks?: number, questionNumber?: string) => {
      return `# TASK DATA
QUESTION NUMBER: ${questionNumber || 'Unknown'}
MAX MARKS: ${totalMarks || 0}

## QUESTION TEXT
${questionText}

## MARKING SCHEME
${schemeText}

Please generate a perfect model answer following the scheme. CRITICAL: Follow all HTML styling rules for headers and answer blocks.`;
    }
  },

  similarquestions: {
    system: similar_questions_system_prompt,
    user: (questionText: string, schemeJson: string, questionCount: number = 3) => {
      const scheme = formatMarkingSchemeAsBullets(schemeJson);
      return `# TASK DATA
QUESTION COUNT: ${questionCount}

## ORIGINAL QUESTION TEXT
${questionText}

## MARKING SCHEME
${scheme}

Please generate ${questionCount} similar practice questions that test the same skills but with different numbers or scenarios.`;
    }
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Utility to format marking scheme JSON as readable bullet points
 */
export function formatMarkingSchemeAsBullets(schemeJson: any, subQuestionNumbers?: string[], subQuestionAnswers?: string[]): string {
  if (!schemeJson) return 'No marking scheme available.';
  try {
    const scheme = typeof schemeJson === 'string' ? JSON.parse(schemeJson) : schemeJson;
    let marks = scheme.marks || [];
    if (!Array.isArray(marks)) return typeof schemeJson === 'string' ? schemeJson : JSON.stringify(schemeJson);

    // Filter by sub-questions if provided
    if (subQuestionNumbers && subQuestionNumbers.length > 0) {
      marks = marks.filter((m: any) => !m.subQuestion || subQuestionNumbers.includes(m.subQuestion));
    }

    return marks.map((m: any) => `- ${m.mark || 'Mark'}${m.subQuestion ? ` (${m.subQuestion})` : ''}: ${m.answer || m.text || ''}`).join('\n');
  } catch (e) {
    return String(schemeJson);
  }
}

/**
 * Resolves a prompt path to its final string content
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
 * Returns the valid paths for all prompts in the system
 */
export function getPromptPaths(): string[] {
  const paths: string[] = [];
  const traverse = (obj: any, currentPath: string = '') => {
    for (const key in obj) {
      const path = currentPath ? `${currentPath}.${key}` : key;
      // Skip utility fields or templates that look like templates but aren't prompt holders
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Only traverse if it doesn't look like a leaf prompt object (which has system/user)
        if (obj[key].system || obj[key].user) {
          paths.push(currentPath);
        } else {
          traverse(obj[key], currentPath);
        }
      }
    }
  }

  traverse(AI_PROMPTS);
  return paths;
}
