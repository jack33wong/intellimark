## Data Flow: Question & Student Work Only

### Stage 1: Classification

**Input:**
- Images (standardizedPages[])

**Processing:**
- `ClassificationService.classifyMultipleImages()`
- AI extracts question text
- AI extracts student work (if present)

**Design Flow:**
```
┌─────────────────────────────────────────────────────────┐
│                    Input Images                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Page 1  │  │  Page 2  │  │  Page 3  │              │
│  │  Image   │  │  Image   │  │  Image   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│     ClassificationService.classifyMultipleImages()      │
│                                                         │
│  For each image:                                        │
│    1. Send to AI (Gemini/Claude)                        │
│    2. AI analyzes image content                         │
│    3. AI extracts:                                       │
│       - Question text (LaTeX format)                     │
│       - Student work (LaTeX format, if present)         │
│       - Question numbers and sub-questions              │
│       - Category: "questionOnly" | "questionAnswer"    │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│              ClassificationResult                        │
│                                                         │
│  questions: [                                           │
│    {                                                    │
│      questionNumber: "1"                                │
│      text: "Simplify √9"                                │
│      studentWork: "3" (optional)                       │
│      sourceImageIndex: 0                                │
│      subQuestions: [                                    │
│        { part: "a", text: "...", studentWork: "..." } │
│      ]                                                  │
│    }                                                    │
│  ]                                                      │
└─────────────────────────────────────────────────────────┘
```

**Output - Question Data:**
- `ClassificationResult.questions[]`
  - `questionNumber`: "1" | "2" | null
  - `text`: "Question text from image..."
  - `sourceImageIndex`: 0
  - `subQuestions[].part`: "a" | "b"
  - `subQuestions[].text`: "Sub-question text..."

**Output - Student Work Data:**
- `studentWork`: "Student work LaTeX..." (optional)
- `subQuestions[].studentWork`: "Student work..." (optional)

**Student Drawing Extraction:**
- **Text-based work**: Extracted in LaTeX format (e.g., "=\\frac{32}{19}")
- **Drawings**: Always extracted as `[DRAWING]` prefix with description:
  - **Coordinate grids**: Extract exact coordinates for shapes, points, lines, marks
    - Example: `[DRAWING] Triangle drawn at vertices (-3,-1), (-3,0), (-1,-1) [POSITION: x=25%, y=30%]`
    - Example: `[DRAWING] Mark 'F' at (1,2) [POSITION: x=52%, y=30%]`
  - **Histograms/Charts**: Describe bars, heights, intervals
    - Example: `[DRAWING] Histogram with 5 bars: 0-10 (height 3), 10-20 (height 5)... [POSITION: x=50%, y=30%]`
  - **Geometric diagrams**: Describe shapes, angles, constructions
    - Example: `[DRAWING] Angle bisector drawn from vertex A [POSITION: x=50%, y=30%]`
- **Position**: All drawings include `[POSITION: x=XX%, y=YY%]` representing center position on page
- **Multi-line**: Use `\\n` separator between text and drawings
  - Example: `"Rotated 90° clockwise\\n[DRAWING] Triangle at vertices (3,-2), (4,-2), (4,0) [POSITION: x=75%, y=30%]"`

**Notes:**
Question text and student work are extracted as **text strings** (LaTeX format) from images. Student work is optional (only if present in image). Drawings are always marked with `[DRAWING]` prefix and include position coordinates.

---

### Stage 2: Question Detection

**Input - Question Data:**
- `ClassificationResult.questions[].text` (from classification)
- `ClassificationResult.questions[].questionNumber` (optional hint)

**Input - Student Work Data:**
- ❌ Not used in this stage

**Processing:**
1. **Extract Questions**: `extractQuestionsFromClassification()` 
   - Flattens hierarchical structure (main + subQuestions → flat array)
   - Handles multi-page questions (merges questions with same questionNumber across pages)
   - For each question: extracts `{text, questionNumber}`

