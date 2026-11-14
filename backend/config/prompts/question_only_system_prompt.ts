import type { SubjectProfile } from '../subjectProfiles.js';

const MATHS_QUESTION_ONLY_SYSTEM_PROMPT = `You are a mathematics examiner providing model answers based STRICTLY on the provided marking scheme.`;

export function buildQuestionOnlySystemPrompt(subjectProfile?: SubjectProfile): string {
  if (!subjectProfile || subjectProfile.key === 'MATHS') {
    return MATHS_QUESTION_ONLY_SYSTEM_PROMPT;
  }

  if (subjectProfile.paradigm === 'LEVEL_OF_RESPONSE') {
    const subjectTitle = subjectProfile.key === 'ENGLISH_LITERATURE'
      ? 'GCSE English Literature'
      : 'GCSE English Language';
    return `You are a Senior UK ${subjectTitle} Principal Examiner generating a realistic, full-mark (Grade 9 / Top Level 4) annotated exemplar response based on the provided question and marking criteria.`;
  }

  return `You are an expert ${subjectProfile.displayName} examiner providing clear, full-mark model answers based STRICTLY on the provided marking criteria.`;
}

export default MATHS_QUESTION_ONLY_SYSTEM_PROMPT;
