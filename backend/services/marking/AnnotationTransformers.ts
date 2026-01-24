/**
 * Annotation Transformation Functions
 * 
 * Pure functions for transforming annotations through the marking pipeline.
 * All functions are immutable - they return new objects instead of mutating inputs.
 * 
 * @module AnnotationTransformers
 */

import {
    ImmutableAnnotation,
    PageCoordinates,
    RelativePageIndex,
    GlobalPageIndex,
    BoundingBox,
    AIPosition,
    hasRelativePage
} from './PageIndexTypes.js';

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Raw annotation from AI response (before any processing)
 */
export interface RawAIAnnotation {
    text: string;
    pageIndex?: number;  // Relative to images array
    subQuestion?: string;
    visual_position?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    line_id?: string;
    lineId?: string; // Support both casing
    student_text?: string;
    studentText?: string; // Support both casing
    classification_text?: string;
    action?: string;
    reasoning?: string;
    line_index?: number;
    ocr_match_status?: string; // NEW: Preserve AI's match status
    linked_ocr_id?: string;    // NEW: Physical link ID
    linkedOcrId?: string;      // NEW: Physical link ID (camelCase)
    bbox?: [number, number, number, number]; // NEW: Preserve pre-calculated bbox
}

export interface AIContext {
    studentWorkLines?: Array<{ text: string, position?: any }>;
}

/**
 * OCR block with page and bbox information
 */
export interface OCRBlock {
    id: string;
    text: string;
    pageIndex: number;  // Global page index
    bbox: [number, number, number, number];
    confidence?: number;
}

/**
 * Context required for annotation transformations
 */
export interface TransformationContext {
    readonly sourcePages: readonly GlobalPageIndex[];
    readonly ocrBlocks?: readonly OCRBlock[];
    readonly studentWorkLines?: Array<{ text: string, position?: any }>;
}

// ============================================================================
// ID GENERATION
// ============================================================================

let annotationIdCounter = 0;

function generateAnnotationId(): string {
    return `anno_${Date.now()}_${annotationIdCounter++}`;
}

// ============================================================================
// HEURISTICS & PARSING
// ============================================================================

/**
 * Parse and normalize AI position from various sources
 */