2. **Question Detection**: For each extracted question:
   - `questionDetectionService.detectQuestion(questionText, questionNumberHint)`
   - **Matching Process**:
     ```
     For each exam paper in database:
       1. Match question number (exact match if hint provided)
       2. Calculate text similarity between classification text and database question text
       3. For main questions: threshold = 0.35 (lowered to handle OCR/classification variations)
       4. For sub-questions: threshold = 0.40
       5. If multiple papers have same confidence:
          - Break tie by checking if database text starts with same words as classification
          - Prefer match where database text prefix matches classification text prefix
     ```
   - **Marking Scheme Lookup**:
     - Find marking scheme matching exam paper (board, qualification, paperCode, year)
     - Extract question marks from marking scheme's `questions[questionNumber]` structure
     - Store `databaseQuestionText` for later filtering

3. **Grouping**: Group sub-questions by base question number and merge marking schemes

**Output - Question Data:**
- `markingSchemesMap: Map<string, SchemeData>`
  - Key format: `"{questionNumber}_{Board}_{PaperCode}"` (e.g., "13_Pearson Edexcel_1MA1/2H")
  - `questionNumber`: "13" (from database)
  - `databaseQuestionText`: "Full question text from database..." (used for filtering OCR blocks)
  - `questionMarks`: {...} (marking scheme criteria)
  - `totalMarks`: 5
  - `board`, `paperCode`, `year`, `tier`

**Output - Student Work Data:**
- ❌ Not used in this stage

**Key Design Decisions:**
- **Lower threshold (0.35)**: Handles OCR/classification variations and multi-page questions
- **Tie-breaking**: When multiple papers match with same confidence, prefer match where database text starts with same words as classification text
- **Database text storage**: `databaseQuestionText` is stored for use in segmentation filtering (more reliable than classification text)

**Notes:**
Question text is **matched with database** to get authoritative question text. Student work from classification is **not used** here (only question text is matched). The `databaseQuestionText` is critical for accurate filtering in segmentation.

---

### Stage 3: OCR Processing

**Input:**
- Images (standardizedPages[])

**Processing:**
- OCR Service (MathPix/Google Vision)
- Extracts all text blocks from images
- Includes both question text AND student work blocks

**Output - All OCR Blocks (Mixed):**
- `allPagesOcrData: PageOcrResult[]`
  - Question text blocks: "Question 1", "Simplify √9"
  - Student work blocks: "40", "5/9", "F"
  - Metadata blocks: "Page 1", "Turn over"

**Block Properties:**
- `mathpixLatex`: "\\text{Question 1}"
- `googleVisionText`: "Question 1"
- `coordinates`: {x, y, width, height}
- `orderIndex`: 0, 1, 2... (reading order)

**Notes:**
OCR extracts **all blocks** (question text + student work + metadata) as **OCR blocks with coordinates**. No distinction yet between question text and student work.

---

### Stage 4: Segmentation

**Input - Question Data:**
- Classification: `questions[].text`
- Database: `markingSchemesMap[].databaseQuestionText` (preferred for filtering)

**Input - Student Work Data:**
- Classification: `questions[].studentWork` (optional, used as whitelist)
- OCR: All blocks (mixed)

**Processing - STEP 1: OCR Block Consolidation**
- Consolidate all OCR blocks from all pages
- Add metadata: `pageIndex`, `globalBlockId`, `originalOrderIndex`
- Filter out empty blocks
- Result: `allMathBlocks[]` with consistent structure

**Processing - STEP 2: Question Flattening**
- Flatten hierarchical questions structure
- Q1 with [a, b] → ["1", "1a", "1b"]
- Handle multi-page questions (merge questions with same questionNumber)
- Result: `flattenedQuestions[]`

**Processing - STEP 3: Y-Coordinate Estimation**
- Group blocks by page
- For each page:
  - Sort blocks by `originalOrderIndex` (reading order)
  - Find blocks with real Y coordinates (reference blocks)
  - For blocks with null Y:
    - Find nearest blocks before/after with real Y
    - Interpolate Y coordinate based on order position
    - If only before block: estimate Y = beforeY + 50px
    - If only after block: estimate Y = afterY - 50px
    - If both: linear interpolation between before and after
