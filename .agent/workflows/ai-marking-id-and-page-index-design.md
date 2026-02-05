---
description: Design principles for Physical IDs and Page Indexing in the AI Marking Pipeline
---

# AI Marking "Truth-First" Design Bible

This document defines the mandatory architectural principles for handling Page Indices and Object IDs within the AI Marking Pipeline to prevent the "Annotation Swap" and "Double Mapping" bugs.

## 1. The ID System: "Global-by-Design"
All OCR blocks and AI-generated annotations MUST use a unified identification system rooted in the physical document structure for core processing.

- **Prefix Format**: `p{PhysicalPageIndex}_...` (e.g., `p0_q2_line_1`, `p5_ocr_12`).
- **Physical-First**: Core backend storage uses absolute physical page indices.
- **Sequential Safety**: Never rely on sequential indices that can shift.

## 2. Prompt Architecture: "Clean Relative"
To minimize token waste and AI confusion, the AI Marking Prompt uses a task-relative view.

- **Image Indexing**: Images are labeled `--- Image 0 ---`, `--- Image 1 ---`, etc., within the prompt scope.
- **Filtered Constraints**: The `PAGE ASSIGNMENT CONSTRAINTS` must be filtered to *only* include sub-questions relevant to the current task.
- **Mapping Handshake**: The prompt uses `Image X` (Relative), while the backend handles the invisible `Image X -> Page Y` mapping to preserve physical truth.

| System | Format | Branded Type | Usage |
| :--- | :--- | :--- | :--- |
| **Physical** | `0, 1, 2...` | `GlobalPageIndex` | Document-level truth. Used for SVG rendering. |
| **Relative** | `0, 1...` | `RelativePageIndex` | AI's view of the "Current Selection". |
| **Display** | `1, 2, 3...` | `DisplayPageNumber` | User-facing UI labels. |

### The `isPhysicalPage` Guard
When an annotation is created from an ID containing a `p{N}_` prefix, it MUST be tagged with `isPhysicalPage: true`.
- **Purpose**: This flag signals downstream enrichment services to **BYPASS** legacy "relative-to-absolute" re-mapping logic.
- **Rule**: If `isPhysicalPage` is true, the `pageIndex` is immutable ground truth.

## 3. Label Harmony
Sub-question labels must remain unique and descriptive to prevent lookup collisions.

- **Full Labels**: Always use the full sub-question identifier (e.g., `3a`, `12bii`) instead of stripped versions (e.g., `a`, `bii`).
- **Prevention**: This ensures that if Question 2 and Question 3 both have a "Part A" on the same physical page, they do not collide during the rendering phase.

## 4. Strict Lookup Strategy
All annotation-to-page assignments must be validated against the `subQuestionPageMap`.

- **Mechanism**: The `MarkingTaskFactory` populates a map of `subQuestionLabel -> physicalPageIndex`.
- **Verification**: If an AI returns a mark for `3a` on `p2`, but the `subQuestionPageMap` says `3a` belongs on `p1`, the system must flag this as a potential swap and attempt to rescue or veto the mark.

## 5. Pipeline Discipline
1. **Extraction**: `MarkingExecutor` extracts the `p{N}` prefix and sets the `isPhysicalPage` flag.
2. **Sync**: `AnnotationTransformers` syncs the index with the matched OCR block's `pageIndex`.
3. **Enrichment**: `AnnotationEnrichmentService` respects the `isPhysicalPage` flag and skips guessing.
4. **Rendering**: `MarkingOutputService` uses the `questionNumber` and `subQuestion` to find the correct `semanticZone` on the specific physical page.

> [!IMPORTANT]
> Never assume a `pageIndex` variable is safe to use without checking its brand (Relative vs Global) or its `isPhysicalPage` provenance.
