---
description: System design rules for the AI Marking System to ensure consistency and prevent accidental over-simplification.
---

# AI Marking System Design Bible
You MUST follow these rules when editing any files related to AI marking (e.g., MarkingInstructionService.ts, MarkingExecutor.ts, MarkingPipelineService.ts, or any prompt files).

## 1. Source of Truth (The Logic Layer)
- **STUDENT WORK (STRUCTURED)** (passed as `classificationStudentWork`) is the absolute source of truth for the student's mathematical logic.
- The AI must analyze the math in the *Logical Work* list to decide if a mark is earned.
- **NEVER** trust raw OCR text over the structured classification lines for logical evaluation.

## 2. Positioning & ID Mapping (The Visual Layer)
- **The "Match" Protocol**:
    1. **Primary**: Find a **RAW OCR BLOCK** (`block_X_Y`) that contains the same value/content as the student's logical line. Map the annotation to that ID for precise positioning.
    2. **Secondary (Fallback)**: If no OCR block matches, use the classification placeholder ID (`line_X`).
- **Re-Homing Mandate**: The backend Sanitizer must actively "re-home" floating annotations (those matched to printed text or unanchored lines) back to their corresponding handwritten source in the Classification data.

## 3. Coordinate Systems (CRITICAL)
- **Zero-Ambiguity Output**: The backend MUST convert all coordinates into **0-100 Percentages** (x: 50.5 = 50.5%) before sending them to the frontend.
- **Input Handling**: Treat input coordinates as **Pixels** by default. Only scale them if they are explicitly detected as relative (0-1).
- **Zone Enforcement**: Annotations for sub-questions (e.g., 10a, 10b) must be visually constrained to their respective semantic zones on the page. If an annotation drifts out of its zone, snap it back to the zone header.

## 4. Prompt Architecture (The "Chief Examiner" Framework)
- **Immutable Headers**: Do NOT remove or simplify these markers. They provide essential context:
    - `[GENERIC_GCSE_LOGIC]`: Contains the Mark Budgeting and "Guillotine" pruning logic.
    - `[OFFICIAL SCHEME]`: Contains question-specific marking criteria.
    - `[SUB-QUESTION X]`: Explicitly delimits nested sub-questions in the student work.
- **No Over-Marking**: The system uses a "Capacity Pool". Annotations must be pruned to fit the total marks available.

## 5. Marking Heuristics
- **The Guillotine**: If the AI finds more correct steps than marks available, it must drop the earliest/weakest method marks (M-marks) in favor of the final accuracy marks (A-marks).
- **Atomic Marks**: The system prefers atomic marks (1 point each). Do not group multiple codes (e.g., "M1 A1") into a single annotation text field.

## 6. Diagnostic Logging
- **Visual Audit**: Logs must clearly indicate the "Re-homing" process (e.g., `🎯 Re-homed to "77/100"`).
- **Coordinate Audit**: Logs must show the coordinate transformation to ensure Pixel-to-Percentage conversion is happening.

---
**Verdict**: This enhanced version is 100% aligned with the working system.
