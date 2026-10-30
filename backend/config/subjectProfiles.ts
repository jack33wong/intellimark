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

export const ENGLISH_LANGUAGE_P1_RADAR_AXES = [
  'AO1 Retrieval',
  'AO2 Language',
  'AO2 Structure',
  'AO4 Evaluation',
  'AO5 Content & Org',
  'AO6 Technical SPaG'
];

export const ENGLISH_LANGUAGE_P2_RADAR_AXES = [
  'AO1 Retrieval',
  'AO1 Synthesis',
  'AO2 Language',
  'AO3 Comparison',
  'AO5 Content & Org',
  'AO6 Technical SPaG'
];

export function isPaper2EnglishLanguage(hints?: any): boolean {
  if (!hints) return false;
  const str = typeof hints === 'string'
    ? hints
    : [hints.examCode, hints.paperCode, hints.paperTitle, hints.subject, hints.qualification, hints.customText].filter(Boolean).join(' ');
  if (/8700\/?2|1EN0\/?0?2|J351\/?0?2|Paper\s*2|writers['’]?\s+viewpoints|transactional\s+writing|exploring\s+effects/i.test(str)) {
    return true;
  }
  if (typeof hints === 'object') {
    if (hints.isPaper2) return true;
    if (Array.isArray(hints.radarAxes) && hints.radarAxes.some((a: string) => /AO3|Synthesis/i.test(a))) {
      return true;
    }
    if (Array.isArray(hints.questions)) {
      const hasAo3 = hints.questions.some((q: any) => {
        const aos = q.assessmentObjectives || q.assessment_objectives || q.rubricEvaluation?.aoBreakdown?.map((a: any) => a.ao) || [];
        return Array.isArray(aos) && aos.some((a: string) => /AO3/i.test(String(a)));
      });
      if (hasAo3) return true;
    }
  }
  return false;
}

export function getEnglishLanguageRadarAxes(hints?: any): string[] {
  return isPaper2EnglishLanguage(hints) ? ENGLISH_LANGUAGE_P2_RADAR_AXES : ENGLISH_LANGUAGE_P1_RADAR_AXES;
}

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
    radarAxes: ENGLISH_LANGUAGE_P1_RADAR_AXES,
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

  // 2. Check explicit & generic UK GCSE English Language paper codes, titles, and task prompts
  if (
    /\b(8700|1en0|j351|c700)\b/i.test(combined) ||
    /english\s+language/i.test(combined) ||
    /communicating\s+information\s+and\s+ideas/i.test(combined) ||
    /exploring\s+effects\s+and\s+impact/i.test(combined) ||
    /explorations\s+in\s+creative\s+reading\s+and\s+writing/i.test(combined) ||
    /writers['’]?\s+viewpoints\s+and\s+perspectives/i.test(combined) ||
    /how\s+(does|has)\s+the\s+writer\s+(use|used|structured)\s+(language|structure)/i.test(combined) ||
    /to\s+what\s+extent\s+do\s+you\s+agree[\s\S]{0,120}(writer|methods|reader|statement)/i.test(combined) ||
    /write\s+a\s+(description|story|narrative|speech|letter|article|leaflet|essay)\s+(of|about|arguing|to|for|with|set|based|as\s+suggested\s+by)/i.test(combined) ||
    /\b(ao1|ao2|ao3|ao4|ao5|ao6)\b[\s\S]{0,80}\b(level\s+[1-4]|perceptive|spag|technical\s+accuracy)\b/i.test(combined)
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
  questionText?: string,
  hints?: any
): string {
  const cleanAo = (aoCode || '').toUpperCase().trim();
  const qNum = String(questionNumber || '').replace(/[^0-9]/g, '');
  const qTextLower = (questionText || '').toLowerCase();
  const isP2 = isPaper2EnglishLanguage(hints) ||
    /synthesis|synthesise|comparison|compare/i.test(aoCode) ||
    /synthesis|synthesise|comparison|compare/i.test(qTextLower) ||
    (hints?.radarAxes && Array.isArray(hints.radarAxes) && hints.radarAxes.includes('AO3 Comparison'));

  if (profile.key === 'ENGLISH_LANGUAGE') {
    if (cleanAo.includes('AO5')) return 'AO5 Content & Org';
    if (cleanAo.includes('AO6')) return 'AO6 Technical SPaG';

    // Deterministic Paper 2 (8700/2, 1EN0/02) Question-to-AO mapping
    if (isP2) {
      if (qNum === '1') return 'AO1 Retrieval';
      if (qNum === '2') return 'AO1 Synthesis';
      if (qNum === '3') return 'AO2 Language';
      if (qNum === '4' || cleanAo.includes('AO3') || cleanAo.includes('AO4')) return 'AO3 Comparison';
      if (cleanAo.includes('AO1')) {
        return /synthesis|synthesise|similarit|differen|summary/i.test(qTextLower + ' ' + aoCode)
          ? 'AO1 Synthesis'
          : 'AO1 Retrieval';
      }
      if (cleanAo.includes('AO2')) return 'AO2 Language';
      return 'AO5 Content & Org';
    }

    // Paper 1 (8700/1) mapping
    if (cleanAo.includes('AO1')) return 'AO1 Retrieval';
    if (cleanAo.includes('AO2')) {
      if (qNum === '3' || /structure|structural|whole\s+of\s+the\s+source/i.test(qTextLower + ' ' + aoCode)) {
        return 'AO2 Structure';
      }
      return 'AO2 Language';
    }
    if (cleanAo.includes('AO3') || cleanAo.includes('AO4')) return 'AO4 Evaluation';

    // Fallback by question number for Paper 1
    if (qNum === '1') return 'AO1 Retrieval';
    if (qNum === '2') return 'AO2 Language';
    if (qNum === '3') return 'AO2 Structure';
    if (qNum === '4') return 'AO4 Evaluation';
    if (qNum === '5' || qNum === '6') return 'AO5 Content & Org';
    return ENGLISH_LANGUAGE_P1_RADAR_AXES[0];
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

export function buildUniversalEnglishRubricFallback(params: {
  subjectKey?: SubjectKey;
  questionNumber?: string;
  questionText?: string;
  totalMarks?: number;
}): string {
  const {
    subjectKey = 'ENGLISH_LANGUAGE',
    questionNumber = '1',
    questionText = '',
    totalMarks = 0
  } = params;
  const qNum = String(questionNumber).replace(/[^0-9]/g, '');
  const qLower = questionText.toLowerCase();

  if (subjectKey === 'ENGLISH_LITERATURE') {
    const maxM = totalMarks > 0 ? totalMarks : 30;
    return `[UNIVERSAL GCSE ENGLISH LITERATURE LEVEL-OF-RESPONSE RUBRIC (Max ${maxM} marks)]
- Assess AO1 (Critical, exploratory response to text & task with precise references/quotations), AO2 (Analysis of writer's methods—language, form, and structure—using subject terminology), and AO3 (Understanding of relationship between ideas and historical/social/literary context). If totalMarks > 30 (e.g. 34 marks), award up to 4 marks for AO4 (Vocabulary, sentence structure, spelling, and punctuation).
- Level 4 (Top Band, ~76-100% of marks): Conceptualised, convincing, critical response; judicious references; perceptive analysis of writer's methods and context.
- Level 3 (Upper-Mid Band, ~51-75% of marks): Clear, explained response; apt references; clear explanation of writer's methods and relevant context.
- Level 2 (Lower-Mid Band, ~26-50% of marks): Some supported response; some appropriate references; some identification of writer's methods/context.
- Level 1 (Bottom Band, ~1-25% of marks): Simple, limited narrative comment; simple references.`;
  }

  // 1. Detect Creative / Transactional Writing (Section B / Q5 / 24-40 marks)
  const isWritingTask =
    totalMarks >= 24 ||
    qNum === '5' ||
    qNum === '6' ||
    /write\s+a\s+(description|story|narrative|speech|letter|article|leaflet|report|review)/i.test(qLower) ||
    /content\s+and\s+organisation[\s\S]*technical\s+accuracy/i.test(qLower);

  if (isWritingTask) {
    const effectiveTotal = totalMarks >= 24 ? totalMarks : 40;
    const ao5Max = effectiveTotal === 40 ? 24 : Math.round(effectiveTotal * 0.6);
    const ao6Max = effectiveTotal - ao5Max;
    return `[UNIVERSAL GCSE ENGLISH LANGUAGE WRITING RUBRIC — DUAL-AO (${effectiveTotal} Marks = AO5: ${ao5Max} marks + AO6: ${ao6Max} marks)]
1. AO5 Content & Organisation (${ao5Max} marks) — Radar Axis: "AO5 Content & Org":
   - Level 4 (Compelling, Convincing | ${Math.round(ao5Max * 0.76)}-${ao5Max} marks): Communication is convincing and compelling; tone, style, and register assuredly matched to purpose and audience; extensive vocabulary with sustained crafting of linguistic devices; varied and inventive structural features (e.g. cyclical structure, shifts in focus/pace) with fluently linked paragraphs.
   - Level 3 (Consistent, Clear | ${Math.round(ao5Max * 0.51)}-${Math.round(ao5Max * 0.75)} marks): Communication is consistently clear and effective; tone/register matched to audience; increasingly sophisticated vocabulary and successful linguistic devices; coherent paragraphs with integrated discourse markers.
   - Level 2 (Some Success | ${Math.round(ao5Max * 0.26)}-${Math.round(ao5Max * 0.5)} marks): Communicates with some sustained success; attempts to match tone/register and vary vocabulary; some linked ideas and paragraphing.
   - Level 1 (Simple, Limited | 1-${Math.round(ao5Max * 0.25)} marks): Simple communication and vocabulary; limited structural features or random paragraphing.
2. AO6 Technical Accuracy / SPaG (${ao6Max} marks) — Radar Axis: "AO6 Technical SPaG":
   - Level 4 (${Math.round(ao6Max * 0.76)}-${ao6Max} marks): Sentence demarcation consistently secure; wide range of ambitious punctuation (colons, semicolons, dashes) and sentence forms used for effect; high accuracy in spelling including ambitious vocabulary.
   - Level 3 (${Math.round(ao6Max * 0.51)}-${Math.round(ao6Max * 0.75)} marks): Sentence demarcation mostly secure; range of punctuation and sentence forms used mostly with success; generally accurate spelling of complex words.
   - Level 2 (${Math.round(ao6Max * 0.26)}-${Math.round(ao6Max * 0.5)} marks): Some control of punctuation and sentence variety; accurate basic spelling.
   - Level 1 (1-${Math.round(ao6Max * 0.25)} marks): Occasional sentence demarcation; simple range of sentence forms.`;
  }

  // 2. Detect 4-Mark Point-Based Retrieval (Q1)
  if ((totalMarks > 0 && totalMarks <= 4) || (qNum === '1' && /list\s+four\s+things|choose\s+four\s+statements/i.test(qLower))) {
    const maxM = totalMarks > 0 ? totalMarks : 4;
    return `[UNIVERSAL GCSE ENGLISH LANGUAGE AO1 RETRIEVAL RUBRIC (${maxM} Marks — POINT_BASED)]
- Award 1 mark for each valid, accurate piece of explicit/implicit information or correct statement identified from the specified lines (up to ${maxM} marks). Set scoringType to "POINT_BASED" and upgradeRewrite to null.`;
  }

  // 3. Detect Single-AO Reading Analysis / Synthesis / Comparison / Evaluation (Q2, Q3, Q4)
  const isComparison = /compare\s+how\s+the\s+writers|both\s+texts|source\s+a\s+and\s+source\s+b/i.test(qLower);
  const isSynthesis = /summary\s+of\s+what\s+you\s+understand|similarities|differences\s+between/i.test(qLower) && totalMarks <= 10;
  const isEvaluation = /to\s+what\s+extent\s+do\s+you\s+agree|evaluate\s+how/i.test(qLower) || totalMarks >= 18;
  const isStructure = /structured\s+the\s+text|structural\s+features/i.test(qLower);

  const targetAo = isComparison ? 'AO3' : isEvaluation ? 'AO4' : isSynthesis ? 'AO1' : 'AO2';
  const targetAxis = isComparison
    ? 'AO3 Comparison'
    : isEvaluation
      ? 'AO4 Evaluation'
      : isSynthesis
        ? 'AO1 Synthesis'
        : isStructure
          ? 'AO2 Structure'
          : 'AO2 Language';
  const effectiveMarks = totalMarks > 0 ? totalMarks : (isEvaluation ? 20 : isComparison ? 16 : 8);

  return `[UNIVERSAL GCSE ENGLISH LANGUAGE ${targetAo} LEVEL-OF-RESPONSE RUBRIC (${effectiveMarks} Marks — Radar Axis: "${targetAxis}")]
- Level 4 (Perceptive, Detailed | ${Math.round(effectiveMarks * 0.76)}-${effectiveMarks} marks): Shows perceptive, detailed understanding; analyses subtle effects of the writer's choices/methods; selects judicious textual quotations; makes sophisticated and accurate use of subject terminology.
- Level 3 (Clear, Relevant | ${Math.round(effectiveMarks * 0.51)}-${Math.round(effectiveMarks * 0.75)} marks): Shows clear, explained understanding; explains clearly the effects of the writer's choices/methods; selects relevant textual quotations; makes clear and accurate use of subject terminology.
- Level 2 (Some, Attempts | ${Math.round(effectiveMarks * 0.26)}-${Math.round(effectiveMarks * 0.5)} marks): Shows some understanding; attempts to comment on the effect of methods; selects some appropriate textual references; some use of subject terminology.
- Level 1 (Simple, Limited | 1-${Math.round(effectiveMarks * 0.25)} marks): Shows simple awareness; offers simple descriptive/narrative comment; selects simple references.`;
}
