# Guide: Ingesting New English Past Papers

You can ingest new GCSE English Language (e.g., AQA `8700/1`, `8700/2`) or Literature (`8702/1`, `8702/2`) past papers either:
1. **Automated via CLI Script (Recommended)**: Download your PDFs to a local folder and run one terminal command using **Gemini 3.7 Flash**.
2. **Manual via Web Gemini & Admin Page**: Upload PDFs to Web Gemini and copy-paste JSON into the Admin Page tabs.

---

## Method 1: Automated CLI Script (Gemini 3.7 Flash)

### 1. Download your PDFs to a folder
Download the Question Paper, Mark Scheme, and Examiner's Report (plus Reading Insert if separate) into a folder, e.g.:
```text
~/Downloads/AQA_8700_Nov2024/
├── 8700_1_QP.pdf       (Question Paper)
├── 8700_1_INS.pdf      (Insert booklet with Source texts — optional if in QP)
├── 8700_1_MS.pdf       (Mark Scheme)
└── 8700_1_ER.pdf       (Examiner Report / WRE — optional)
```
*(The script automatically detects filenames containing `QP`, `INS`, `MS`, `ER`, or `WRE`)*.

### 2. Run the Script
From the `backend` folder:
```bash
# Test extraction locally first (Dry-Run: creates JSON backups in backend/data/english without writing to DB):
npm run ingest:paper -- --dir="/path/to/folder" --dry-run

# Live Ingestion (Saves JSON and upserts to Firestore fullExamPapers, markingSchemes, and examinerReports):
npm run ingest:paper -- --dir="/path/to/folder"
```

The script will:
1. Extract Question Paper and Source Extracts verbatim into `fullExamPapers`.
2. Extract Level-of-Response rubrics and Indicative Content into `markingSchemes`.
3. Extract Chief Examiner feedback into `examinerReports`.
4. Save a combined JSON backup to `backend/data/english/<series-id>.json`.
5. Upsert directly to Firestore with matching paper codes and exam series.

---

## Method 2: Manual via Web Gemini & Admin Page

> [!TIP]
> The backend (`QuestionDetectionService`) automatically links all three records by matching `board` (`"AQA"`), `paperCode` / `exam_code` (`"8700/1"`), and `exam_series` (`"June 2025"`). Even if you upload the Examiner Report separately in the **Examiner Report** tab, the marking engine automatically merges its question-level commentary into the marking prompt at runtime.

---

## Step 1: Extract & Upload **Exam JSON** (`fullExamPapers`)

1. Open **Web Gemini** and upload the **Question Paper PDF** (and the **Reading Insert PDF** if you have it; if the Insert is missing, upload the Mark Scheme PDF alongside the Question Paper so Gemini can reconstruct the key facts/extracts from the indicative content).
2. Paste the prompt below into Web Gemini:

```text
Convert the attached GCSE English Question Paper PDF (and Reading Insert if attached) into a single valid JSON object for the `fullExamPapers` collection. Return ONLY raw JSON (no markdown commentary) following this exact schema:

{
  "metadata": {
    "exam_board": "AQA",
    "qualification": "GCSE",
    "subject": "English Language",
    "exam_code": "8700/1",
    "exam_series": "June 2025",
    "tier": "N/A",
    "paper_title": "Paper 1 Explorations in creative reading and writing",
    "date": "23 May 2025",
    "time_allowed": "1 hour 45 minutes",
    "total_marks": 80
  },
  "sourceExtracts": [
    {
      "label": "Source A — [Author, Title, and Line Range]",
      "text": "Full verbatim text of the extract (or detailed line-by-line summary if reconstructed from the mark scheme)"
    }
  ],
  "questions": [
    {
      "question_number": "1",
      "question_text": "Full verbatim question prompt including line references",
      "marks": 4,
      "scoring_type": "POINT_BASED",
      "assessment_objectives": ["AO1"]
    },
    {
      "question_number": "2",
      "question_text": "Full verbatim question prompt including any printed extract and bullet points",
      "marks": 8,
      "scoring_type": "SINGLE_AO_LOR",
      "assessment_objectives": ["AO2"]
    },
    {
      "question_number": "3",
      "question_text": "Full verbatim question prompt including bullet points",
      "marks": 8,
      "scoring_type": "SINGLE_AO_LOR",
      "assessment_objectives": ["AO2"]
    },
    {
      "question_number": "4",
      "question_text": "Full verbatim question prompt including the student statement and bullet points",
      "marks": 20,
      "scoring_type": "SINGLE_AO_LOR",
      "assessment_objectives": ["AO4"]
    },
    {
      "question_number": "5",
      "question_text": "Full verbatim Section B Writing prompt (both Either/Or options, describing any picture prompt in brackets)",
      "marks": 40,
      "scoring_type": "DUAL_AO_LOR",
      "assessment_objectives": ["AO5", "AO6"]
    }
  ],
  "totalMarks": 80
}
```