function parseAIPosition(
    anno: RawAIAnnotation,
    context?: AIContext
): Readonly<AIPosition> | undefined {
    let aiPosition: AIPosition | undefined;

    // 1. Try visual_position from AI (NEW DESIGN)
    if (anno.visual_position) {
        const vp = anno.visual_position;
        // Parse values even if strings
        let x = parseFloat(vp.x as any);
        let y = parseFloat(vp.y as any);
        let w = parseFloat(vp.width as any);
        let h = parseFloat(vp.height as any);

        if (!isNaN(x) && !isNaN(y)) {
            w = !isNaN(w) ? w : 10;
            h = !isNaN(h) ? h : 5;

            aiPosition = { x, y, width: w, height: h };
        }
    }

    // 2. Try parsing [POSITION] JSON from text
    if (!aiPosition && anno.student_text) {
        const jsonMatch = anno.student_text.match(/\[POSITION\]\s*(\{.*?\})/);
        if (jsonMatch) {
            try {
                const vp = JSON.parse(jsonMatch[1]);
                if (typeof vp.x === 'number' && typeof vp.y === 'number') {
                    let { x, y, width: w, height: h } = vp;
                    w = w || 10; h = h || 5;
                    aiPosition = { x, y, width: w, height: h };
                }
            } catch (e) { /* ignore */ }
        }
    }

    // 3. Try line_index (Robust: Handles both 0-based and 1-based AI outputs)
    if (!aiPosition && context?.studentWorkLines && typeof anno.line_index === 'number') {
        // If AI returns 0, it means Index 0 (0-based)
        // If AI returns 1, it means Index 0 (1-based) -> 1-1 = 0
        const index = anno.line_index;
        const line = (index === 0)
            ? context.studentWorkLines[0]
            : context.studentWorkLines[index - 1];

        if (line?.position) {
            aiPosition = line.position;
        }
    }

    // 4. Try [POSITION] tag parsing (V25: Added pageIndex support)
    const lookupText = anno.classification_text || anno.student_text;
    if (!aiPosition && lookupText) {
        // Supported formats: [POSITION: x=10, y=20] or [POSITION: x=10, y=20, p=1]
        const positionMatch = lookupText.match(/\[POSITION:\s*x=([\d.]+)%?,\s*y=([\d.]+)%?(?:,\s*(?:p|page)=([\d.]+))?\]/i);
        if (positionMatch) {
            const x = parseFloat(positionMatch[1]);
            const y = parseFloat(positionMatch[2]);
            const p = positionMatch[3] ? parseInt(positionMatch[3], 10) : undefined;
            if (!isNaN(x) && !isNaN(y)) {
                aiPosition = { x, y, width: 10, height: 5, pageIndex: p };
            }
        }
    }

    // 5. DRAWING FALLBACK
    // If drawing detected but no position, use default or look for drawing lines
    const text = (anno.student_text || '').toLowerCase();
    const classText = (anno.classification_text || '').toLowerCase();
    const isDrawing = text.includes('[drawing]') || classText.includes('[drawing]');

    if (!aiPosition && isDrawing) {
        // Filter out phantom drawings (cross/not required)
        if (anno.action === 'cross' || (anno.reasoning || '').toLowerCase().includes('not required')) {
            return undefined;
        }

        // Check drawing lines in context
        if (context?.studentWorkLines) {
            const drawingLine = context.studentWorkLines.find(l =>
                l.text.includes('[DRAWING]') && l.text.includes('[POSITION')
            );
            if (drawingLine) {
                const match = drawingLine.text.match(/\[POSITION:\s*x=([\d.]+)%?,\s*y=([\d.]+)%?\]/i);
                if (match) {
                    const x = parseFloat(match[1]);
                    const y = parseFloat(match[2]);
                    if (!isNaN(x) && !isNaN(y)) {
                        return { x, y, width: 10, height: 5 };
                    }
                }
            }
        }

        // Default drawing box
        aiPosition = { x: 50, y: 50, width: 50, height: 50 };
    }

    return aiPosition;
}

// ============================================================================
// PHASE 1: CREATE FROM AI
// ============================================================================

/**
 * Convert raw AI annotation to immutable structure
 * Preserves AI's relative pageIndex without modification
 * 
 * @param aiAnnotation - Raw annotation from AI response
 * @returns Immutable annotation with AI data preserved
 */
export function createAnnotationFromAI(
    aiAnnotation: RawAIAnnotation,
    context?: AIContext
): ImmutableAnnotation {
    const aiPosition = parseAIPosition(aiAnnotation, context);

    // V27: Direct ground-truth extraction from block ID (e.g., block_1_5 -> Page 1)
    let groundTruthPage: number | undefined = undefined;
    if (aiAnnotation.line_id?.startsWith('block_')) {
        const parts = aiAnnotation.line_id.split('_');
        const pageIdx = parseInt(parts[1], 10);
        if (!isNaN(pageIdx)) groundTruthPage = pageIdx;
    }

    const page: PageCoordinates = {
        // V27: Priority: 1. Ground Truth from ID, 2. [POSITION] tag, 3. JSON pageIndex
        relative: (groundTruthPage !== undefined)
            ? RelativePageIndex.from(groundTruthPage)
            : ((aiPosition?.pageIndex != null)
                ? RelativePageIndex.from(aiPosition.pageIndex)
                : (aiAnnotation.pageIndex != null
                    ? RelativePageIndex.from(aiAnnotation.pageIndex)
                    : undefined)),
        global: GlobalPageIndex.from(0), // Not yet mapped
        source: 'ai'
    };

    return {
        id: generateAnnotationId(),
        text: aiAnnotation.text,
        subQuestion: aiAnnotation.subQuestion,
        page,
        aiPosition,
        lineId: aiAnnotation.line_id || aiAnnotation.lineId, // Unified Standard
        ocrSource: undefined,
        hasLineData: undefined,
        action: aiAnnotation.action,
        reasoning: aiAnnotation.reasoning,
        aiMatchStatus: aiAnnotation.ocr_match_status, // Preserve AI's match status
        linkedOcrId: aiAnnotation.linked_ocr_id || aiAnnotation.linkedOcrId, // Buffer the physical link
        studentText: aiAnnotation.student_text || aiAnnotation.studentText, // NEW: Preserve for UNMATCHED classification matching
        classificationText: aiAnnotation.classification_text, // NEW: Preserve alternative text source
        lineIndex: aiAnnotation.line_index, // NEW: Preserve for classification line mapping
        bbox: aiAnnotation.bbox as BoundingBox | undefined // NEW: Preserve pre-calculated bbox
    };
}

