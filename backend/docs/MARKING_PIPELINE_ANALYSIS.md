# Marking Instruction Pipeline Analysis

## Overview

This document analyzes the marking instruction pipeline, focusing on the **Classification Stage** and **Marking Instruction Stage**.

## Pipeline Flow

```
Image Input
    ↓
[Stage 1: Image Preprocessing]
    ↓
[Stage 2: Classification] ← Focus Area
    ↓
[Stage 3: OCR Processing]
    ↓
[Stage 4: Marking Instruction Generation] ← Focus Area
    ↓
[Stage 5: Annotation Creation]
    ↓
Annotated Output
```

---

## Stage 2: Classification

### Purpose
Classify images and extract question text and student work into a structured JSON format.

### Implementation
**File**: `backend/services/marking/ClassificationService.ts`

**Key Methods**:
- `classifyMultipleImages()` - Classifies multiple images at once (for multi-page documents)
- `classifyImage()` - Classifies a single image

### Classification Process

1. **Page Category Classification**
   - Determines category: `"questionOnly"`, `"questionAnswer"`, or `"metadata"`
   - `"questionOnly"`: Page contains only printed questions with no student work
   - `"questionAnswer"`: Page contains both questions and visible student work
   - `"metadata"`: Cover sheet, instructions, or formula sheet

2. **Question Text Extraction**
   - Extracts all printed question text in hierarchical structure
   - Main question numbers (e.g., "1", "2") → `questionNumber` field
   - Sub-parts (e.g., "a", "b", "(i)", "(ii)") → `subQuestions` array
   - **CRITICAL**: Does NOT extract page headers, footers, mark indicators, or student-written text

3. **Student Work Extraction** (only if category is `"questionAnswer"`)
   - Extracts student work corresponding to each question part
   - Text-based work: Extracted in LaTeX format
   - Drawing tasks: Indicated with `[DRAWING]` prefix
   - For multi-line work: Uses `\n` (backslash + n) as line separator

### Output Format

**Single Image**:
```json
{
  "category": "questionAnswer",
  "questions": [
    {
      "questionNumber": "2",
      "text": "question text",
      "studentWork": "LaTeX student work",
      "confidence": 0.9,
      "subQuestions": [
        {
          "part": "a",
          "text": "sub-question text",
          "studentWork": "LaTeX student work",
          "confidence": 0.9
        }
      ]
    }
  ]
}
```

**Multiple Images**:
```json
{
  "pages": [
    {
      "pageNumber": 1,
      "category": "questionAnswer",
      "questions": [...]
    },
    {
      "pageNumber": 2,
      "category": "questionAnswer",
      "questions": [...]
    }
  ]
}
```

### Prompts
**File**: `backend/config/prompts.ts` (lines 15-329)

- **System Prompt**: Defines the classification task, rules for extraction, and output format
- **User Prompt**: Simple instruction to classify the image

### Key Features

1. **Multi-Image Context**: Uses context from previous pages to identify question numbers on continuation pages
2. **Drawing Extraction**: Simplified extraction - only indicates drawings exist (detailed extraction done by specialized service later)
3. **LaTeX Formatting**: All mathematical expressions extracted in LaTeX format
4. **JSON Escaping**: Properly escapes backslashes for valid JSON (e.g., `\\frac{4}{5}`)

### Error Handling

- Falls back to OpenAI if Gemini returns RECITATION-style errors
- Handles JSON parsing errors with sanitization
- Validates model before making API calls

---

## Stage 4: Marking Instruction Generation

### Purpose
Generate marking annotations (tick/cross, mark codes) for student work based on marking scheme and OCR/classification data.

### Implementation
**File**: `backend/services/marking/MarkingInstructionService.ts`

**Key Method**:
- `executeMarking()` - Main entry point for marking flow
- `generateFromOCR()` - Generates annotations from OCR text and marking scheme

### Marking Process

#### Step 1: Data Preparation
1. **Normalize Marking Scheme**: Converts various marking scheme formats to standard structure
   - Handles single image pipeline format
   - Handles unified pipeline format
   - Extracts question-level answers and sub-question answers
   
2. **Extract Input Data**:
   - `cleanDataForMarking`: Cleaned OCR data with steps
   - `cleanedOcrText`: Plain text OCR output
   - `rawOcrBlocks`: Raw OCR blocks with coordinates
   - `classificationStudentWork`: Classification-extracted student work
   - `subQuestionMetadata`: Metadata for grouped sub-questions

#### Step 2: Prompt Selection
Determines which prompt to use:
- **With Marking Scheme** (`withMarkingScheme`): When marking scheme is available
- **Basic** (`basic`): When no marking scheme is available

#### Step 3: AI Call
Calls Gemini API with:
- System prompt (defines marking rules and format)
- User prompt (contains OCR text, marking scheme, classification data)

#### Step 4: Response Parsing
- Parses JSON response from AI
- Handles JSON parsing errors with multiple fix attempts
- Extracts annotations and student score

#### Step 5: Annotation Enrichment
- Maps AI-generated annotations to OCR blocks by `step_id`
- Adds bounding box coordinates from OCR blocks
- Adds `pageIndex` for multi-page documents

### Two-Part Task (With Marking Scheme)

#### PART 1: MAPPING (Segmentation)
- **RAW OCR BLOCKS**: Provide coordinates for placing annotations
  - Include question text AND student work
  - Each block has step IDs (step_1, step_2, step_3...)
  
