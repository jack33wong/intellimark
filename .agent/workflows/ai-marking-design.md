---
description: System design rules for the AI Marking System to ensure consistency and prevent accidental over-simplification.
---

# AI Marking System Design Bible (v2.1)
You MUST follow these rules when editing any files related to AI marking.

## 1. Source of Truth (The "Rescue" Hierarchy)
We use a Primary + Fallback system to determine if a student is correct.

**TIER 1 (PRIMARY): STUDENT WORK (STRUCTURED)**
- **Rule**: This Classification Transcript is the default source for grading logic. If it matches the Scheme, Award the Mark.

**TIER 2 (FALLBACK): RAW OCR BLOCKS (THE "RESCUE" LAYER)**
- **Trigger**: Use this ONLY if the Classification Transcript is WRONG or MISSING but the student actually wrote the correct answer.
- **Rule**: If Classification misses a correct answer but the RAW OCR BLOCKS clearly show it, award the mark. We give the student the benefit of the doubt if the OCR captured the ink correctly.

## 2. Data Ingestion Protocol (The "Unfiltered" Constraint)
**THE UNRELIABLE TYPE CONSTRAINT**:
- We CANNOT trust OCR type indicators (e.g., "handwriting" vs "printed").
- **Consequence**: The Prompt will receive ALL OCR blocks (mixed student work and question text).

**THE NOISE FILTER**:
- The System ONLY removes structural noise: Headers, Footers, and Barcodes.

**THE AI'S BURDEN**:
- Since the system cannot filter printed text, YOU (The AI) are the filter.
- You must use Semantic Judgment to distinguish between "Question Instructions" (Ignore) and "Student Answers" (Match).

## 3. The Match Protocols
### A. Text Logic (The Block Mandate)
- **APPLICABILITY**: Numbers, equations, and text-based logic.
- **LAW**: You MUST find a physical `block_ID` for every match.

**THE "INSTRUCTION BLINDNESS" RULE**:
- **FORBIDDEN ANCHORS**: NEVER anchor a mark to a block that reads like Question Text (e.g., "Calculate...", "Draw...", "Explain...").
- **LAW**: Linked marks to question headers is a DESIGN VIOLATION.

**THE "HANDWRITING SAFETY VALVE" (UNMATCHED)**:
- **POSITIVE MATCH**: `ocr_match_status: "UNMATCHED"` is a REWARDING and high-confidence state. 
- **PURPOSE**: Use this when you see valid Student Work that is MISSING from the `RAW OCR BLOCKS` list.
- **LAW**: It is 100% better to return `UNMATCHED` (with no `line_id`) than to anchor a mark to an instruction block. `UNMATCHED` tells the system: "I see the work, even if OCR missed it."

### B. Drawing Logic (Visual Sovereignty)
- **APPLICABILITY**: Sketches, diagrams, graphs.
- **LAW: FORCE VISUAL MODE**:
    - For any drawing task, you MUST use `ocr_match_status: "VISUAL"`.
    - **IGNORE TEXT**: Even if the student wrote labels inside the drawing, do NOT anchor to that text block.
- **POSITIONING**:
    - **NO block_ID**: Do not return a `line_id`.
    - **ESTIMATION**: You must visually estimate the drawing's bounding box (0-100%) and return it as `visual_position`.

### C. Universal Golden Rules
- **ATOMICITY**: One mark code per annotation (e.g., "B1", not "M1 A1").
- **ONE-SHOT**: A list like "36 or 19" is single-use. Award ONE mark only.
- **CONTEXT ISOLATION**: Respect page boundaries.
- **ZERO-FEEDBACK**: Pure JSON. No chat.
- **MARGIN BLINDNESS**: Ignore printed mark counts (e.g., `[3]`).
- **GUILLOTINE**: Strict adherence to [MAX SCORE].

## 4. Coordinate Systems
- **Text**: `line_id` -> `block_ID` lookup.
- **Visual**: `visual_position` -> AI Estimation.
