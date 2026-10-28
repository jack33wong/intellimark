/**
 * Subject Profile Registry & Declarative Strategy Pattern
 * Routes pipeline behavior between Point-Based subjects (Mathematics)
 * and Level-of-Response subjects (GCSE English Language & English Literature)
 * with zero regressions on existing Maths workflows.
 */

export type SubjectKey = 'MATHS' | 'ENGLISH_LANGUAGE' | 'ENGLISH_LITERATURE';

export type GradingParadigm = 'POINT_BASED' | 'LEVEL_OF_RESPONSE';

export type OcrStrategy = 'MATHPIX_LATEX' | 'VISION_VERBATIM';

export type QuestionScoringType = 'POINT_BASED' | 'SINGLE_AO_LOR' | 'DUAL_AO_LOR';

export interface AOBreakdownItem {
  ao: string;                 // e.g. 'AO1', 'AO2', 'AO4', 'AO5', 'AO6'
  radarAxis?: string;         // e.g. 'AO5 Content & Org', 'AO6 Technical SPaG'
  level?: number;             // e.g. 1, 2, 3, 4
  levelLabel?: string;        // e.g. 'Level 3 (Clear, relevant)'
  awardedMarks: number;
  maxMarks: number;
}

export interface RubricCoachingBlock {
  rationale: string;          // Why this Level was awarded (quoting the student)
  nextLevelGap: string;       // Concrete advice on how to move from Level N -> Level N+1
  upgradeRewrite?: {
    originalQuote: string;    // Verbatim sentence/paragraph from student's work
    upgradedVersion: string;  // Rewritten to Level 4 (Perceptive, detailed) standard
    explanation?: string;     // Brief note on what changed (e.g. zoom-in on connotations)
  };
}

export interface RubricEvaluation {
  scoringType: QuestionScoringType;
  awardedLevel?: number;
  levelLabel?: string;
  awardedMarks: number;
  maxMarks: number;
  rubricStamp: string;        // e.g. "[Level 3 (Clear, relevant) | 6/8 marks]" or "[AO5: 16/24 (L3) + AO6: 12/16 (L3) = 28/40]"
  aoBreakdown: AOBreakdownItem[];
  coaching?: RubricCoachingBlock;
}

export interface SubjectProfile {
  key: SubjectKey;
  displayName: string;
  paradigm: GradingParadigm;
  ocrStrategy: OcrStrategy;
  assessmentObjectives: string[];
  radarAxes: string[];
  overflowBoilerplatePatterns: RegExp[];
}

const COMMON_ENGLISH_OVERFLOW_PATTERNS: RegExp[] = [
  /continues?\s+on\s+(the\s+)?next\s+page/i,
  /answer\s+space\s+continues/i,
  /turn\s+over\s+for\s+(the\s+)?next\s+question/i,
  /extra\s+space\s+(for\s+question|if\s+required)/i,
  /additional\s+page,?\s+if\s+required/i,
  /there\s+are\s+no\s+questions\s+printed\s+on\s+this\s+page/i,
  /if\s+you\s+need\s+extra\s+space\s+for\s+your\s+answer/i,
  /write\s+the\s+question\s+number\s+in\s+the\s+(left-hand\s+)?margin/i,
  /do\s+not\s+write\s+outside\s+the\s+box/i
];