- **CLASSIFICATION STUDENT WORK**: Source of truth for student work content
  - Contains ONLY student work (already filtered)
  - More accurate than OCR (better LaTeX extraction)
  - Has step IDs (step_1, step_2, step_3...)

- **Mapping Task**: Map each classification step to corresponding OCR block(s) by content similarity
  - Example: Classification step_1 might map to OCR step_3 (because OCR step_1, step_2 are question text)
  - **CRITICAL**: One-to-one mapping - each classification step maps to exactly ONE OCR block

#### PART 2: MARKING
- For each classification step, choose the best content (classification OR OCR) for marking decisions
- **DEFAULT**: Use classification content (it's more accurate)
- **FALLBACK**: Only use OCR if classification would receive 0 marks according to marking scheme
- **MANDATORY**: Output annotations with OCR block step IDs (required for coordinates)

### Output Format

```json
{
  "annotations": [
    {
      "step_id": "step_3",  // REQUIRED: OCR block step ID
      "action": "tick|cross",
      "text": "M1|M1dep|A1|B1|C1|M0|A0|B0|C0|",  // Mark code or empty
      "reasoning": "Brief explanation"
    }
  ],
  "studentScore": {
    "totalMarks": 6,
    "awardedMarks": 4,
    "scoreText": "4/6"
  }
}
```

### Prompts
**File**: `backend/config/prompts.ts` (lines 559-1046)

#### Basic Prompt (No Marking Scheme)
- Simple annotation generation based on mathematical correctness
- Estimates marks if no scheme available

#### With Marking Scheme Prompt
- **System Prompt**: Defines two-part task (mapping + marking)
- **User Prompt**: Contains:
  - Original question text (from fullExamPapers)
  - Raw OCR blocks (with coordinates)
  - Classification student work (grouped by sub-question if applicable)
  - Marking scheme (formatted as bullets)
  - Total marks
  - Sub-question metadata (if grouped)

### Key Rules

1. **Complete Coverage**: Must create annotation for EVERY step in student's work
2. **DO NOT mark question text**: Only mark actual student work
3. **OCR Error Tolerance**: Be flexible with OCR errors (e.g., "bot" → "not")
4. **Drawing Tolerance**: 
   - Classification-extracted coordinates are approximations
   - Focus on concept understanding, not exact coordinate matching
   - **MANDATORY**: Systematic partial credit evaluation before awarding 0 marks
5. **Content Selection**:
   - **DEFAULT**: Use classification (more accurate)
   - **FALLBACK**: Use OCR only if classification would get 0 marks AND OCR might get marks
6. **Step ID Requirement**: Every annotation MUST include `step_id` with OCR block step ID

### Special Handling

#### Grouped Sub-Questions
- Handles questions with multiple sub-parts (e.g., Q12i, 12ii, 12iii)
- Marks each sub-question separately
- Uses corresponding marks for each sub-question

#### Drawings
- Special handling for coordinate grid transformations, histograms, graphs
- Systematic partial credit evaluation
- Lenient evaluation focusing on concept understanding

#### Frequency vs Frequency Density
- If classification says "plotted using frequency values", this is a description, not a judgment
- Must still check if bars are drawn correctly and meet partial credit criteria
- Do NOT award 0 marks just because frequency density wasn't used

---

## Data Flow Between Stages

### Classification → Marking Instruction

1. **Classification Output**:
   - `questions` array with question text and student work
   - Category (questionOnly/questionAnswer/metadata)

2. **Processing**:
   - Classification student work is extracted and formatted
   - Grouped by sub-question if applicable
   - Step IDs assigned (main_step_1, sub_a_step_1, etc.)

3. **Marking Instruction Input**:
   - `classificationStudentWork`: Formatted classification output
   - `rawOcrBlocks`: OCR blocks with coordinates
   - `questionText`: Original question from fullExamPapers
   - `markingScheme`: Normalized marking scheme

4. **Mapping**:
   - Classification steps mapped to OCR blocks by content similarity
   - OCR block step IDs used in annotations (for coordinates)

---

## Key Files

1. **Classification Service**: `backend/services/marking/ClassificationService.ts`
2. **Marking Instruction Service**: `backend/services/marking/MarkingInstructionService.ts`
3. **Prompts**: `backend/config/prompts.ts`
   - Classification prompts: lines 15-329
   - Marking instruction prompts: lines 559-1046
4. **Pipeline Orchestration**: `backend/services/marking/MarkingPipeline.ts`
5. **Multi-Image Processing**: `backend/routes/markingRouter.ts`

---

## Critical Design Decisions

1. **Classification as Source of Truth**: Classification is more accurate than OCR, so it's used as default for marking decisions
2. **OCR for Coordinates**: OCR blocks provide coordinates for placing annotations on images
3. **One-to-One Mapping**: Each classification step maps to exactly one OCR block
4. **Systematic Partial Credit**: Must check all mark levels before awarding 0 marks
5. **Lenient Drawing Evaluation**: Focus on concept understanding, not exact coordinate matching

---

## Error Handling

### Classification
- Falls back to OpenAI if Gemini returns RECITATION errors
- Handles JSON parsing errors with sanitization
- Validates model before API calls

### Marking Instruction
- Handles JSON parsing errors with multiple fix attempts
- Returns empty annotations if AI returns 0 annotations (allows pipeline to continue)
- Validates marking scheme belongs to current question before using

---

## Performance Considerations

1. **Multi-Image Classification**: Classifies all images at once for better cross-page context
2. **Parallel Processing**: OCR and classification can run in parallel
3. **Caching**: Classification results cached for reuse
4. **Token Usage**: Tracks LLM token usage for both stages