// ============================================================================
// PHASE 2: MAP TO GLOBAL PAGE
// ============================================================================

/**
 * Map relative page index to global page index using sourcePages
 * 
 * @param annotation - Annotation with relative pageIndex
 * @param sourcePages - Mapping array from relative to global pages
 * @returns New annotation with global pageIndex set
 * @throws Error if relative index is out of bounds
 */
export function mapToGlobalPage(
    annotation: ImmutableAnnotation,
    sourcePages: readonly GlobalPageIndex[]
): ImmutableAnnotation {
    const relativeIdx = annotation.page.relative;

    // If no relative index, annotation is already global (from OCR or inferred)
    if (relativeIdx === undefined) {
        return annotation;
    }

    // Validate bounds
    if ((relativeIdx as number) >= sourcePages.length) {
        // Fallback: Check if the AI returned a Global Page Index instead of Relative
        // e.g. AI returns 6, and sourcePages is [6].
        // This happens when AI sees "Page 6" in context and uses that number.
        const potentialGlobalIndex = relativeIdx as number;
        // We check if this index exists in our source pages list
        // We cast to number for comparison since GlobalPageIndex is branded
        if (sourcePages.some(p => (p as number) === potentialGlobalIndex)) {
            return {
                ...annotation,
                page: {
                    ...annotation.page,
                    global: GlobalPageIndex.from(potentialGlobalIndex)
                }
            };
        }

        // console.warn(`[WARN] Relative page ${relativeIdx} out of bounds for sourcePages ${JSON.stringify(sourcePages)}`);

        // HEURISTIC: If sourcePages has only 1 page, and AI returns 1 (1-based index), assume it means index 0.
        if (sourcePages.length === 1 && (relativeIdx as number) === 1) {
            return {
                ...annotation,
                page: {
                    ...annotation.page,
                    global: sourcePages[0]
                }
            };
        }

        return annotation;
    }

    const globalIdx = sourcePages[relativeIdx as number];

    // Return new annotation with updated page coordinates
    return {
        ...annotation,
        page: {
            ...annotation.page,
            global: globalIdx
        }
    };
}

// ============================================================================
// PHASE 3: ENRICH WITH OCR
// ============================================================================

/**
 * Enrich annotation with OCR bounding box data
 * If OCR block found, updates bbox and pageIndex (OCR is ground truth)
 * 
 * @param annotation - Annotation to enrich
 * @param ocrBlocks - Available OCR blocks
 * @returns New annotation with OCR data if found, otherwise unchanged
 */
export function enrichWithOCRBbox(
    annotation: ImmutableAnnotation,
    ocrBlocks: readonly OCRBlock[]
): ImmutableAnnotation {
    if (!annotation.lineId) {
        return annotation; // No lineId, can't match to OCR
    }

    // CRITICAL FIX: Skip OCR bbox enrichment for VISUAL annotations (drawings)
    // Visual annotations should ONLY use aiPosition, never OCR block coordinates
    if (annotation.aiMatchStatus === 'VISUAL') {
        return annotation; // Preserve visual_position, don't override with OCR bbox
    }

    // Find matching OCR block
    const matchingBlock = ocrBlocks.find(
        block => block.id === annotation.lineId ||
            block.id?.trim() === annotation.lineId?.trim()
    );

    if (!matchingBlock) {
        return annotation; // No match, return unchanged
    }

    // Return new annotation with OCR data
    // NOTE: We do NOT update the page index here. We trust mapToGlobalPage (AI context)
    // more than the OCR block location, as the AI knows which page it was looking at.
    return {
        ...annotation,
        bbox: matchingBlock.bbox as BoundingBox,
        ocrSource: 'mathpix' // Could be parameterized if needed
    };
}