export const SUBJECT_PROFILES: Record<SubjectKey, SubjectProfile> = {
  MATHS: {
    key: 'MATHS',
    displayName: 'Mathematics',
    paradigm: 'POINT_BASED',
    ocrStrategy: 'MATHPIX_LATEX',
    assessmentObjectives: ['AO1', 'AO2', 'AO3'],
    radarAxes: [
      'Number',
      'Algebra',
      'Ratio & Proportion',
      'Geometry',
      'Probability',
      'Statistics'
    ],
    overflowBoilerplatePatterns: [
      /continues?\s+on\s+(the\s+)?next\s+page/i,
      /answer\s+space\s+continues/i,
      /turn\s+over\s+for\s+(the\s+)?next\s+question/i
    ]
  },

  ENGLISH_LANGUAGE: {
    key: 'ENGLISH_LANGUAGE',
    displayName: 'GCSE English Language',
    paradigm: 'LEVEL_OF_RESPONSE',
    ocrStrategy: 'VISION_VERBATIM',
    assessmentObjectives: ['AO1', 'AO2', 'AO3', 'AO4', 'AO5', 'AO6'],
    radarAxes: [
      'AO1 Retrieval',
      'AO2 Language',
      'AO2 Structure',
      'AO4 Evaluation',
      'AO5 Content & Org',
      'AO6 Technical SPaG'
    ],
    overflowBoilerplatePatterns: COMMON_ENGLISH_OVERFLOW_PATTERNS
  },

  ENGLISH_LITERATURE: {
    key: 'ENGLISH_LITERATURE',
    displayName: 'GCSE English Literature',
    paradigm: 'LEVEL_OF_RESPONSE',
    ocrStrategy: 'VISION_VERBATIM',
    assessmentObjectives: ['AO1', 'AO2', 'AO3', 'AO4'],
    radarAxes: [
      'AO1 Critical Response',
      'AO1 Quotations',
      'AO2 Language & Form',
      'AO2 Structure',
      'AO3 Context',
      'AO4 SPaG'
    ],
    overflowBoilerplatePatterns: COMMON_ENGLISH_OVERFLOW_PATTERNS
  }
};

export interface SubjectResolutionHints {
  detectedSubject?: string;
  subject?: string;
  qualification?: string;
  paperCode?: string;
  paperTitle?: string;
  customText?: string;
  fileNames?: string[];
  rawTextHint?: string;
}

/**
 * Deterministically resolves the SubjectProfile as early as possible in the pipeline
 * (before Stage 3 OCR runs, and refined after Question Detection).
 * Always defaults safely to SUBJECT_PROFILES.MATHS if no English signal is present.
 */
