---
description: Design principles and technical logic for Zone Creation and Page Alignment.
---

# Zone Creation Design Bible (v1.1)

This document defines the core architecture for how the system aligns physical pages with logical questions and determines the spatial boundaries (zones) for marking.

## 1. Physical-to-Logical Alignment (The Straightener)

The system must ensure that physical page indices match the logical sequence of the exam. This prevents "Warp Speed" errors where a zone detector looks for the next question on a distant page.

### The Truth-First Sorting Hierarchy
Re-indexing occurs **after** Stage 3 (Database Verification).

1.  **Tier 1: Metadata (P0)**: Front covers and instruction pages are always pinned to the top.
2.  **Tier 2: Ground Truth**: Pages are sorted by the lowest verified question number detected on them.
    *   **Past Paper**: Uses **Database Verified** question numbers.
    *   **Non-Past Paper**: Uses **AI Classification** question numbers.

### The Fail-Fast Directive (Past Papers ONLY)
- **STRICT PROHIBITION**: For Past Papers, there is NO Tier 3 fallback to "Original Physical Order."
- **HALT ON SILENCE**: If any page (that is not Tier 1 Meta) contains zero detected question landmarks, the system must **HALT** with a "Detection Integrity Failure."
- **EXCEPTIONS**: A page can only proceed without a landmark if it is a **Ghost Page** (physically situated between two identified questions and correctly backfilled). If it is a "Lone Ghost" that cannot be anchored, it is a failure.
- **RATIONALE**: Fallbacks hide detection errors. If the system can't prove where a page belongs, it must not guess. Scrambled pages are a critical failure.

### Sorting Modes & Edge Cases
The sorting strategy differs based on the **Source of Authority**.

#### 1. Past Paper Mode (Authority: Database)
- **Primary Rules**: 00 (Meta) -> Question Sequence -> Backfilled Sequence.
- **Fail-Fast**: If a page contains zero detected question landmarks and is not a backfilled neighbor, it is a **Detection Integrity Failure**. **HALT IMMEDIATELY**.
- **Prohibition**: Never use "Original Physical Order" as a fallback for missing data. It is better to crash than to scramble an exam.

#### 2. Non-Past Paper/Homework (Authority: User Intent)
- **Primary Rules**: 00 (Meta) -> Classified Question Number.
- **Graceful Fallback**: If a page is unidentified (e.g., a blank sheet or drawing), it must maintain its **Original Physical Order** relative to its identified neighbors.
- **Rationale**: There is no "Ground Truth" to prove the AI missed something; therefore, the user's upload sequence is the final authority.

### Ghost Page & Pointer Synchronization (Section 1.2 Updated)
A **Ghost Page** is a page with no detected text landmarks (e.g., a drawing-only page).
- **Backfilling**: If Page N is Q1 and Page N+2 is Q2, then Page N+1 is logically assigned to "Q1 Continuation."
- **Pointer Sync**: When a page is re-indexed from `OriginalIndex_12` to `PhysicalIndex_0`, the `sourceImageIndex` property on all associated `Question` objects MUST be updated to `0` **before** any downstream component (Zone Detector) receives the data.
 Page $K+1$, the system **backfills** Page $K$ into the zone of Question $N$.