- Result: All blocks have Y coordinates (real or estimated)

**Processing - STEP 4: Filter Question Text vs Student Work**
- **Priority-based filtering** using `QuestionTextFilter` class:
  ```
  PRIORITY 0.05: Hardcoded footer patterns (always filter)
  PRIORITY 0.1: Footer patterns (pipes, dashes, page numbers)
  PRIORITY 0.6: Database question text matching (substring match)
  PRIORITY 0.7: Database question text matching (similarity match)
  PRIORITY 1: Database question text matching (main question)
  PRIORITY 2: Database question text matching (sub-questions)
  PRIORITY -1: Classification student work whitelist (conservative, prevent filtering valid student work)
  ```
- **For each OCR block**:
  1. Check classification student work FIRST (PRIORITY -1) - if matches, KEEP
  2. Check database question text (PRIORITY 0.6, 0.7, 1, 2) - if matches, FILTER
  3. Check footer patterns (PRIORITY 0.05, 0.1) - if matches, FILTER
  4. Check question headers, patterns, table data - if matches, FILTER
  5. If uncertain, KEEP (conservative approach to avoid filtering valid student work)
- **Key Matching Methods**:
  - **Database matching**: Uses `calculateOcrToDatabaseSimilarity()` with one-directional substring matching
  - **Classification whitelist**: Uses `findMatchingClassificationLines()` with conservative thresholds (0.60-0.70)
  - **Tie-breaking**: Uses order index when block matches both database question text and classification student work
- Result: Blocks identified as question text or student work

**Processing - STEP 5: Calculate Question Boundaries**
- From filtered question text blocks
- Group questions by `schemeKey` (for grouped sub-questions, calculate one boundary from main question text)
- Calculate `minY`, `maxEndY`, `maxOrderIndex` for each question
- Result: `QuestionBoundary[]` with Y-coordinate ranges

**Processing - STEP 6: Assign Blocks to Questions**
- For each page and each question scheme:
  - For each student work block:
    - Find nearest question boundary ABOVE the block (boundary.endY < blockY)
    - If boundary found and belongs to this scheme: assign block to scheme
    - If no boundary found above: use fallback (order-based assignment)
- **Block-to-Classification Mapping**:
  - Map each OCR block to best matching classification line (one-to-one)
  - If one classification maps to many OCR blocks, take highest confidence one
  - Store in `blockToClassificationMap` for passing classification content to AI
- Result: Blocks assigned to correct schemes based on Y-position

**Output - Question Data:**
- `MarkingTask[]`
  - `questionNumber`: "1"
  - `schemeKey`: "1_AQA_1MA1/1H"
  - `markingScheme`: {questionMarks, totalMarks}
  - `blockToClassificationMap`: Map<blockId, {classificationLine, similarity}>

**Output - Student Work Data:**
- `ocrBlocks[]`: Only student work blocks
  - Blocks with Y > nearest boundary.endY (below question text)
  - Blocks assigned to correct scheme based on Y-position
  - Blocks that match classification `studentWork` (always kept)
  - **Classification content used**: If block maps to classification, use classification line instead of OCR text

**Output - Question Text Blocks:**
- Filtered out (not in `ocrBlocks[]`)

**Key Design Principles:**
1. **Conservative filtering**: When uncertain, KEEP blocks (avoid filtering valid student work)
2. **Priority-based**: Classification whitelist runs FIRST, then database filtering
3. **Database text preferred**: Use `databaseQuestionText` for filtering (more reliable than classification text)
4. **One-directional matching**: Only check if database/classification contains OCR block (not reverse)
5. **Tie-breaking**: Order index used when block matches both question text and student work
6. **Classification content**: Pass classification content to AI instead of OCR when available (more reliable)

**Notes:**
- Y coordinates are estimated from block order when null, ensuring all blocks can be assigned by Y-position
- Question text filtering uses priority-based checks with database matching as primary filter
- Classification student work acts as conservative whitelist to prevent filtering valid student work
- Blocks are assigned by Y-position (nearest boundary above block)
- Classification content is preferred over OCR text when mapping exists