3. Copy the JSON response, go to **Admin Panel → Exam JSON**, paste it into the upload box, and click **Upload to fullExamPapers**.

---

## Step 2: Extract & Upload **Marking Scheme** (`markingSchemes`)

1. In **Web Gemini**, upload the **Mark Scheme PDF** (e.g. `AQA-87001-MS-*.PDF`).
2. Paste the prompt below into Web Gemini:

```text
Convert the attached GCSE English Mark Scheme PDF into a single valid JSON object for the `markingSchemes` collection. Return ONLY raw JSON following this exact schema:

{
  "examDetails": {
    "board": "AQA",
    "qualification": "GCSE",
    "subject": "English Language",
    "paperCode": "8700/1",
    "tier": "N/A",
    "paper": "Paper 1 Explorations in creative reading and writing",
    "date": "June 2025",
    "exam_series": "June 2025"
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
      "answer": "4 valid facts from lines X to Y (1 mark each, max 4 marks)",
      "guidance": "Full instructions on awarding 1 mark per valid point, compound statements, and REJECT criteria",
      "marks": [
        {
          "mark": "B1",
          "answer": "All valid indicative facts listed in the mark scheme",
          "comments": "1st valid fact (AO1)"
        },
        { "mark": "B1", "answer": "Second distinct valid fact", "comments": "2nd valid fact (AO1)" },
        { "mark": "B1", "answer": "Third distinct valid fact", "comments": "3rd valid fact (AO1)" },
        { "mark": "B1", "answer": "Fourth distinct valid fact", "comments": "4th valid fact (AO1)" }
      ]
    },
    "2": {
      "questionNumber": "2",
      "scoringType": "SINGLE_AO_LOR",
      "totalMarks": 8,
      "assessmentObjectives": ["AO2"],
      "answer": "Level-of-Response (Levels 1–4, 8 marks): Language analysis",
      "rubricInfringementNote": "Include any rubric infringement note for writing outside the given lines",
      "levels": [
        {
          "level": 4,
          "label": "Perceptive, detailed analysis",
          "minMarks": 7,
          "maxMarks": 8,
          "descriptors": ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4"]
        },
        {
          "level": 3,
          "label": "Clear, relevant explanation",
          "minMarks": 5,
          "maxMarks": 6,
          "descriptors": ["..."]
        },
        {
          "level": 2,
          "label": "Some understanding and comment",
          "minMarks": 3,
          "maxMarks": 4,
          "descriptors": ["..."]
        },
        {
          "level": 1,
          "label": "Simple, limited comment",
          "minMarks": 1,
          "maxMarks": 2,
          "descriptors": ["..."]
        },
        {
          "level": 0,
          "label": "Nothing to reward",
          "minMarks": 0,
          "maxMarks": 0,
          "descriptors": ["Nothing to reward"]
        }
      ],
      "indicativeStandard": {
        "Level 4 (7–8 marks)": "Verbatim Indicative Standard exemplar for Level 4",
        "Level 3 (5–6 marks)": "Verbatim Indicative Standard exemplar for Level 3",
        "Level 2 (3–4 marks)": "Verbatim Indicative Standard exemplar for Level 2",
        "Level 1 (1–2 marks)": "Verbatim Indicative Standard exemplar for Level 1"
      },
      "aoContentBullets": [
        "All AO2 content bullets from the mark scheme"
      ]
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
      "rubricInfringementNote": "...",
      "levels": [ ... ],
      "indicativeStandard": { ... },
      "aoContentBullets": [ ... ]
    },
    "5": {
      "questionNumber": "5",
      "scoringType": "DUAL_AO_LOR",
      "totalMarks": 40,
      "assessmentObjectives": ["AO5", "AO6"],
      "answer": "Dual-AO Level-of-Response (40 marks = AO5 Content & Organisation [24m] + AO6 Technical Accuracy [16m])",
      "dualAoBreakdown": {
        "ao5": {
          "ao": "AO5",
          "skill": "Content and Organisation",
          "maxMarks": 24,
          "radarAxis": "AO5 Content & Org",
          "levels": [
            {
              "level": 4,
              "subBand": "Upper Level 4",
              "label": "Compelling, Convincing Communication (Upper Level 4)",
              "minMarks": 22,
              "maxMarks": 24,
              "descriptors": ["Content: ...", "Organisation: ..."]
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
              "level": 4,
              "label": "Level 4 Technical Accuracy",
              "minMarks": 13,
              "maxMarks": 16,
              "descriptors": ["..."]
            }
          ]
        }
      }
    }
  }
}
```

