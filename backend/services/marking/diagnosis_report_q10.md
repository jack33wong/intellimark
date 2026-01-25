# Diagnosis Report: Q10 Annotation Swap & Placement Regression

I have identified the three specific technical failures that caused the regressions in Q10 (Venn Diagram).

## 1. Upstream: OCR Filtering (The Missing 77/100)
**Problem**: The block for `77/100` was missing from the AI prompt's `RAW OCR BLOCKS` list.
**Cause**: In `MarkingInstructionService.ts`, the `sanitizeOcrBlocks` function uses "Vertical Slicing" to isolate the current question. It calculates `yStart` based on the Question 10 header. If a handwriting block is slightly above the header line due to student placement, it is discarded. 
**Impact**: The AI could not link `77/100` because the block didn't exist in its context.

## 2. Middle: Landmark Shadowing (The Inverted Zone)
**Problem**: The Deterministic Linker killed the valid `19/60` link.
**Cause**: The OCR scan found two `(ii)` landmarks (one at Y=595 and one at Y=706).
- The Linker picked the **first** `ii` at 595.
- It defined the zone as `595 to 613` (ending at the next landmark "visited").
- The student's `19/60` block was at **Y=672**, which is outside that tiny 18-pixel zone.
**Impact**: Valid links were rejected as "Out of Zone".

## 3. Downstream: Snapping Logic (The Visual Swap)
**Problem**: Annotations for `10bi` and `10bii` appeared swapped and misplaced.
**Cause**: In `MarkingExecutor.ts` Phase 3 (Spatial Sanitization):
- `10bi` matched the `bi` landmark (Y=559).
- `10bii` failed to match the `ii` landmark because the lookup was an exact key match for `bii`.
- It fell back to the parent landmark `b` at **Y=434**.
**Impact**: `10bii` was moved above `10bi`, creating the visual swap and placing it way too high on the page.

---

## Proposed Fix Strategy (Pending Review)
- **OCR**: Loosen the vertical slice buffer in `MarkingInstructionService.ts`.
- **Landmarks**: Improve landmark deduplication and "End-of-Zone" logic.
- **Snapping**: Update Phase 3 to use `endsWith` matching for sub-question labels.
