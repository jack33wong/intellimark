/**
 * Ingestion Script: Converts GCSE English Past Paper PDFs to JSON and Upserts to Firestore
 * 
 * Supports:
 *   - AQA (e.g. 8700/1, 8700/2, 8702/1, 8702/2)
 *   - Pearson Edexcel (e.g. 1EN0/01, 1EN0/02)
 *   - OCR (extensible architecture ready for J351)
 * 
 * Uses Google AI Studio (Gemini 3.7 Flash) via `@google/genai`
 * 
 * Usage:
 *   npx tsx scripts/ingest_past_paper.ts --dir="/path/to/folder"
 *   npx tsx scripts/ingest_past_paper.ts --dir="/path/to/folder" --dry-run
 *   npx tsx scripts/ingest_past_paper.ts --dir="/path/to/folder" --board="EDEXCEL"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import JSON5 from 'json5';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables (.env.local in backend takes precedence, matching server.ts)
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

export type SupportedBoard = 'AQA' | 'EDEXCEL' | 'OCR';

interface IngestionArgs {
  dir?: string;
  qp?: string;
  ins?: string;
  ms?: string;
  er?: string;
  model: string;
  dryRun: boolean;
  outDir: string;
  help: boolean;
  apiKey?: string;
  series?: string;
  paper?: string;
  board?: SupportedBoard;
}

function parseArgs(): IngestionArgs {
  const args = process.argv.slice(2);
  const result: IngestionArgs = {
    model: 'gemini-3.7-flash',
    dryRun: false,
    outDir: path.join(__dirname, '..', 'data', 'english'),
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg.startsWith('--dir=')) {
      result.dir = arg.split('=')[1];
    } else if (arg.startsWith('--qp=')) {
      result.qp = arg.split('=')[1];
    } else if (arg.startsWith('--ins=')) {
      result.ins = arg.split('=')[1];
    } else if (arg.startsWith('--ms=')) {
      result.ms = arg.split('=')[1];
    } else if (arg.startsWith('--er=')) {
      result.er = arg.split('=')[1];
    } else if (arg.startsWith('--model=')) {
      result.model = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      result.outDir = arg.split('=')[1];
    } else if (arg.startsWith('--key=')) {
      result.apiKey = arg.split('=')[1];
    } else if (arg.startsWith('--series=')) {
      result.series = arg.split('=')[1];
    } else if (arg.startsWith('--paper=')) {
      result.paper = arg.split('=')[1];
    } else if (arg.startsWith('--board=')) {
      result.board = arg.split('=')[1].toUpperCase() as SupportedBoard;
    }
  }

  return result;
}

export interface PaperJob {
  paperCode: string;
  board: SupportedBoard;
  qp?: string;
  ins?: string;
  ms?: string;
  er?: string;
}

// ---------------------------------------------------------------------------
// Board Profiles Architecture (AQA, Edexcel, and extensible for OCR)
// ---------------------------------------------------------------------------

interface BoardProfile {
  board: SupportedBoard;
  displayName: string;
  detect(context: string): boolean;
  parsePaperCode(filename: string): { key: string; paperCode: string } | null;
  parseFileRole(filename: string): 'qp' | 'ins' | 'ms' | 'er' | null;
  buildQpPrompt(paperCode: string, series: string, hasSeparateInsert: boolean): string;
  buildMsPrompt(paperCode: string, series: string): string;
  buildErPrompt(paperCode: string, series: string): string;
}

const AQA_PROFILE: BoardProfile = {
  board: 'AQA',
  displayName: 'AQA (Assessment and Qualifications Alliance)',
  detect(context: string) {
    return /aqa|8700|8702/i.test(context);
  },
  parsePaperCode(filename: string) {
    const lower = filename.toLowerCase();
    const aqaMatch = lower.match(/(?:aqa[-_]?)?(870[02])([12])/);
    if (aqaMatch) {
      return { key: `${aqaMatch[1]}/${aqaMatch[2]}`, paperCode: `${aqaMatch[1]}/${aqaMatch[2]}` };
    }
    const codeMatch = lower.match(/(870[02])[-_/ ]?([12])/);
    if (codeMatch) {
      return { key: `${codeMatch[1]}/${codeMatch[2]}`, paperCode: `${codeMatch[1]}/${codeMatch[2]}` };
    }
    const paperMatch = lower.match(/(?:paper|p)[-_ ]?([12])/);
    if (paperMatch) {
      return { key: `8700/${paperMatch[1]}`, paperCode: `8700/${paperMatch[1]}` };
    }
    return { key: '8700/1', paperCode: '8700/1' };
  },
  parseFileRole(filename: string) {
    const lower = filename.toLowerCase();
    if (lower.includes('ins') || lower.includes('insert') || lower.includes('source')) return 'ins';
    if (lower.includes('ms') || lower.includes('mark') || lower.includes('scheme')) return 'ms';
    if (lower.includes('wre') || lower.includes('er') || lower.includes('examiner') || lower.includes('report')) return 'er';
    if (lower.includes('qp') || lower.includes('question') || lower.includes('paper')) return 'qp';
    return null;
  },
  buildQpPrompt(paperCode: string, series: string, hasSeparateInsert: boolean) {
    return `Convert the attached GCSE English Question Paper PDF (${hasSeparateInsert ? 'and Reading Insert' : 'with internal reading extracts'}) into a single valid JSON object for the fullExamPapers collection.
Return ONLY raw JSON following this exact schema:

{
  "metadata": {
    "exam_board": "AQA",
    "qualification": "GCSE",
    "subject": "English Language",
    "exam_code": "${paperCode}",
    "exam_series": "${series}",
    "tier": "N/A",
    "paper_title": "Full title of paper (e.g. Paper 1 Explorations in creative reading and writing or Paper 2 Writers viewpoints and perspectives)",
    "date": "STRING (e.g. 05 November 2024)",
    "time_allowed": "1 hour 45 minutes",
    "total_questions": 5,
    "total_marks": 80
  },
  "sourceExtracts": [
    {
      "label": "Source A — [Author, Title, and Line Range]",
      "text": "Full verbatim text of the extract"
    }
  ],
  "questions": [
    {
      "question_number": "1",
      "question_text": "Full verbatim question prompt including line references",
      "marks": 4,
      "scoring_type": "POINT_BASED",
      "assessment_objectives": ["AO1"],
      "sub_questions": []
    },
    {
      "question_number": "2",
      "question_text": "Full verbatim question prompt including any printed extract and bullet points",
      "marks": 8,
      "scoring_type": "SINGLE_AO_LOR",
      "assessment_objectives": ["AO2"],
      "sub_questions": []
    },
    {
      "question_number": "3",
      "question_text": "Full verbatim question prompt including bullet points",
      "marks": 8,
      "scoring_type": "SINGLE_AO_LOR",
      "assessment_objectives": ["AO2"],
      "sub_questions": []
    },
    {
      "question_number": "4",
      "question_text": "Full verbatim question prompt including student statement and bullet points",
      "marks": 20,
      "scoring_type": "SINGLE_AO_LOR",
      "assessment_objectives": ["AO4"],
      "sub_questions": []
    },
    {
      "question_number": "5",
      "question_text": "Full verbatim Section B Writing prompt (both Either/Or options, describing any picture prompt in brackets)",
      "marks": 40,
      "scoring_type": "DUAL_AO_LOR",
      "assessment_objectives": ["AO5", "AO6"],
      "sub_questions": []
    }
  ],
  "totalMarks": 80
}`;
  },
  buildMsPrompt(paperCode: string, series: string) {
    return `Convert the attached GCSE English Mark Scheme PDF into a single valid JSON object for the markingSchemes collection.
Return ONLY raw JSON following this exact schema:

{
  "examDetails": {
    "board": "AQA",
    "qualification": "GCSE",
    "subject": "English Language",
    "paperCode": "${paperCode}",
    "tier": "N/A",
    "paper": "Paper title",
    "date": "${series}",
    "exam_series": "${series}"
  },
  "totalQuestions": 5,
  "totalMarks": 80,
  "generalMarkingGuidance": {
    "overview": "Summary of general marking instructions",
    "levelOfResponseInstructions": [
      "Step 1 (Annotate the response): ...",
      "Step 2 (Determine a level): ...",
      "Step 3 (Determine a mark): ..."
    ]
  },
  "questions": {
    "1": {
      "questionNumber": "1",
      "scoringType": "POINT_BASED",
      "totalMarks": 4,
      "assessmentObjectives": ["AO1"],
      "answer": "4 valid facts from lines X to Y",
      "guidance": "Instructions on awarding 1 mark per valid point",
      "marks": [
        { "mark": "B1", "answer": "Valid point 1", "comments": "1st valid fact (AO1)" },
        { "mark": "B1", "answer": "Valid point 2", "comments": "2nd valid fact (AO1)" },
        { "mark": "B1", "answer": "Valid point 3", "comments": "3rd valid fact (AO1)" },
        { "mark": "B1", "answer": "Valid point 4", "comments": "4th valid fact (AO1)" }
      ]
    },
    "2": {
      "questionNumber": "2",
      "scoringType": "SINGLE_AO_LOR",
      "totalMarks": 8,
      "assessmentObjectives": ["AO2"],
      "answer": "Level-of-Response (Levels 1–4, 8 marks): Language analysis",
      "rubricInfringementNote": "Note for writing outside given lines if applicable",
      "levels": [
        { "level": 4, "label": "Perceptive, detailed analysis", "minMarks": 7, "maxMarks": 8, "descriptors": ["..."] },
        { "level": 3, "label": "Clear, relevant explanation", "minMarks": 5, "maxMarks": 6, "descriptors": ["..."] },
        { "level": 2, "label": "Some understanding and comment", "minMarks": 3, "maxMarks": 4, "descriptors": ["..."] },
        { "level": 1, "label": "Simple, limited comment", "minMarks": 1, "maxMarks": 2, "descriptors": ["..."] },
        { "level": 0, "label": "Nothing to reward", "minMarks": 0, "maxMarks": 0, "descriptors": ["Nothing to reward"] }
      ],
      "indicativeStandard": {
        "Level 4 (7–8 marks)": "Verbatim Indicative Standard exemplar for Level 4",
        "Level 3 (5–6 marks)": "Verbatim Indicative Standard exemplar for Level 3",
        "Level 2 (3–4 marks)": "Verbatim Indicative Standard exemplar for Level 2",
        "Level 1 (1–2 marks)": "Verbatim Indicative Standard exemplar for Level 1"
      },
      "aoContentBullets": ["All AO2 content bullets from the mark scheme"]
    },
    "3": {
      "questionNumber": "3",
      "scoringType": "SINGLE_AO_LOR",
      "totalMarks": 8,
      "assessmentObjectives": ["AO2"],
      "answer": "Level-of-Response (Levels 1–4, 8 marks): Structural analysis",
      "levels": [ ... ],
      "indicativeStandard": { ... },
      "aoContentBullets": [ ... ]
    },
    "4": {
      "questionNumber": "4",
      "scoringType": "SINGLE_AO_LOR",
      "totalMarks": 20,
      "assessmentObjectives": ["AO4"],
      "answer": "Level-of-Response (Levels 1–4, 20 marks): Critical evaluation",
      "levels": [ ... ],
      "indicativeStandard": { ... },
      "aoContentBullets": [ ... ]
    },
    "5": {
      "questionNumber": "5",
      "scoringType": "DUAL_AO_LOR",
      "totalMarks": 40,
      "assessmentObjectives": ["AO5", "AO6"],
      "answer": "Dual-AO Level-of-Response (40 marks = AO5 [24m] + AO6 [16m])",
      "dualAoBreakdown": {
        "ao5": {
          "ao": "AO5",
          "skill": "Content and Organisation",
          "maxMarks": 24,
          "radarAxis": "AO5 Content & Org",
          "levels": [
            { "level": 4, "subBand": "Upper Level 4", "label": "Compelling, Convincing Communication", "minMarks": 22, "maxMarks": 24, "descriptors": ["..."] }
          ]
        },
        "ao6": {
          "ao": "AO6",
          "skill": "Technical Accuracy (SPaG)",
          "maxMarks": 16,
          "radarAxis": "AO6 Technical SPaG",
          "levels": [
            { "level": 4, "label": "Level 4 Technical Accuracy", "minMarks": 13, "maxMarks": 16, "descriptors": ["..."] }
          ]
        }
      }
    }
  }
}`;
  },
  buildErPrompt(paperCode: string, series: string) {
    return `Convert the attached GCSE English Chief Examiner's Report PDF into a single valid JSON object for the examinerReports collection.
Return ONLY raw JSON following this exact schema:

{
  "examDetails": {
    "board": "AQA",
    "qualification": "GCSE",
    "subject": "English Language",
    "paperCode": "${paperCode}",
    "tier": "N/A",
    "paper": "Paper title",
    "date": "${series}",
    "exam_series": "${series}"
  },
  "totalQuestions": 5,
  "summary": {
    "overallPerformance": "Summary paragraph of overall student performance on the paper",
    "areasWhereStudentsExcelled": ["Key area 1...", "Key area 2..."],
    "areasWhereStudentsStruggled": ["Key pitfall 1...", "Key pitfall 2..."]
  },
  "assessmentObjectives": [
    { "ao": "AO1", "title": "Identify and interpret explicit and implicit information and ideas", "commonErrors": ["..."] },
    { "ao": "AO2", "title": "Explain, comment on and analyse how writers use language and structure", "commonErrors": ["..."] },
    { "ao": "AO4", "title": "Evaluate texts critically", "commonErrors": ["..."] },
    { "ao": "AO5", "title": "Communicate clearly, effectively and imaginatively", "commonErrors": ["..."] },
    { "ao": "AO6", "title": "Technical Accuracy (Vocabulary and Sentence Structures)", "commonErrors": ["..."] }
  ],
  "questions": {
    "1": { "questionNumber": "1", "maxMarks": 4, "assessmentObjectives": ["AO1"], "whatWorkedWell": "...", "commonPitfalls": ["..."] },
    "2": { "questionNumber": "2", "maxMarks": 8, "assessmentObjectives": ["AO2"], "whatWorkedWell": "...", "commonPitfalls": ["..."], "level3To4Separators": "..." },
    "3": { "questionNumber": "3", "maxMarks": 8, "assessmentObjectives": ["AO2"], "whatWorkedWell": "...", "commonPitfalls": ["..."], "level3To4Separators": "..." },
    "4": { "questionNumber": "4", "maxMarks": 20, "assessmentObjectives": ["AO4"], "whatWorkedWell": "...", "commonPitfalls": ["..."], "level3To4Separators": "..." },
    "5": { "questionNumber": "5", "maxMarks": 40, "assessmentObjectives": ["AO5", "AO6"], "whatWorkedWell": "...", "commonPitfalls": ["..."], "level3To4Separators": "..." }
  }
}`;
  }
};

const EDEXCEL_PROFILE: BoardProfile = {
  board: 'EDEXCEL',
  displayName: 'Pearson Edexcel (GCSE English Language 1EN0)',
  detect(context: string) {
    return /edexcel|1en0|1en2/i.test(context);
  },
  parsePaperCode(filename: string) {
    const lower = filename.toLowerCase();
    // Match 1en0-01, 1en0-02, 1en001, 1en0_01, 1en0/01
    const match = lower.match(/(1en[02])[-_ ]?([0-9]{2}|[0-9])/);
    if (match) {
      const subj = match[1].toUpperCase();
      const num = match[2].length === 1 ? `0${match[2]}` : match[2];
      return { key: `${subj}/${num}`, paperCode: `${subj}/${num}` };
    }
    const paperMatch = lower.match(/(?:paper|p)[-_ ]?([12])/);
    if (paperMatch) {
      const num = `0${paperMatch[1]}`;
      return { key: `1EN0/${num}`, paperCode: `1EN0/${num}` };
    }
    return { key: '1EN0/01', paperCode: '1EN0/01' };
  },
  parseFileRole(filename: string) {
    const lower = filename.toLowerCase();
    // Edexcel role tags: que = Question Paper, rms = Mark Scheme, pef = Examiner Report
    if (lower.includes('que') || lower.includes('qp') || lower.includes('question')) return 'qp';
    if (lower.includes('rms') || lower.includes('ms') || lower.includes('mark')) return 'ms';
    if (lower.includes('pef') || lower.includes('er') || lower.includes('wre') || lower.includes('examiner') || lower.includes('report')) return 'er';
    if (lower.includes('ins') || lower.includes('insert')) return 'ins';
    return null;
  },
  buildQpPrompt(paperCode: string, series: string) {
    const isPaper1 = paperCode.includes('01') || paperCode.endsWith('1');
    const totalMarks = isPaper1 ? 64 : 96;
    const timeAllowed = isPaper1 ? '1 hour 45 minutes' : '2 hours 5 minutes';
    const totalQuestions = isPaper1 ? 6 : 9;

    return `Convert the attached Pearson Edexcel GCSE English Language (${paperCode}) Question Paper PDF into a single valid JSON object for the fullExamPapers collection.
NOTE: In Pearson Edexcel, the reading extract(s) are printed DIRECTLY inside this Question Paper booklet on pages 2–7. Extract them verbatim into sourceExtracts.
NOTE: For Section B (Writing Choice), extract BOTH questions (Paper 1: Q5 and Q6; Paper 2: Q8 and Q9) into the questions array.
NOTE: For Paper 2 Question 7, it has sub-questions 7(a) and 7(b). Use the "sub_questions" array format for Question 7.

Return ONLY raw JSON following this exact schema:

{
  "metadata": {
    "exam_board": "Pearson Edexcel",
    "qualification": "GCSE",
    "subject": "English Language",
    "exam_code": "${paperCode}",
    "paper_title": "${isPaper1 ? 'Paper 1: 19th-Century Fiction and Imaginative Writing' : 'Paper 2: 20th- and 21st-Century Non-Fiction and Transactional Writing'}",
    "tier": "N/A",
    "exam_series": "${series}",
    "time_allowed": "${timeAllowed}",
    "total_questions": ${totalQuestions},
    "total_marks": ${totalMarks}
  },
  "sourceExtracts": [
    {
      "label": "${isPaper1 ? 'Text 1 — 19th Century Fiction [Author and Title]' : 'Text 1 — 20th Century Non-Fiction [Author and Title]'}",
      "text": "Full verbatim text of the reading extract from inside the booklet"
    }${isPaper1 ? '' : `,
    {
      "label": "Text 2 — 21st Century Non-Fiction [Author and Title]",
      "text": "Full verbatim text of the second reading extract from inside the booklet"
    }`}
  ],
  "questions": [
    {
      "question_number": "1",
      "question_text": "Verbatim question text including line references",
      "marks": ${isPaper1 ? 1 : 2},
      "scoring_type": "POINT_BASED",
      "assessment_objectives": ["AO1"],
      "sub_questions": []
    }${isPaper1 ? `
    // Include Q2 (2m AO1), Q3 (6m AO2 Language/Structure), Q4 (15m AO4 Evaluation), Q5 (40m DUAL_AO_LOR AO5/AO6 Writing Choice 1), Q6 (40m DUAL_AO_LOR AO5/AO6 Writing Choice 2)
` : `
    // Include Q2 (2m AO1), Q3 (15m AO2 Language/Structure Text 1), Q4 (1m AO1), Q5 (1m AO1), Q6 (15m AO2 Text 2),
    // Q7 (20m total with sub_questions: [ { "question_part": "a", "question_text": "...", "marks": 6, "scoring_type": "POINT_BASED", "assessment_objectives": ["AO1"] }, { "question_part": "b", "question_text": "...", "marks": 14, "scoring_type": "SINGLE_AO_LOR", "assessment_objectives": ["AO3"] } ]),
    // Q8 (40m DUAL_AO_LOR AO5/AO6 Writing Choice 1), Q9 (40m DUAL_AO_LOR AO5/AO6 Writing Choice 2)
`}
  ],
  "totalMarks": ${totalMarks}
}`;
  },
  buildMsPrompt(paperCode: string, series: string) {
    const isPaper1 = paperCode.includes('01') || paperCode.endsWith('1');
    const totalMarks = isPaper1 ? 64 : 96;

    return `Convert the attached Pearson Edexcel GCSE English Language (${paperCode}) Mark Scheme PDF into a single valid JSON object for the markingSchemes collection.
CRITICAL: For every level in "levels", you MUST provide integer "level", "minMarks", and "maxMarks" (do NOT use a single "markRange" string).
CRITICAL: For Section B Writing (Questions ${isPaper1 ? '5 and 6' : '8 and 9'}), use "dualAoBreakdown" with keys "ao5" (maxMarks: 24) and "ao6" (maxMarks: 16), each containing "levels" with integer "level", "minMarks", "maxMarks".

Return ONLY raw JSON following this exact schema:

{
  "examDetails": {
    "board": "Pearson Edexcel",
    "qualification": "GCSE",
    "subject": "English Language",
    "paperCode": "${paperCode}",
    "tier": "N/A",
    "paper": "${isPaper1 ? 'Paper 1: 19th-Century Fiction and Imaginative Writing' : 'Paper 2: 20th- and 21st-Century Non-Fiction and Transactional Writing'}",
    "date": "${series}",
    "exam_series": "${series}"
  },
  "totalQuestions": ${isPaper1 ? 6 : 9},
  "totalMarks": ${totalMarks},
  "generalMarkingGuidance": {
    "overview": "Summary of Pearson Edexcel general marking guidance",
    "levelOfResponseInstructions": [
      "Marking guidance notes..."
    ]
  },
  "questions": {
    "1": {
      "questionNumber": "1",
      "scoringType": "POINT_BASED",
      "totalMarks": ${isPaper1 ? 1 : 2},
      "assessmentObjectives": ["AO1"],
      "answer": "Accepted points...",
      "guidance": "Instructions on awarding marks",
      "marks": [
        { "mark": "1", "answer": "Valid point", "comments": "AO1" }
      ]
    },
    "3": {
      "questionNumber": "3",
      "scoringType": "SINGLE_AO_LOR",
      "totalMarks": ${isPaper1 ? 6 : 15},
      "assessmentObjectives": ["AO2"],
      "answer": "Language and structure analysis",
      "levels": [
        {
          "level": 3,
          "label": "Level 3: Analysis of language and structure",
          "minMarks": ${isPaper1 ? 5 : 11},
          "maxMarks": ${isPaper1 ? 6 : 15},
          "descriptors": ["..."]
        },
        {
          "level": 2,
          "label": "Level 2: Explanation of language and structure",
          "minMarks": ${isPaper1 ? 3 : 6},
          "maxMarks": ${isPaper1 ? 4 : 10},
          "descriptors": ["..."]
        },
        {
          "level": 1,
          "label": "Level 1: Comment on language and structure",
          "minMarks": 1,
          "maxMarks": ${isPaper1 ? 2 : 5},
          "descriptors": ["..."]
        },
        {
          "level": 0,
          "label": "Level 0: Nothing to reward",
          "minMarks": 0,
          "maxMarks": 0,
          "descriptors": ["Nothing to reward"]
        }
      ],
      "indicativeContent": "Indicative content points from mark scheme..."
    },
    "${isPaper1 ? '5' : '8'}": {
      "questionNumber": "${isPaper1 ? '5' : '8'}",
      "scoringType": "DUAL_AO_LOR",
      "totalMarks": 40,
      "assessmentObjectives": ["AO5", "AO6"],
      "answer": "Section B Imaginative/Transactional Writing (40 marks = AO5 [24m] + AO6 [16m])",
      "indicativeContent": "Purpose, audience, and form notes...",
      "dualAoBreakdown": {
        "ao5": {
          "ao": "AO5",
          "skill": "Content and Organisation",
          "maxMarks": 24,
          "radarAxis": "AO5 Content & Org",
          "levels": [
            {
              "level": 5,
              "subBand": "Level 5",
              "label": "Level 5: Sophisticated",
              "minMarks": 20,
              "maxMarks": 24,
              "descriptors": ["..."]
            },
            {
              "level": 4,
              "subBand": "Level 4",
              "label": "Level 4: Secure",
              "minMarks": 15,
              "maxMarks": 19,
              "descriptors": ["..."]
            },
            {
              "level": 3,
              "subBand": "Level 3",
              "label": "Level 3: Clear",
              "minMarks": 10,
              "maxMarks": 14,
              "descriptors": ["..."]
            },
            {
              "level": 2,
              "subBand": "Level 2",
              "label": "Level 2: Some",
              "minMarks": 5,
              "maxMarks": 9,
              "descriptors": ["..."]
            },
            {
              "level": 1,
              "subBand": "Level 1",
              "label": "Level 1: Limited",
              "minMarks": 1,
              "maxMarks": 4,
              "descriptors": ["..."]
            },
            {
              "level": 0,
              "subBand": "Level 0",
              "label": "Level 0: No rewardable material",
              "minMarks": 0,
              "maxMarks": 0,
              "descriptors": ["No rewardable material"]
            }
          ]
        },
        "ao6": {
          "ao": "AO6",
          "skill": "Technical Accuracy (SPaG)",
          "maxMarks": 16,
          "radarAxis": "AO6 Technical SPaG",
          "levels": [
            {
              "level": 5,
              "label": "Level 5: Sophisticated",
              "minMarks": 14,
              "maxMarks": 16,
              "descriptors": ["..."]
            },
            {
              "level": 4,
              "label": "Level 4: Secure",
              "minMarks": 11,
              "maxMarks": 13,
              "descriptors": ["..."]
            },
            {
              "level": 3,
              "label": "Level 3: Sound",
              "minMarks": 8,
              "maxMarks": 10,
              "descriptors": ["..."]
            },
            {
              "level": 2,
              "label": "Level 2: Some",
              "minMarks": 5,
              "maxMarks": 7,
              "descriptors": ["..."]
            },
            {
              "level": 1,
              "label": "Level 1: Limited",
              "minMarks": 1,
              "maxMarks": 4,
              "descriptors": ["..."]
            },
            {
              "level": 0,
              "label": "Level 0: No rewardable material",
              "minMarks": 0,
              "maxMarks": 0,
              "descriptors": ["No rewardable material"]
            }
          ]
        }
      }
    }
  }
}`;
  },
  buildErPrompt(paperCode: string, series: string) {
    const isPaper1 = paperCode.includes('01') || paperCode.endsWith('1');

    return `Convert the attached Pearson Edexcel Principal Examiner Feedback (PEF) PDF into a single valid JSON object for the examinerReports collection.
Return ONLY raw JSON following this exact schema:

{
  "examDetails": {
    "board": "Pearson Edexcel",
    "qualification": "GCSE",
    "subject": "English Language",
    "paperCode": "${paperCode}",
    "tier": "N/A",
    "paper": "${isPaper1 ? 'Paper 1' : 'Paper 2'}",
    "date": "${series}",
    "exam_series": "${series}"
  },
  "totalQuestions": ${isPaper1 ? 6 : 9},
  "summary": {
    "overallPerformance": "Summary paragraph of overall candidate performance",
    "areasWhereStudentsExcelled": ["Area 1...", "Area 2..."],
    "areasWhereStudentsStruggled": ["Common error 1...", "Common error 2..."]
  },
  "assessmentObjectives": [
    { "ao": "AO1", "title": "Identify and interpret information", "commonErrors": ["..."] },
    { "ao": "AO2", "title": "Analyse language and structure", "commonErrors": ["..."] },
    { "ao": "AO3", "title": "Compare writers ideas and perspectives", "commonErrors": ["..."] },
    { "ao": "AO4", "title": "Evaluate texts critically", "commonErrors": ["..."] },
    { "ao": "AO5", "title": "Communicate clearly and effectively", "commonErrors": ["..."] },
    { "ao": "AO6", "title": "Technical Accuracy", "commonErrors": ["..."] }
  ],
  "questions": {
    "1": { "questionNumber": "1", "maxMarks": ${isPaper1 ? 1 : 2}, "assessmentObjectives": ["AO1"], "whatWorkedWell": "...", "commonPitfalls": ["..."] }
    // Include commentary for all questions (${isPaper1 ? '1, 2, 3, 4, 5, 6' : '1, 2, 3, 4, 5, 6, 7a, 7b, 8, 9'})
  }
}`;
  }
};

const OCR_PROFILE: BoardProfile = {
  board: 'OCR',
  displayName: 'OCR (Oxford Cambridge and RSA)',
  detect(context: string) {
    return /ocr|j351/i.test(context);
  },
  parsePaperCode(filename: string) {
    const lower = filename.toLowerCase();
    const match = lower.match(/(j35[12])[-_ ]?([0-9]{2}|[0-9])/);
    if (match) {
      const subj = match[1].toUpperCase();
      const num = match[2].length === 1 ? `0${match[2]}` : match[2];
      return { key: `${subj}/${num}`, paperCode: `${subj}/${num}` };
    }
    return { key: 'J351/01', paperCode: 'J351/01' };
  },
  parseFileRole(filename: string) {
    const lower = filename.toLowerCase();
    if (lower.includes('ms') || lower.includes('mark')) return 'ms';
    if (lower.includes('er') || lower.includes('examiner') || lower.includes('report')) return 'er';
    if (lower.includes('ins') || lower.includes('insert')) return 'ins';
    if (lower.includes('qp') || lower.includes('question')) return 'qp';
    return null;
  },
  buildQpPrompt(paperCode: string, series: string, hasSeparateInsert: boolean) {
    return AQA_PROFILE.buildQpPrompt(paperCode, series, hasSeparateInsert).replace(/"AQA"/g, '"OCR"');
  },
  buildMsPrompt(paperCode: string, series: string) {
    return AQA_PROFILE.buildMsPrompt(paperCode, series).replace(/"AQA"/g, '"OCR"');
  },
  buildErPrompt(paperCode: string, series: string) {
    return AQA_PROFILE.buildErPrompt(paperCode, series).replace(/"AQA"/g, '"OCR"');
  }
};

const ALL_PROFILES: BoardProfile[] = [EDEXCEL_PROFILE, AQA_PROFILE, OCR_PROFILE];

function resolveBoard(dirPath?: string, filenames: string[] = [], cliBoard?: SupportedBoard): BoardProfile {
  if (cliBoard) {
    const found = ALL_PROFILES.find(p => p.board === cliBoard);
    if (found) return found;
  }

  const contexts = [
    dirPath ? path.basename(dirPath) : '',
    ...filenames.map(f => path.basename(f))
  ].filter(Boolean);

  for (const profile of ALL_PROFILES) {
    for (const ctx of contexts) {
      if (profile.detect(ctx)) {
        return profile;
      }
    }
  }

  // Default to AQA if unknown
  return AQA_PROFILE;
}

// ---------------------------------------------------------------------------
// File Discovery & Grouping
// ---------------------------------------------------------------------------

function findPaperJobsInDir(dirPath: string, profile: BoardProfile): PaperJob[] {
  const files = fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.pdf'));
  const grouped: Record<string, PaperJob> = {};

  for (const file of files) {
    const full = path.join(dirPath, file);
    const parsed = profile.parsePaperCode(file);
    const role = profile.parseFileRole(file);

    if (!parsed || !role) continue;

    if (!grouped[parsed.key]) {
      grouped[parsed.key] = {
        paperCode: parsed.paperCode,
        board: profile.board
      };
    }

    grouped[parsed.key][role] = full;
  }

  return Object.values(grouped).sort((a, b) => a.paperCode.localeCompare(b.paperCode));
}

function resolveExamSeries(dirPath?: string, filenames: string[] = [], cliSeries?: string): string | null {
  if (cliSeries && cliSeries.trim()) {
    return cliSeries.trim();
  }

  const candidates: string[] = [];
  if (dirPath) {
    candidates.push(path.basename(dirPath));
  }
  candidates.push(...filenames.map(f => path.basename(f)));

  for (const text of candidates) {
    const lower = text.toLowerCase();

    // Check November / Autumn: nov20, nov2020, november-2020, aut20, etc.
    const novMatch = lower.match(/(?:nov|november|aut|autumn)[-_ ]?((?:20)?\d{2})/);
    if (novMatch) {
      const yr = novMatch[1].length === 2 ? `20${novMatch[1]}` : novMatch[1];
      return `November ${yr}`;
    }

    // Check June / Summer: jun20, june2024, summer24, jun2025, etc.
    const junMatch = lower.match(/(?:jun|june|summer)[-_ ]?((?:20)?\d{2})/);
    if (junMatch) {
      const yr = junMatch[1].length === 2 ? `20${junMatch[1]}` : junMatch[1];
      return `June ${yr}`;
    }

    // Check January: jan20, jan2020
    const janMatch = lower.match(/(?:jan|january)[-_ ]?((?:20)?\d{2})/);
    if (janMatch) {
      const yr = janMatch[1].length === 2 ? `20${janMatch[1]}` : janMatch[1];
      return `January ${yr}`;
    }

    // Check Edexcel date stamp in filename: 20250607 (June 2025), 20251104 (Nov 2025)
    const stampMatch = lower.match(/\b(20\d{2})(0[1-9]|1[0-2])\d{2}\b/);
    if (stampMatch) {
      const year = stampMatch[1];
      const month = parseInt(stampMatch[2], 10);
      if (month >= 5 && month <= 7) return `June ${year}`;
      if (month >= 10 && month <= 12) return `November ${year}`;
      if (month === 1) return `January ${year}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Robust Multi-Layer JSON Parser with Tolerant Auto-Repair & LLM Self-Healing
// ---------------------------------------------------------------------------

function cleanJsonText(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

function attemptParseJson(text: string): { success: boolean; data?: any; error?: string } {
  const cleaned = cleanJsonText(text);

  // 1. Try standard JSON.parse
  try {
    return { success: true, data: JSON.parse(cleaned) };
  } catch (err1: any) {}

  // 2. Try JSON5.parse (handles trailing commas, unquoted keys, comments, single quotes)
  try {
    return { success: true, data: JSON5.parse(cleaned) };
  } catch (err2: any) {}

  // 3. Extract boundary from first '{' to last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const bounded = cleaned.substring(firstBrace, lastBrace + 1);
    try {
      return { success: true, data: JSON5.parse(bounded) };
    } catch (err3: any) {}
  }

  // 4. Try auto-repair for truncated brackets
  let repaired = cleaned;
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;

  if (openBrackets > closeBrackets) {
    repaired += ']'.repeat(openBrackets - closeBrackets);
  }
  if (openBraces > closeBraces) {
    repaired += '}'.repeat(openBraces - closeBraces);
  }

  try {
    return { success: true, data: JSON5.parse(repaired) };
  } catch (err4: any) {
    return { success: false, error: err4.message || 'Unknown JSON syntax error' };
  }
}

async function parseOrAutoFix(
  ai: GoogleGenAI,
  model: string,
  rawText: string,
  taskName: string,
  outDir: string
): Promise<any> {
  const firstAttempt = attemptParseJson(rawText);
  if (firstAttempt.success) {
    return firstAttempt.data;
  }

  console.warn(`\n⚠️  [SYNTAX WARNING] ${taskName} returned invalid JSON: ${firstAttempt.error}`);
  console.log(`🔄 Asking ${model} to self-correct the JSON syntax...`);

  try {
    const fixResponse = await ai.models.generateContent({
      model,
      contents: [
        {
          text: `The following response has a JSON syntax error: "${firstAttempt.error}".
Repair all syntax issues (ensure all keys/strings are properly double-quoted, remove illegal unescaped control characters or trailing commas, and close all brackets).
Return ONLY the corrected, valid JSON:

${rawText.slice(0, 50000)}`
        }
      ],
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 65536
      }
    });

    const fixedText = fixResponse.text || '';
    const retryAttempt = attemptParseJson(fixedText);
    if (retryAttempt.success) {
      console.log(`✅ [SYNTAX REPAIRED] Successfully repaired ${taskName} JSON via self-correction.`);
      return retryAttempt.data;
    }
  } catch (retryError: any) {
    console.error(`❌ [RETRY FAILED] Could not auto-repair JSON:`, retryError.message);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const errorDumpPath = path.join(outDir, `raw_syntax_error_${Date.now()}.txt`);
  fs.writeFileSync(errorDumpPath, rawText, 'utf8');
  console.error(`💾 Dumped raw problematic response to: ${errorDumpPath}`);

  throw new Error(`Failed to parse JSON for ${taskName}. Raw response saved to ${errorDumpPath}`);
}

function getSlug(board: string, paperCode: string, series: string): string {
  let b = (board || 'board').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (b.includes('edexcel')) {
    b = 'edexcel';
  }
  const p = (paperCode || 'paper').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const s = (series || 'series').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${b}-${p}-${s}`;
}

// ---------------------------------------------------------------------------
// Extraction Functions
// ---------------------------------------------------------------------------

async function extractFullExamPaper(
  ai: GoogleGenAI,
  model: string,
  profile: BoardProfile,
  qpPath: string,
  insPath?: string,
  outDir: string = '',
  expectedSeries: string = 'Unknown Series',
  expectedPaperCode: string = 'Paper 1'
): Promise<any> {
  console.log(`\n📄 [1/3] Extracting Question Paper (${path.basename(qpPath)}${insPath ? ' + ' + path.basename(insPath) : ''})...`);
  
  const qpBuffer = fs.readFileSync(qpPath);
  const contents: any[] = [
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: qpBuffer.toString('base64')
      }
    }
  ];

  if (insPath && fs.existsSync(insPath)) {
    const insBuffer = fs.readFileSync(insPath);
    contents.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: insBuffer.toString('base64')
      }
    });
  }

  const prompt = profile.buildQpPrompt(expectedPaperCode, expectedSeries, !!insPath);
  contents.push({ text: prompt });

  const systemInstruction = `You are an expert exam ingestion engine for ${profile.displayName}. Extract full verbatim question paper contents and reading extracts into valid JSON strictly conforming to the requested schema. CRITICAL: The canonical exam series for this sitting is strictly "${expectedSeries}".`;

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseMimeType: 'application/json',
      systemInstruction,
      maxOutputTokens: 65536
    }
  });

  const parsed = await parseOrAutoFix(ai, model, response.text || '{}', 'Question Paper', outDir);
  const tokens = response.usageMetadata;
  if (tokens) {
    console.log(`   Tokens: ${tokens.promptTokenCount} in, ${tokens.candidatesTokenCount} out (Total: ${tokens.totalTokenCount})`);
  }
  return parsed;
}

function parseMarksFromRangeOrValue(val: any): { min: number; max: number } | null {
  if (typeof val === 'number') return { min: val, max: val };
  if (!val) return null;
  const str = String(val).trim();
  const match = str.match(/(\d+)\s*[-–—to]+\s*(\d+)/i);
  if (match) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }
  const singleMatch = str.match(/(\d+)/);
  if (singleMatch) {
    const num = parseInt(singleMatch[1], 10);
    return { min: num, max: num };
  }
  return null;
}

export function normalizeMarkingScheme(ms: any): any {
  if (!ms || typeof ms !== 'object' || !ms.questions) return ms;

  for (const [qNum, q] of Object.entries(ms.questions as Record<string, any>)) {
    if (!q || typeof q !== 'object') continue;

    // 1. Normalize single-AO levels
    if (Array.isArray(q.levels)) {
      q.levels.forEach((lvl: any) => {
        if (!lvl || typeof lvl !== 'object') return;

        // Parse minMarks / maxMarks
        if (lvl.minMarks === undefined || lvl.maxMarks === undefined) {
          const range = parseMarksFromRangeOrValue(lvl.markRange || lvl.marks || lvl.range || lvl.mark);
          if (range) {
            lvl.minMarks = range.min;
            lvl.maxMarks = range.max;
          } else if (typeof lvl.level === 'string') {
            const numMatch = lvl.level.match(/\d+/);
            if (numMatch) {
              const n = parseInt(numMatch[0], 10);
              lvl.minMarks = lvl.minMarks ?? n;
              lvl.maxMarks = lvl.maxMarks ?? n;
            }
          }
        }

        // Normalize level number and label
        if (typeof lvl.level === 'string') {
          const numMatch = lvl.level.match(/\d+/);
          if (numMatch) {
            lvl.label = lvl.label || lvl.level;
            lvl.level = parseInt(numMatch[0], 10);
          }
        }
      });
    }

    // 2. Normalize dualAoBreakdown (e.g. AO5 + AO6 in Section B)
    if (q.dualAoBreakdown && typeof q.dualAoBreakdown === 'object') {
      const normalizedDual: Record<string, any> = {};

      for (const [aoKey, aoData] of Object.entries(q.dualAoBreakdown as Record<string, any>)) {
        if (!aoData || typeof aoData !== 'object') continue;

        const lowerKey = aoKey.toLowerCase();
        const isAo5 = lowerKey.includes('5') || lowerKey.includes('content');
        const standardKey = isAo5 ? 'ao5' : 'ao6';
        const defaultMax = isAo5 ? 24 : 16;
        const defaultSkill = isAo5 ? 'Content and Organisation' : 'Technical Accuracy (SPaG)';
        const defaultRadar = isAo5 ? 'AO5 Content & Org' : 'AO6 Technical SPaG';

        const maxMarks = aoData.maxMarks || aoData.totalMarks || defaultMax;

        const levels = Array.isArray(aoData.levels) ? aoData.levels : [];
        levels.forEach((lvl: any) => {
          if (!lvl || typeof lvl !== 'object') return;

          if (lvl.minMarks === undefined || lvl.maxMarks === undefined) {
            const range = parseMarksFromRangeOrValue(lvl.markRange || lvl.marks || lvl.range || lvl.mark);
            if (range) {
              lvl.minMarks = range.min;
              lvl.maxMarks = range.max;
            }
          }

          if (typeof lvl.level === 'string') {
            const numMatch = lvl.level.match(/\d+/);
            if (numMatch) {
              lvl.label = lvl.label || lvl.level;
              lvl.level = parseInt(numMatch[0], 10);
            }
          }
        });

        normalizedDual[standardKey] = {
          ...aoData,
          ao: aoData.ao || standardKey.toUpperCase(),
          skill: aoData.skill || defaultSkill,
          maxMarks,
          radarAxis: aoData.radarAxis || defaultRadar,
          levels
        };
      }

      q.dualAoBreakdown = normalizedDual;
    }
  }

  return ms;
}

async function extractMarkingScheme(
  ai: GoogleGenAI,
  model: string,
  profile: BoardProfile,
  msPath: string,
  outDir: string = '',
  expectedSeries: string = 'Unknown Series',
  expectedPaperCode: string = 'Paper 1'
): Promise<any> {
  console.log(`\n📋 [2/3] Extracting Marking Scheme (${path.basename(msPath)})...`);
  
  const msBuffer = fs.readFileSync(msPath);
  const contents: any[] = [
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: msBuffer.toString('base64')
      }
    }
  ];

  const prompt = profile.buildMsPrompt(expectedPaperCode, expectedSeries);
  contents.push({ text: prompt });

  const systemInstruction = `You are an expert exam marking scheme ingestion engine for ${profile.displayName}. Standardize mark schemes strictly conforming to the requested schema. CRITICAL: The canonical exam series for this sitting is strictly "${expectedSeries}".`;

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseMimeType: 'application/json',
      systemInstruction,
      maxOutputTokens: 65536
    }
  });

  const parsed = await parseOrAutoFix(ai, model, response.text || '{}', 'Marking Scheme', outDir);
  const normalized = normalizeMarkingScheme(parsed);
  const tokens = response.usageMetadata;
  if (tokens) {
    console.log(`   Tokens: ${tokens.promptTokenCount} in, ${tokens.candidatesTokenCount} out (Total: ${tokens.totalTokenCount})`);
  }
  return normalized;
}

async function extractExaminerReport(
  ai: GoogleGenAI,
  model: string,
  profile: BoardProfile,
  erPath: string,
  outDir: string = '',
  expectedSeries: string = 'Unknown Series',
  expectedPaperCode: string = 'Paper 1'
): Promise<any> {
  console.log(`\n📝 [3/3] Extracting Examiner Report (${path.basename(erPath)})...`);
  
  const erBuffer = fs.readFileSync(erPath);
  const contents: any[] = [
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: erBuffer.toString('base64')
      }
    }
  ];

  const prompt = profile.buildErPrompt(expectedPaperCode, expectedSeries);
  contents.push({ text: prompt });

  const systemInstruction = `You are an expert exam report ingestion engine for ${profile.displayName}. Extract Chief Examiner feedback strictly into the requested JSON schema. CRITICAL: The canonical exam series for this sitting is strictly "${expectedSeries}".`;

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseMimeType: 'application/json',
      systemInstruction,
      maxOutputTokens: 65536
    }
  });

  const parsed = await parseOrAutoFix(ai, model, response.text || '{}', 'Examiner Report', outDir);
  const tokens = response.usageMetadata;
  if (tokens) {
    console.log(`   Tokens: ${tokens.promptTokenCount} in, ${tokens.candidatesTokenCount} out (Total: ${tokens.totalTokenCount})`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Main Orchestration Loop
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
Past Paper Ingestion Script (Gemini 3.7 Flash)
Usage:
  npm run ingest:paper -- --dir="/path/to/folder" [options]

Options:
  --dir=<folder>     Directory containing the downloaded PDFs (auto-detects and processes all papers)
  --board=<AQA|EDEXCEL|OCR>  Explicit board override (default: auto-detected from folder/filenames)
  --series=<name>    Explicit exam series override (e.g. "November 2020", "June 2025")
  --paper=<1|2>      Process only a specific paper number (default: processes all found in folder)
  --dry-run          Extract and validate JSON locally without writing to Firestore
  --model=<name>     Gemini model to use (default: "gemini-3.7-flash")
  --qp=<path>        Specific Question Paper PDF path
  --ms=<path>        Specific Mark Scheme PDF path
  --er=<path>        Specific Examiner Report PDF path
  --ins=<path>       Specific Reading Insert PDF path
  --out=<folder>     Directory to save local JSON backup (default: backend/data/english)
  --key=<api_key>    Explicit Google AI Studio API key (defaults to GEMINI_API_KEY in backend/.env.local)
  --help, -h         Show this help message
`);
    process.exit(0);
  }

  console.log(`=======================================================`);
  console.log(`🚀 Past Paper Auto-Ingestion Pipeline`);
  console.log(`🤖 Model: ${args.model} (Google AI Studio)`);
  console.log(`🧪 Mode:  ${args.dryRun ? 'DRY-RUN (Local JSON only)' : 'LIVE (Save to Firestore & Local)'}`);
  console.log(`=======================================================`);

  // 1. Resolve Board Profile
  const allDirFiles = args.dir && fs.existsSync(args.dir) ? fs.readdirSync(args.dir) : [];
  const profile = resolveBoard(args.dir, allDirFiles, args.board);
  console.log(`🏛️  Exam Board Profile: ${profile.displayName}`);

  // 2. Discover Paper Jobs
  let jobs: PaperJob[] = [];
  if (args.dir) {
    if (!fs.existsSync(args.dir)) {
      console.error(`❌ Directory not found: ${args.dir}`);
      process.exit(1);
    }
    jobs = findPaperJobsInDir(args.dir, profile);
  } else if (args.qp && args.ms) {
    const inferred = profile.parsePaperCode(path.basename(args.qp));
    jobs = [{
      paperCode: args.paper ? `${profile.board === 'EDEXCEL' ? '1EN0/' : '8700/'}${args.paper.padStart(2, '0')}` : (inferred?.paperCode || 'Paper 1'),
      board: profile.board,
      qp: args.qp,
      ins: args.ins,
      ms: args.ms,
      er: args.er
    }];
  }

  // Filter paper if requested
  if (args.paper) {
    const filter = args.paper.trim();
    jobs = jobs.filter(j => j.paperCode.endsWith(filter) || j.paperCode.includes(`/${filter}`) || j.paperCode.endsWith(filter.padStart(2, '0')));
  }

  if (jobs.length === 0) {
    console.error(`\n❌ Error: No valid exam paper sets found in directory for ${profile.board}.`);
    console.error(`   Provide --dir="<folder>" with PDFs, or specify --qp="..." and --ms="..."`);
    process.exit(1);
  }

  // 3. Resolve Exam Series
  const allReferencedFiles = jobs.flatMap(j => [j.qp, j.ins, j.ms, j.er].filter(Boolean) as string[]);
  const resolvedSeries = resolveExamSeries(args.dir, allReferencedFiles, args.series);

  console.log(`📅 Exam Series: ${resolvedSeries || 'Auto-detect from PDF text'}${resolvedSeries ? ' (enforced authority)' : ''}`);
  console.log(`📑 Found ${jobs.length} paper set(s) in folder: ${jobs.map(j => j.paperCode).join(', ')}`);

  // 4. Initialize Gemini AI Studio Client
  const apiKey = args.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.error(`\n❌ Error: Valid Google AI Studio API key not found.`);
    console.error(`   Please ensure GEMINI_API_KEY in backend/.env.local is set, or pass --key="AIza..."`);
    process.exit(1);
  }

  const maskedKey = apiKey.length > 8 
    ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` 
    : '***';
  console.log(`🔑 Using Google AI Studio Key: ${maskedKey}`);

  const ai = new GoogleGenAI({ apiKey });

  // 5. Initialize Firestore if not dry-run
  let db: any = null;
  if (!args.dryRun) {
    const serviceAccountPath = path.join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
    if (!fs.existsSync(serviceAccountPath)) {
      console.error(`❌ Service account key not found at ${serviceAccountPath}`);
      process.exit(1);
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath))
      });
    }
    db = admin.firestore();
  }

  const processedSummary: Array<{ paperCode: string; series: string; qpDocId: string; msDocId: string; erDocId?: string }> = [];

  // 6. Process each paper job sequentially
  for (let idx = 0; idx < jobs.length; idx++) {
    const job = jobs[idx];
    console.log(`\n=======================================================`);
    console.log(`📚 [${idx + 1}/${jobs.length}] Starting Paper: ${job.paperCode} (${profile.board})`);
    console.log(`=======================================================`);
    console.log(`   Question Paper:   ${job.qp ? '✅ ' + path.basename(job.qp) : '❌ Missing'}`);
    console.log(`   Reading Insert:   ${job.ins ? '✅ ' + path.basename(job.ins) : '⚪ None (in-booklet)'}`);
    console.log(`   Mark Scheme:      ${job.ms ? '✅ ' + path.basename(job.ms) : '❌ Missing'}`);
    console.log(`   Examiner Report:  ${job.er ? '✅ ' + path.basename(job.er) : '⚪ None'}`);

    if (!job.qp || !job.ms) {
      console.warn(`⚠️ Skipping ${job.paperCode}: missing Question Paper or Mark Scheme.`);
      continue;
    }

    const currentSeries = resolvedSeries || 'Unknown Series';

    // 1. Extract Question Paper
    const qpJson = await extractFullExamPaper(
      ai,
      args.model,
      profile,
      job.qp,
      job.ins,
      args.outDir,
      currentSeries,
      job.paperCode
    );

    // 2. Extract Marking Scheme
    const msJson = await extractMarkingScheme(
      ai,
      args.model,
      profile,
      job.ms,
      args.outDir,
      currentSeries,
      job.paperCode
    );

    // 3. Extract Examiner Report (if present)
    let erJson: any = null;
    if (job.er && fs.existsSync(job.er)) {
      erJson = await extractExaminerReport(
        ai,
        args.model,
        profile,
        job.er,
        args.outDir,
        currentSeries,
        job.paperCode
      );
    }

    // Enforce canonical metadata
    const canonicalBoard = profile.board === 'EDEXCEL' ? 'Pearson Edexcel' : profile.board;
    const paperCode = job.paperCode;
    const finalSeries = currentSeries;

    qpJson.metadata = {
      ...(qpJson.metadata || {}),
      exam_board: canonicalBoard,
      exam_code: paperCode,
      exam_series: finalSeries
    };

    msJson.examDetails = {
      ...(msJson.examDetails || {}),
      board: canonicalBoard,
      paperCode,
      exam_series: finalSeries
    };

    if (erJson?.examDetails) {
      erJson.examDetails = {
        ...erJson.examDetails,
        board: canonicalBoard,
        paperCode,
        exam_series: finalSeries
      };
    }

    const baseSlug = getSlug(canonicalBoard, paperCode, finalSeries);
    const qpDocId = `${baseSlug}-qp`;
    const msDocId = `${baseSlug}-ms`;
    const erDocId = `${baseSlug}-er`;

    const now = new Date().toISOString();

    qpJson.id = qpDocId;
    qpJson.uploadedAt = now;
    qpJson.updatedAt = now;

    msJson.id = msDocId;
    msJson.uploadedAt = now;
    msJson.createdAt = now;
    msJson.updatedAt = now;

    if (erJson) {
      erJson.id = erDocId;
      erJson.uploadedAt = now;
      erJson.createdAt = now;
      erJson.updatedAt = now;
    }

    // Ensure output directory exists
    if (!fs.existsSync(args.outDir)) {
      fs.mkdirSync(args.outDir, { recursive: true });
    }

    // Save local JSON backup
    const combinedData = {
      metadata: {
        generatedAt: now,
        model: args.model,
        board: canonicalBoard,
        paperCode,
        examSeries: finalSeries
      },
      fullExamPaper: qpJson,
      markingScheme: msJson,
      examinerReport: erJson
    };

    const backupFilePath = path.join(args.outDir, `${baseSlug}.json`);
    fs.writeFileSync(backupFilePath, JSON.stringify(combinedData, null, 2), 'utf8');
    console.log(`\n💾 Saved local JSON bundle to: ${backupFilePath}`);

    if (args.dryRun) {
      console.log(`✨ [DRY-RUN] Verified ${paperCode} JSON without writing to Firestore.`);
      console.log(`   - fullExamPapers ID: ${qpDocId} (${qpJson.questions?.length || 0} questions, ${qpJson.totalMarks || qpJson.metadata?.total_marks || 0} marks)`);
      console.log(`   - markingSchemes ID: ${msDocId} (${Object.keys(msJson.questions || {}).length} questions, ${msJson.totalMarks || 0} marks)`);
      if (erJson) {
        console.log(`   - examinerReports ID: ${erDocId} (${Object.keys(erJson.questions || {}).length} questions)`);
      }
    } else {
      console.log(`🔥 Upserting ${paperCode} to Firestore...`);
      await db.collection('fullExamPapers').doc(qpDocId).set(qpJson, { merge: true });
      console.log(`   ✅ fullExamPapers/${qpDocId}`);

      await db.collection('markingSchemes').doc(msDocId).set(msJson, { merge: true });
      console.log(`   ✅ markingSchemes/${msDocId}`);

      if (erJson) {
        await db.collection('examinerReports').doc(erDocId).set(erJson, { merge: true });
        console.log(`   ✅ examinerReports/${erDocId}`);
      }
    }

    processedSummary.push({
      paperCode,
      series: finalSeries,
      qpDocId,
      msDocId,
      erDocId: erJson ? erDocId : undefined
    });
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 Ingestion Summary (${processedSummary.length} paper(s) processed for ${profile.board})`);
  console.log(`=======================================================`);
  for (const item of processedSummary) {
    console.log(`- ${item.paperCode} (${item.series}):`);
    console.log(`    fullExamPapers:   ${item.qpDocId}`);
    console.log(`    markingSchemes:   ${item.msDocId}`);
    if (item.erDocId) {
      console.log(`    examinerReports:  ${item.erDocId}`);
    }
  }
  console.log(args.dryRun ? `\n(Dry run complete. No Firestore records were created.)` : `\nAll records are live in Firestore!`);
}

main().catch(err => {
  console.error(`\n❌ Ingestion failed:`, err);
  process.exit(1);
});