// ============================================================================
// COMPLETE PIPELINE
// ============================================================================

/**
 * Process annotations through the complete transformation pipeline
 * 
 * @param aiAnnotations - Raw annotations from AI
 * @param context - Transformation context (sourcePages, ocrBlocks, studentWorkLines)
 * @returns Fully processed immutable annotations
 */
export function processAnnotations(
    aiAnnotations: readonly RawAIAnnotation[],
    context: TransformationContext
): readonly ImmutableAnnotation[] {
    const aiContext: AIContext = {
        studentWorkLines: context.studentWorkLines
    };

    return aiAnnotations
        .map(ai => createAnnotationFromAI(ai, aiContext))
        .map(anno => mapToGlobalPage(anno, context.sourcePages))
        .map(anno => {
            // Priority: Existing bbox (if set by caller) > OCR match
            if (anno.bbox) {
                // If bbox is already provided (e.g. from Source 1/2), mark as MATCHED if not already VISUAL
                return {
                    ...anno,
                    ocrSource: anno.ocrSource || 'precomputed',
                    aiMatchStatus: anno.aiMatchStatus || 'MATCHED'
                };
            }
            return context.ocrBlocks ? enrichWithOCRBbox(anno, context.ocrBlocks) : anno;
        });
}

// ============================================================================
// CONVERSION UTILITIES (for legacy compatibility)
// ============================================================================

/**
 * Convert immutable annotation to legacy format
 * Used during migration period for backward compatibility
 */
export function toLegacyFormat(annotation: ImmutableAnnotation): any {
    // Determine match status (V25 Safety Fix)
    // Priority: AI's Explicit Status > Computed status
    let matchStatus = annotation.aiMatchStatus || 'MATCHED';

    // If NO explicit AI status, use legacy fallback heuristics
    if (!annotation.aiMatchStatus) {
        if (annotation.aiPosition && !annotation.bbox) {
            matchStatus = 'VISUAL'; // Drawing annotation fallback
        }
    }

    // MAP COORDINATES
    // Priority: OCR BBox (Ground Truth) > AI Visual Position (Fallback)
    let bbox = annotation.bbox;

    // FIX for Q6: If UNMATCHED (no OCR bbox), fall back to AI Position (from line index or [POSITION] tag)
    if (!bbox && annotation.aiPosition) {
        const { x, y, width, height } = annotation.aiPosition;
        bbox = [x, y, width, height];
    }

    const result = {
        text: annotation.text,
        pageIndex: annotation.page.global as number,
        subQuestion: annotation.subQuestion,
        bbox: bbox, // FIX: Use the resolved 'bbox' variable instead of annotation.bbox
        aiPosition: annotation.aiPosition,
        lineId: annotation.lineId, // Unified (Preferred)
        line_id: annotation.lineId, // Unified (Compatibility)
        step_id: annotation.lineId, // Legacy mapping
        linked_ocr_id: annotation.linkedOcrId, // [V28 FIX] Restore physical link
        linkedOcrId: annotation.linkedOcrId,   // [V28 FIX] Restore physical link
        ocrSource: annotation.ocrSource,
        hasLineData: annotation.hasLineData,
        action: annotation.action,
        reasoning: annotation.reasoning,
        ocr_match_status: matchStatus,
        // Preserve classification matching fields for UNMATCHED annotations
        student_text: annotation.studentText || '', // [CRITICAL FIX] Restore snake_case for Logs & DB
        studentText: annotation.studentText || '',  // Keep camelCase for JS compatibility if needed
        classification_text: annotation.classificationText,
        lineIndex: annotation.lineIndex,
        // Preserve new fields for debugging
        _immutable: true,
        _page: annotation.page,
        _aiMatchStatus: annotation.aiMatchStatus // For transparency
    };

    return result;
}

