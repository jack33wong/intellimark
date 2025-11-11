
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
- `ClassificationResult.questions[].text`
- `ClassificationResult.questions[].questionNumber`

**Input - Student Work Data:**
- ❌ Not used in this stage

**Processing:**
- `extractQuestionsFromClassification()` → Flattens main + subQuestions
- For each question: `questionDetectionService.detectQuestion()` → Matches with database → Gets `databaseQuestionText`

**Output - Question Data:**
- `markingSchemesMap: Map<string, SchemeData>`
  - `questionNumber`: "1" (from database)
  - `databaseQuestionText`: "Full question text from database..."
  - `questionMarks`: {...}
  - `totalMarks`: 5

**Output - Student Work Data:**
- ❌ Not used in this stage

**Notes:**
Question text is **matched with database** to get authoritative question text. Student work from classification is **not used** here (only question text is matched).

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
- `orderIndex`: 0, 1, 2...

**Notes:**
OCR extracts **all blocks** (question text + student work + metadata) as **OCR blocks with coordinates**. No distinction yet between question text and student work.

---

### Stage 4: Segmentation

**Input - Question Data:**
- Classification: `questions[].text`
- Database: `markingSchemesMap[].databaseQuestionText`

**Input - Student Work Data:**
- Classification: `questions[].studentWork` (optional)
- OCR: All blocks (mixed)

**Processing - STEP 1:**
- Consolidate OCR blocks → Add `pageIndex`, `globalBlockId`, `originalOrderIndex`
- Filter out empty blocks

**Processing - STEP 2:**
- Flatten questions → Q1 with [a, b] → ["1", "1a", "1b"]

**Processing - STEP 3: Estimate Y Coordinates for Blocks with Null Y:**
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

**Processing - STEP 4: Identify Question Text and Student Work Blocks (Single Pass):**
- For each OCR block:
  - Check if matches classification `studentWork` → Add to `studentWorkBlocks[]`
  - Check if matches question text (similarity ≥ 0.70) → Add to `questionTextBlocks[]`
  - Check if metadata → Add to `questionTextBlocks[]`
  - Otherwise → Add to `studentWorkBlocks[]` (default)
- Result: Both `questionTextBlocks[]` and `studentWorkBlocks[]` identified in one pass

**Processing - STEP 5: Calculate Boundaries:**
- From `questionTextBlocks[]`
- Calculate `minY`, `maxEndY`, `maxOrderIndex` for each question
- Result: `QuestionBoundary[]`

**Processing - STEP 6: Apply Y-Position Check and Assign to Schemes:**
- For each scheme on each page:
  - For each `studentWorkBlock`:
    - Find nearest question boundary ABOVE the block (boundary.endY < blockY)
    - If boundary found:
      - Check if boundary belongs to this scheme
      - If yes: assign block to scheme
    - If no boundary found above: skip (handled by fallback)
  - Fallback for blocks with null Y (if estimation failed):
    - Use order-based assignment (assign to same question as nearest assigned block)
- Result: Blocks assigned to correct schemes based on Y-position

**Output - Question Data:**
- `MarkingTask[]`
  - `questionNumber`: "1"
  - `schemeKey`: "1_AQA_1MA1/1H"
  - `markingScheme`: {questionMarks, totalMarks}

**Output - Student Work Data:**
- `ocrBlocks[]`: Only student work blocks
  - Blocks with Y > nearest boundary.endY (below question text)
  - Blocks assigned to correct scheme based on Y-position
  - Blocks that match classification `studentWork` (always kept)

**Output - Question Text Blocks:**
- Filtered out (not in `ocrBlocks[]`)

**Notes:**
- Y coordinates are estimated from block order when null, ensuring all blocks can be assigned by Y-position
- Single pass identifies both question text and student work blocks
- Y-position assignment uses nearest boundary above block (handles multiple schemes on same page)
- No text matching in assignment step - only Y-position and order-based fallback

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
        - Filter question text vs student work
        - Assign by Y-position (nearest boundary above)
     → MarkingTask.ocrBlocks[] (only student work blocks)
```

### Key Distinctions:

| Aspect | Question Text | Student Work |
|--------|---------------|--------------|
| **Source in Classification** | `questions[].text` | `questions[].studentWork` (optional) |
| **Source in OCR** | OCR blocks matching question text | OCR blocks NOT matching question text |
| **Final Destination** | ❌ Filtered out (not in MarkingTask) | ✅ Included in `MarkingTask.ocrBlocks[]` |
| **Identification Method** | Text similarity match (≥0.70) | Negative: not question text + Y position check |
| **Y-Position Rule** | Above `boundary.maxEndY` | Below nearest `boundary.endY` (nearest boundary above block) |
| **Y Estimation** | N/A | Estimated from block order if null Y |
| **Assignment Method** | N/A | Y-position only (no text matching) |