3. Copy the JSON response, go to **Admin Panel → Marking Scheme**, paste it into the upload box, and click **Upload Marking Scheme**.

---

## Step 3: Extract & Upload **Examiner Report** (`examinerReports`)

1. In **Web Gemini**, upload the **Examiner's Report PDF** (e.g. `AQA-87001-WRE-*.PDF`).
2. Paste the prompt below into Web Gemini:

```text
Convert the attached GCSE English Chief Examiner's Report PDF into a single valid JSON object for the `examinerReports` collection. Return ONLY raw JSON following this exact schema:

{
  "examDetails": {
    "board": "AQA",
    "qualification": "GCSE",
    "subject": "English Language",
    "paperCode": "8700/1",
    "tier": "N/A",
    "paper": "Paper 1 Explorations in creative reading and writing",
    "date": "June 2025",
    "exam_series": "June 2025"
  },
  "totalQuestions": 5,
  "summary": {
    "overallPerformance": "Summary paragraph of overall student performance on the paper",
    "areasWhereStudentsExcelled": [
      "Key area where candidates performed well..."
    ],
    "areasWhereStudentsStruggled": [
      "Key pitfall or rubric error across the paper..."
    ]
  },
  "assessmentObjectives": [
    {
      "ao": "AO1",
      "title": "Identify and interpret explicit and implicit information and ideas",
      "commonErrors": ["Common error 1...", "Common error 2..."]
    },
    {
      "ao": "AO2",
      "title": "Explain, comment on and analyse how writers use language and structure to achieve effects",
      "commonErrors": ["..."]
    },
    {
      "ao": "AO4",
      "title": "Evaluate texts critically and support this with appropriate textual references",
      "commonErrors": ["..."]
    },
    {
      "ao": "AO5",
      "title": "Communicate clearly, effectively and imaginatively; organise information and ideas",
      "commonErrors": ["..."]
    },
    {
      "ao": "AO6",
      "title": "Use a range of vocabulary and sentence structures for clarity, purpose and effect, with accurate spelling and punctuation",
      "commonErrors": ["..."]
    }
  ],
  "questions": {
    "1": {
      "questionNumber": "1",
      "maxMarks": 4,
      "assessmentObjectives": ["AO1"],
      "whatWorkedWell": "What successful candidates did on Question 1...",
      "commonPitfalls": [
        "Specific mistake or misreading penalized by examiners on Q1..."
      ]
    },
    "2": {
      "questionNumber": "2",
      "maxMarks": 8,
      "assessmentObjectives": ["AO2"],
      "whatWorkedWell": "What successful candidates did on Question 2...",
      "commonPitfalls": ["..."],
      "level3To4Separators": "What separated Level 4 perceptive responses from Level 3 clear responses on Q2..."
    },
    "3": {
      "questionNumber": "3",
      "maxMarks": 8,
      "assessmentObjectives": ["AO2"],
      "whatWorkedWell": "...",
      "commonPitfalls": ["..."],
      "level3To4Separators": "..."
    },
    "4": {
      "questionNumber": "4",
      "maxMarks": 20,
      "assessmentObjectives": ["AO4"],
      "whatWorkedWell": "...",
      "commonPitfalls": ["..."],
      "level3To4Separators": "..."
    },
    "5": {
      "questionNumber": "5",
      "maxMarks": 40,
      "assessmentObjectives": ["AO5", "AO6"],
      "whatWorkedWell": "...",
      "commonPitfalls": ["..."],
      "level3To4Separators": "..."
    }
  }
}
```