*   **Expansion Rule**: A question zone expands horizontally across all intervening pages until it hits the **Sequential Terminator** (the next question's header).
*   **Visual Representation**: In the backend, these are stored as `semanticZones`. A backfilled page will have a zone with `startY=0` and `endY=100` (Full Page Coverage).
*   **Authority**: Backfilling is determined by the **Logical Re-indexing** order. It ensures that the marker never encounters a "Dead Zone" between questions.

---

## 2. The Sequential Terminator (The Stopper)

To prevent a single question's zone from consuming the entire document, the system implements a strict "Stopper" logic.

### 2.1 "Warp Speed" Protection
- **Constraint**: A single question zone cannot jump more than **2 pages** ahead from its starting point unless a very high-confidence match ($>0.95$) is found.
- **Reason**: Prevents OCR hallucinations on later pages from creating giant, empty zones.

### 2.2 The Ground-Truth Stopper
When searching for Question $N$, the system must stop immediately if it encounters a block representing Question $N+1$.

- **Heuristic: Strong Stop**: If the text contains the explicit keyword `"Question X"` or `"Q X"`, it is a definitive header. The search MUST stop.
- **Heuristic: Weak Stop**: If the text is a "Naked Digit" (e.g., just `"3"`), it might be a summary table or part of a math expression.
    *   **Rule**: Only stop on a naked digit if a "decent" match ($>0.6$) for the *current* question has already been found.

---

## 3. Normalization & Stripping

### Case-Insensitivity & Symbol Stripping
For comparison purposes ONLY, question numbers are normalized:
- `Q3`, `Question 3`, `3.` $\to$ `3`
- `12(a)`, `12a`, `(a)` $\to$ `12a` or `a` (depending on context)

### Math Protection
The system MUST NOT strip digits that are followed by mathematical operators ($+, -, \times, \div, =$).
- *Correct*: `3. Calculate` $\to$ `Calculate`
- *Prevented*: `3 + 2` $\to$ `+ 2` (Incorrect - this is math content)

---

## 4. Generic vs. Past Paper Logic

| Feature | Past Paper (Matched) | Generic (No Match) |
| :--- | :--- | :--- |
| **Source of Truth** | Database (Ground Truth) | AI Extraction |
| **Sorting** | Numeric (DB Order) | Upload Order |
| **Segmentation** | Strict (Landmark-based) | Loose (Proximity-based) |

---

## 5. Visual Sovereignty (Drawings)

- **Rule**: Drawings and coordinate-based tasks (graphs, grids) use `ocr_match_status: "VISUAL"`.
- **Prohibition**: Never attempt to "snap" or "re-align" VISUAL coordinates to text blocks. The visual position provided by the AI is the absolute authority.
---

## 6. Appendix: Mapping Scenarios & Zone Examples

### Scenario A: Normal Case (1-to-1)
*   **Setup**: Q1 is on Page 1, Q2 is on Page 2.
*   **Result**: 
    *   **Zone Q1**: Starts at Page 1, Y=0. Ends at Page 1, Y=Bottom.
    *   **Zone Q2**: Starts at Page 2, Y=0. Ends at Page 2, Y=Bottom.
*   **Logic**: First question on a page always snaps to Y=0 to capture headers.

### Scenario B: Dense Page (Multi-Question)
*   **Setup**: Page 3 contains Question 3, Question 4, and Question 5.
*   **Result**:
    *   **Zone Q3**: Starts at P3, Y=0. Ends at P3, Y=Start of Q4.
    *   **Zone Q4**: Starts at P3, Y=Start of Q4. Ends at P3, Y=Start of Q5.
    *   **Zone Q5**: Starts at P3, Y=Start of Q5. Ends at P3, Y=Bottom.

### Scenario C: Spanning Question (The "Ghost Page" Bridge)
*   **Setup**: Q6 starts on Page 4. Page 5 has no headers (just a large graph). Q7 starts on Page 6.
*   **Result**:
    *   **Zone Q6**: 
        *   Page 4: Starts at Y=Start of Q6. Ends at Y=Bottom.
        *   Page 5: Starts at Y=0. Ends at Y=Bottom. (**UPSTREAM BACKFILL**)
    *   **Logic**: Since Q7 is on P6, the system bridge-expands Q6 to cover the entire empty P5.

### Scenario D: Edge Case - Multi-Page Sub-questions
*   **Setup**: Q10a is on Page 7. Q10b is on Page 8.
*   **Result**:
    *   **Zone Q10a**: Page 7, Y=Start. Ends at Page 7, Y=Bottom.
    *   **Zone Q10b**: Page 8, Y=0. Ends at Page 8, Y=Bottom.
*   **Note**: Because 10b is the *next* logical question, it acts as the terminator for 10a's search on Page 7.

### Scenario E: Header Absorption (The Intro Problem)
*   **Setup**: Page 9 says "Question 11" followed by "11(a) Calculate...".
*   **Result**: 
    *   The landmark "Question 11" is **Absorbed** into "11a".
    *   **Zone Q11a**: Starts at Page 9, Y=0 (capturing the 'Question 11' header).
    *   **Reasoning**: Prevents the parent "11" from creating a narrow, useless zone at the top while the child "11a" starts lower.

---

## 7. Zone Fidelity (The Source of Truth)

1.  **Downstream Respect**: Once a zone is defined during the **Question Detection** stage (as `semanticZones`), all downstream components (Executor, SVG Renderer, Annotation Snapper) must treat it as the **Sacred Boundary**.
2.  **Reuse vs. Recalculation**: Components MUST NOT attempt to re-detect or loosely re-calculate zones. They must retrieve the existing zone via the `questionId`.
3.  **Coordinate Sovereignty**: The `(x, y, width, height)` produced by the Detection Engine (Mathpix-compatible pixels) is the primary source of truth. 
4.  **Visual Debug Consistency**: The "Red Box" shown in debug mode must be the exact same rectangle used for **Zone Protection** logic. If an icon is clamped, it must be clamped to the boundaries defined in the detection stage.