## Question & Student Work Data Transformation Summary

### Question Text Flow:
```
Image → Classification (text string) 
     → Question Detection (database text) 
     → Segmentation (OCR blocks matched to database text)
     → Filtered out (not included in MarkingTask)
```

### Student Work Flow:
```
Image → Classification (text string, optional)
     → OCR (all blocks, mixed)
     → Segmentation:
        - Estimate Y for null Y blocks (from order)
        - Filter question text vs student work (priority-based)
        - Assign by Y-position (nearest boundary above)
        - Map to classification content (if available)
     → MarkingTask.ocrBlocks[] (only student work blocks)
     → AI Marking (uses classification content if mapped, else OCR text)
```

### Key Distinctions:

| Aspect | Question Text | Student Work |
|--------|---------------|--------------|
| **Source in Classification** | `questions[].text` | `questions[].studentWork` (optional) |
| **Source in OCR** | OCR blocks matching question text | OCR blocks NOT matching question text |
| **Final Destination** | ❌ Filtered out (not in MarkingTask) | ✅ Included in `MarkingTask.ocrBlocks[]` |
| **Identification Method** | Priority-based filtering (database matching, patterns) | Negative: not question text + classification whitelist |
| **Y-Position Rule** | Above `boundary.maxEndY` | Below nearest `boundary.endY` (nearest boundary above block) |
| **Y Estimation** | N/A | Estimated from block order if null Y |
| **Assignment Method** | N/A | Y-position only (no text matching) |
| **Content Used for AI** | N/A | Classification content (if mapped) > OCR text |

### Question Detection Details:

**Matching Algorithm:**
1. **Question Number Matching**: If hint provided, only match questions with exact question number
2. **Text Similarity**: Calculate similarity between classification text and database question text
3. **Thresholds**:
   - Main questions: 0.35 (handles OCR/classification variations)
   - Sub-questions: 0.40
4. **Tie-Breaking**: When multiple papers have same confidence:
   - Check if database text starts with same normalized words as classification text
   - Prefer match where database text prefix matches classification text prefix
5. **Marking Scheme Lookup**:
   - Match by board, qualification, paperCode, year (exact paper code match required)
   - Extract question marks from `questions[questionNumber]` structure
   - Store `databaseQuestionText` for filtering

**Multi-Page Questions:**
- Questions with same `questionNumber` across pages are merged
- Question text from page with actual text is used
- Student work from all pages is combined

### Segmentation Filtering Details:

**QuestionTextFilter Priority Order:**
1. **PRIORITY 0.05**: Hardcoded footer patterns (always filter)
2. **PRIORITY 0.1**: Footer patterns (pipes, dashes, page numbers)
3. **PRIORITY 0.6**: Database question text (substring match, sub-questions)
4. **PRIORITY 0.7**: Database question text (similarity match, sub-questions)
5. **PRIORITY 1**: Database question text (main question)
6. **PRIORITY 2**: Database question text (sub-questions, thorough check)
7. **PRIORITY -1**: Classification student work whitelist (conservative, prevent filtering)

**Matching Methods:**
- **Database Matching**: 
  - Uses `calculateOcrToDatabaseSimilarity()` with one-directional substring matching
  - Checks if database text contains OCR block (not reverse)
  - Similarity threshold: 0.50 for main questions, 0.70 for math expressions
- **Classification Whitelist**:
  - Uses `findMatchingClassificationLines()` with conservative thresholds (0.60-0.70)
  - One-directional substring matching (classification contains OCR block)
  - Score normalization based on text length ratio
- **Tie-Breaking**:
  - Uses order index when block matches both database question text and classification student work
  - Prefers classification match if similarity >= 0.70

**Block-to-Classification Mapping:**
- Resolves one-to-many mapping (one classification line → many OCR blocks)
- Takes highest confidence match when multiple blocks map to same classification
- Stores mapping in `blockToClassificationMap` for use in AI marking
- AI uses classification content instead of OCR text when mapping exists (more reliable)