export function resolveSubjectProfile(hints: SubjectResolutionHints = {}): SubjectProfile {
  const explicitKey = (hints.detectedSubject || '').trim().toUpperCase();
  if (explicitKey === 'ENGLISH_LANGUAGE') return SUBJECT_PROFILES.ENGLISH_LANGUAGE;
  if (explicitKey === 'ENGLISH_LITERATURE') return SUBJECT_PROFILES.ENGLISH_LITERATURE;
  if (explicitKey === 'MATHS' || explicitKey === 'MATHEMATICS') return SUBJECT_PROFILES.MATHS;

  const combined = [
    hints.paperCode || '',
    hints.subject || '',
    hints.qualification || '',
    hints.paperTitle || '',
    hints.customText || '',
    ...(hints.fileNames || []),
    hints.rawTextHint || ''
  ]
    .join(' | ')
    .toLowerCase();

  if (!combined.trim()) {
    return SUBJECT_PROFILES.MATHS;
  }

  // 1. Check explicit UK GCSE English Literature paper codes & titles (AQA 8702, Edexcel 1ET0, OCR J352, Eduqas C720)
  if (
    /\b(8702|1et0|j352|c720)\b/i.test(combined) ||
    /english\s+literature/i.test(combined) ||
    /\b(macbeth|romeo\s+and\s+juliet|the\s+tempest|merchant\s+of\s+venice|much\s+ado|julius\s+caesar|christmas\s+carol|jekyll\s+and\s+hyde|sign\s+of\s+four|great\s+expectations|jane\s+eyre|frankenstein|pride\s+and\s+prejudice|inspector\s+calls|blood\s+brothers|lord\s+of\s+the\s+flies|animal\s+farm|power\s+and\s+conflict|love\s+and\s+relationships|unseen\s+poetry)\b/i.test(combined)
  ) {
    return SUBJECT_PROFILES.ENGLISH_LITERATURE;
  }

  // 2. Check explicit UK GCSE English Language paper codes & titles (AQA 8700, Edexcel 1EN0, OCR J351, Eduqas C700)
  if (
    /\b(8700|1en0|j351|c700)\b/i.test(combined) ||
    /english\s+language/i.test(combined) ||
    /explorations\s+in\s+creative\s+reading\s+and\s+writing/i.test(combined) ||
    /writers['’]?\s+viewpoints\s+and\s+perspectives/i.test(combined) ||
    (/source\s+a\b/i.test(combined) && /how\s+does\s+the\s+writer\s+use\s+(language|structure)/i.test(combined))
  ) {
    return SUBJECT_PROFILES.ENGLISH_LANGUAGE;
  }

  return SUBJECT_PROFILES.MATHS;
}

/**
 * Determines whether a specific question result / scheme uses Level-of-Response (LoR) grading
 * rather than additive point-summing.
 * Note: Inside an English Language paper, Question 1 (4 marks AO1 retrieval) is point-based,
 * whereas Questions 2-5 and Literature essays are Level-of-Response.
 */
export function isLevelOfResponseQuestion(
  schemeOrTask?: any,
  profile?: SubjectProfile,
  rubricEvaluation?: RubricEvaluation | null
): boolean {
  if (rubricEvaluation) {
    return rubricEvaluation.scoringType === 'SINGLE_AO_LOR' || rubricEvaluation.scoringType === 'DUAL_AO_LOR';
  }

  const scoringType = schemeOrTask?.scoringType || schemeOrTask?.markingScheme?.scoringType;
  if (scoringType === 'SINGLE_AO_LOR' || scoringType === 'DUAL_AO_LOR') {
    return true;
  }
  if (scoringType === 'POINT_BASED') {
    return false;
  }

  if (
    schemeOrTask?.levels ||
    schemeOrTask?.markingScheme?.levels ||
    schemeOrTask?.levelDescriptors ||
    schemeOrTask?.markingScheme?.levelDescriptors
  ) {
    return true;
  }

  if (profile?.paradigm === 'LEVEL_OF_RESPONSE') {
    // Check if this is Q1 short retrieval (<= 4 marks) without LoR descriptors
    const qNum = String(schemeOrTask?.questionNumber || '').replace(/[^0-9]/g, '');
    const totalMarks = Number(schemeOrTask?.totalMarks || schemeOrTask?.markingScheme?.totalMarks || 0);
    if (profile.key === 'ENGLISH_LANGUAGE' && qNum === '1' && totalMarks > 0 && totalMarks <= 4) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Maps an AO code (and optional question number / context) to its canonical Radar Axis name
 * for a given SubjectProfile.
 */
export function mapAoToRadarAxis(
  aoCode: string,
  profile: SubjectProfile,
  questionNumber?: string,
  questionText?: string
): string {
  const cleanAo = (aoCode || '').toUpperCase().trim();
  const qNum = String(questionNumber || '').replace(/[^0-9]/g, '');
  const qTextLower = (questionText || '').toLowerCase();

  if (profile.key === 'ENGLISH_LANGUAGE') {
    if (cleanAo.includes('AO1')) return 'AO1 Retrieval';
    if (cleanAo.includes('AO2')) {
      if (qNum === '3' || /structure|structural|whole\s+of\s+the\s+source/i.test(qTextLower) || /structure/i.test(aoCode)) {
        return 'AO2 Structure';
      }
      return 'AO2 Language';
    }
    if (cleanAo.includes('AO3')) return 'AO4 Evaluation';
    if (cleanAo.includes('AO4')) return 'AO4 Evaluation';
    if (cleanAo.includes('AO5')) return 'AO5 Content & Org';
    if (cleanAo.includes('AO6')) return 'AO6 Technical SPaG';

    // Fallback by question number for AQA 8700
    if (qNum === '1') return 'AO1 Retrieval';
    if (qNum === '2') return 'AO2 Language';
    if (qNum === '3') return 'AO2 Structure';
    if (qNum === '4') return 'AO4 Evaluation';
    if (qNum === '5') return 'AO5 Content & Org';
    return profile.radarAxes[0];
  }

  if (profile.key === 'ENGLISH_LITERATURE') {
    if (cleanAo.includes('AO1')) {
      if (/quot|reference|evidence/i.test(aoCode)) return 'AO1 Quotations';
      return 'AO1 Critical Response';
    }
    if (cleanAo.includes('AO2')) {
      if (/structure/i.test(aoCode)) return 'AO2 Structure';
      return 'AO2 Language & Form';
    }
    if (cleanAo.includes('AO3')) return 'AO3 Context';
    if (cleanAo.includes('AO4')) return 'AO4 SPaG';
    return profile.radarAxes[0];
  }

  return profile.radarAxes[0];
}