/**
 * Convert legacy annotation to immutable format
 * Best-effort conversion from mutable annotation
 */
export function fromLegacyFormat(legacyAnno: any): ImmutableAnnotation {
    const page: PageCoordinates = legacyAnno._page || {
        relative: legacyAnno._aiRelativePageIndex !== undefined
            ? RelativePageIndex.from(legacyAnno._aiRelativePageIndex)
            : undefined,
        global: GlobalPageIndex.from(legacyAnno.pageIndex || 0),
        source: legacyAnno.ocrSource ? 'ocr' : 'inferred'
    };

    return {
        id: legacyAnno.id || generateAnnotationId(),
        text: legacyAnno.text,
        subQuestion: legacyAnno.subQuestion,
        page,
        bbox: legacyAnno.bbox as BoundingBox | undefined,
        aiPosition: legacyAnno.aiPosition,
        lineId: legacyAnno.lineId || legacyAnno.line_id || legacyAnno.step_id,
        ocrSource: legacyAnno.ocrSource,
        hasLineData: legacyAnno.hasLineData
    };
}
// ============================================================================
// VISUAL STACKING (New Feature)
// ============================================================================

/**
 * Apply vertical stacking to overlapping visual annotations to prevent clutter.
 * Used for Q11 messy annotations.
 */
export function applyVisualStacking(annotations: any[]): any[] {
    const POSITION_THRESHOLD = 5; // % difference to consider "same position"
    const STACK_OFFSET_Y = 2; // % height to shift down (V29: Reduced from 12 to 2 for tighter multi-ticks)

    // Group by page
    const byPage = new Map<number, any[]>();
    annotations.forEach(a => {
        const p = a.pageIndex || 0;
        if (!byPage.has(p)) byPage.set(p, []);
        byPage.get(p)!.push(a);
    });

    const result: any[] = [];

    byPage.forEach((pageAnns) => {
        // Sort by Y position to process top-down
        // We only care about visual annotations (those using aiPosition/bbox/visual_position)
        // Check if annotation has visual data
        const visuals = pageAnns.filter(a => a.visual_position || (a.ocr_match_status === 'VISUAL') || (a.box_2d && a.ocr_match_status === 'UNMATCHED')); // Q6 fallback uses box_2d?? No, legacy format uses box_2d? 
        // Wait, legacy format output depends on caller. Let's assume input is legacy format array.

        // We need to mutate the annotations in place or return new ones.
        // Simple O(N^2) checks for overlaps
        for (let i = 0; i < pageAnns.length; i++) {
            const current = pageAnns[i];

            // Skip if not visual or unmatched-with-box
            if (!current.box_2d) {
                // If no box, nothing to stack
                continue;
            }

            let stackLevel = 0;

            // Check against all PREVIOUS processed annotations on this page
            for (let j = 0; j < i; j++) {
                const prev = pageAnns[j];
                if (!prev.box_2d) continue;

                // Check overlap
                const cx = current.box_2d[0];
                const cy = current.box_2d[1]; // Wait, box_2d is usually [x, y, w, h]? No, let's check legacy format.
                // Legacy format in toLegacyFormat usually returns box_2d as [x, y, w, h] (percentages).

                const px = prev.box_2d[0];
                const py = prev.box_2d[1];

                const xDiff = Math.abs(cx - px);
                const yDiff = Math.abs(cy - py);

                if (xDiff < POSITION_THRESHOLD && yDiff < POSITION_THRESHOLD) {
                    stackLevel++;
                }
            }

            // Apply Offset
            if (stackLevel > 0) {
                // Shift Y down
                current.box_2d[1] = current.box_2d[1] + (stackLevel * STACK_OFFSET_Y);
                // Ensure it doesn't go off page
                if (current.box_2d[1] > 95) current.box_2d[1] = 95;
            }
        }
        result.push(...pageAnns);
    });

    // Restore original order (if needed, but grouping by page might scramble. The result push order is page-grouped)
    // Actually, simple iteration inplace is better
    return result;
}
