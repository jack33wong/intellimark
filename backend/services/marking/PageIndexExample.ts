/**
 * Example Usage: New Immutable Page Index Architecture
 * 
 * Demonstrates how to use the new type-safe immutable annotation system
 * in place of the old mutable approach.
 */

import {
    ImmutableAnnotation,
    GlobalPageIndex,
    RelativePageIndex,
    DisplayPageNumber
} from './PageIndexTypes.js';

import {
    RawAIAnnotation,
    OCRBlock,
    createAnnotationFromAI,
    mapToGlobalPage,
    enrichWithOCRBbox,
    processAnnotations,
    toLegacyFormat
} from './AnnotationTransformers.js';

// ============================================================================
// EXAMPLE: Q3 Drawing Annotation (Multi-page question)
// ============================================================================

// Scenario: Q3 spans pages 4-5 (global indices 3-4)
// AI analyzed 2 images and returned drawing annotation on second image

const sourcePages: readonly GlobalPageIndex[] = [
    GlobalPageIndex.from(3),  // First image = Page 4
    GlobalPageIndex.from(4)   // Second image = Page 5
];

// Raw AI response for Q3b drawing
const aiResponse: RawAIAnnotation = {
    text: "M1 A1",
    pageIndex: 1,  // Relative: "second image"
    subQuestion: "b",
    visual_position: { x: 10, y: 10, width: 70, height: 60 },
    line_id: "drawing_3_27",
    action: "tick",
    reasoning: "Correct drawing"
};

// ===== TRANSFORMATION PIPELINE =====

// Phase 1: Create immutable annotation from AI
const annotation1 = createAnnotationFromAI(aiResponse);
console.log("Phase 1 - From AI:");
console.log(`  Relative page: ${annotation1.page.relative}`);  // 1
console.log(`  Action: ${annotation1.action}`);                // 'tick'
console.log(`  Global page: ${annotation1.page.global}`);      // 0 (not yet mapped)
console.log(`  Source: ${annotation1.page.source}`);          // 'ai'

// Phase 2: Map to global page
const annotation2 = mapToGlobalPage(annotation1, sourcePages);
console.log("\nPhase 2 - After mapping:");
console.log(`  Relative page: ${annotation2.page.relative}`);  // 1 (preserved)
console.log(`  Global page: ${annotation2.page.global}`);      // 4 ✅
console.log(`  Source: ${annotation2.page.source}`);          // 'ai'

// Phase 3: Enrich with OCR (if available)
const ocrBlocks: OCRBlock[] = [
    {
        id: "block_3_8",
        text: "some text",
        pageIndex: 3,
        bbox: [100, 200, 50, 30]
    }
]; // No OCR for drawing, so no change

const annotation3 = enrichWithOCRBbox(annotation2, ocrBlocks);
console.log("\nPhase 3 - After OCR:");
console.log(`  Has bbox: ${annotation3.bbox !== undefined}`);  // false (no OCR match)
console.log(`  Global page: ${annotation3.page.global}`);      // 4 (unchanged)

// Convert to display page number
const displayPage = DisplayPageNumber.fromGlobal(annotation3.page.global);
console.log(`\n  Display: Page ${displayPage}`);  // "Page 5" ✅

// ============================================================================
// EXAMPLE: Complete pipeline (shorthand)
// ============================================================================

const allAnnotations = processAnnotations(
    [aiResponse],
    { sourcePages, ocrBlocks }
);

console.log("\nComplete pipeline result:");
console.log(JSON.stringify(allAnnotations[0], null, 2));

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================

// Convert to legacy format for existing code
const legacyAnnotation = toLegacyFormat(annotation3);
console.log("\nLegacy format:");
console.log(`  pageIndex: ${legacyAnnotation.pageIndex}`);  // 4
console.log(`  _immutable: ${legacyAnnotation._immutable}`);  // true

// ============================================================================
// TYPE SAFETY DEMO
// ============================================================================

// ❌ This won't compile - can't mix relative and global:
// const badMapping: GlobalPageIndex = annotation1.page.relative;  // Type error!

// ✅ This is safe - explicit conversion:
const safeMapping: GlobalPageIndex = annotation2.page.global;  // OK

console.log("\n✅ Type safety working - can't accidentally mix coordinate systems!");