3. Copy the JSON response, go to **Admin Panel → Examiner Report**, paste it into the upload box, and click **Upload Examiner Report**.


Garde Boundary 

Role: You are a Lead Educational Data Architect specializing in UK exam board grade boundary ingestion. Your objective is to extract and standardize grade boundary tables for GCSE English Language and GCSE English Literature from official exam board PDF exports or OCR tabular snippets into a strict, validated JSON schema.

🛡️ Domain-Specific Ingestion Guardrails:
1. Untiered Handling: GCSE English Language and GCSE English Literature are linear, untiered qualifications (grades 9–1). For untiered subjects, set "tier_level": null (do NOT set it to "higher" or "foundation").
2. Multi-Subject Scope: If an input document contains rows for both English Language and English Literature, extract BOTH subjects as separate entries inside the `subjects` array.
3. Component vs. Overall Alignment:
    - Identify component rows (e.g., Paper 1 / 8700/1, Paper 2 / 8700/2) and map them directly into `papers`.
    - Identify the composite qualification row (e.g., 8700, 8702) and map it into `overall_total_boundaries`.
4. Strict Arithmetic Verification:
    - Validate that `subjects[i].max_mark` strictly equals the sum of each paper's `max_mark` (e.g., 80 + 80 = 160, or 64 + 96 = 160).
    - Do NOT sum boundary values across papers to create total boundaries; extract overall boundaries directly from the official composite line.
5. Absolute Data Fidelity:
    - Never infer, interpolate, or extrapolate missing marks. If a boundary mark or component is absent, use null.
    - Enforce numeric integer types for all marks and boundary thresholds.
    - Keep grade keys as string labels ("9", "8", ..., "1") mapping to integer marks.

📤 Output Format:
Return exclusively a single valid JSON object adhering strictly to this schema:

{
    "exam_board": "STRING (e.g., AQA | EDEXCEL | OCR | EDUQAS)",
    "qualification": "GCSE",
    "exam_series": "STRING (e.g., June 2024)",
    "subjects": [
        {
            "code": "STRING (e.g., 8700)",
            "name": "STRING (e.g., ENGLISH LANGUAGE)",
            "max_mark": INTEGER,
            "tiers": [
            {
                "tier_level": null,
                "paper_codes": ["STRING"],
                "boundaries_type": "Paper-Specific & Overall",
                "papers": [
                            {
                            "code": "STRING",
                            "name": "STRING",
                            "max_mark": INTEGER,
                            "boundaries": {
                            "9": INTEGER,
                            "8": INTEGER,
                            "7": INTEGER,
                            "6": INTEGER,
                            "5": INTEGER,
                            "4": INTEGER,
                            "3": INTEGER,
                            "2": INTEGER,
                            "1": INTEGER
                            }
                            }
                            ],
                "overall_total_boundaries": {
                    "9": INTEGER,
                    "8": INTEGER,
                    "7": INTEGER,
                    "6": INTEGER,
                    "5": INTEGER,
                    "4": INTEGER,
                    "3": INTEGER,
                    "2": INTEGER,
                    "1": INTEGER
                }
            }
            ]
        }
    ]
}