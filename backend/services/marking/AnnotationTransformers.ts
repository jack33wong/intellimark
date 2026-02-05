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
    text: string;                 // Mark Code (M1, A0, etc.)
    action: 'tick' | 'cross';
    line_id: string | null;       // The Pointer
    content_desc?: string;        // Optional (Drawings only)
    reasoning?: string;
    subQuestion?: string;
    pageIndex?: number;           // Relative page
    visual_position?: {           // Optional (Drawings only)
        x: number;
        y: number;
        width: number;
        height: number;
    };
    ocr_match_status?: string;    // AI's internal status
    linked_ocr_id?: string;       // Linked OCR block ID
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
    bbox?: [number, number, number, number];
    coordinates?: { x: number; y: number; width: number; height: number };
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

    // 2. Try [POSITION] tag parsing (V25: Added pageIndex support)
    // Only used as fallback if visual_position is not in JSON
    if (!aiPosition && anno.reasoning) {
        // Supported formats: [POSITION: x=10, y=20] or [POSITION: x=10, y=20, p=1]
        const positionMatch = anno.reasoning.match(/\[POSITION:\s*x=([\d.]+)%?,\s*y=([\d.]+)%?(?:,\s*(?:p|page)=([\d.]+))?\]/i);
        if (positionMatch) {
            const x = parseFloat(positionMatch[1]);
            const y = parseFloat(positionMatch[2]);
            const p = positionMatch[3] ? parseInt(positionMatch[3], 10) : undefined;
            if (!isNaN(x) && !isNaN(y)) {
                aiPosition = { x, y, width: 10, height: 5, pageIndex: p };
            }
        }
    }

    // 3. DRAWING FALLBACK
    // If drawing detected but no position, use default
    const isDrawing = !anno.line_id && (anno.content_desc || (anno.reasoning || '').toLowerCase().includes('drawing'));

    if (!aiPosition && isDrawing) {
        // Filter out phantom drawings (cross/not required)
        if (anno.action === 'cross' || (anno.reasoning || '').toLowerCase().includes('not required')) {
            return undefined;
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

    // V27: Direct ground-truth extraction from block ID 
    let groundTruthPage: number | undefined = undefined;

    // 🛡️ [TRUTH-FIRST]: Check all possible ID fields for the physical page prefix p{N}_
    const idsToProbe = [
        aiAnnotation.line_id,
        aiAnnotation.linked_ocr_id,
        (aiAnnotation as any).id,
        (aiAnnotation as any).lineId
    ];

    for (const probeId of idsToProbe) {
        if (typeof probeId === 'string' && probeId.match(/^p(\d+)_/)) {
            const match = probeId.match(/^p(\d+)_/);
            if (match) {
                groundTruthPage = parseInt(match[1], 10);
                console.log(` 🛡️ [TRUTH-EXTRACT] Found ground truth P${groundTruthPage} from ID: "${probeId}"`);
                break; // Found physical ground truth!
            }
        }
    }

    // 2. Check for Classification Block format: "block_{N}_..."
    if (groundTruthPage === undefined && aiAnnotation.line_id?.startsWith('block_')) {
        const parts = aiAnnotation.line_id.split('_');
        const pageIdx = parseInt(parts[1], 10);
        if (!isNaN(pageIdx)) groundTruthPage = pageIdx;
    }

    const page: PageCoordinates = {
        // If we found a Global ID in the string, we set 'global' IMMEDIATELY.
        global: (groundTruthPage !== undefined)
            ? GlobalPageIndex.from(groundTruthPage)
            : GlobalPageIndex.from(0), // Temporary fallback

        // If we have ground truth, the relative index is irrelevant
        relative: undefined,
        source: (groundTruthPage !== undefined) ? 'global_id' : 'ai',
        isPhysicalPage: (groundTruthPage !== undefined)
    };

    return {
        id: generateAnnotationId(),
        text: aiAnnotation.text,
        subQuestion: aiAnnotation.subQuestion,
        page,
        aiPosition,
        lineId: aiAnnotation.line_id,
        ocrSource: undefined,
        hasLineData: undefined,
        action: aiAnnotation.action,
        reasoning: aiAnnotation.reasoning,
        aiMatchStatus: aiAnnotation.ocr_match_status,
        linkedOcrId: aiAnnotation.linked_ocr_id,
        contentDesc: aiAnnotation.content_desc,
        isPhysicalPage: (groundTruthPage !== undefined)
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
    // TRUTH-FIRST SHORTCIRCUIT:
    // If the annotation source is 'global_id', it implies the page.global is already correct.
    if (annotation.page.source === 'global_id') {
        return annotation;
    }

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

    // [TRUTH-SYNC]: If we matched an OCR block, its page index is the ultimate ground truth.
    if (matchingBlock.pageIndex !== undefined && annotation.page.global && (annotation.page.global as number) !== matchingBlock.pageIndex) {
        console.log(` 🔄 [TRUTH-SYNC] Syncing page for Q${annotation.subQuestion}: P${annotation.page.global} -> P${matchingBlock.pageIndex} (Matched Block: ${matchingBlock.id})`);
        (annotation.page as any).global = GlobalPageIndex.from(matchingBlock.pageIndex);
    }

    // [FAIL-FAST]: Ensure we have coordinates. Check both .bbox and .coordinates.
    let resolvedBbox: BoundingBox | undefined = matchingBlock.bbox as BoundingBox | undefined;
    if (!resolvedBbox && matchingBlock.coordinates) {
        resolvedBbox = [
            matchingBlock.coordinates.x,
            matchingBlock.coordinates.y,
            matchingBlock.coordinates.width,
            matchingBlock.coordinates.height
        ] as BoundingBox;
    }

    if (!resolvedBbox) {
        throw new Error(`[CoordinateFailure] OCR Block ${matchingBlock.id} matched but has no physical coordinates (bbox or coordinates are missing). This is a critical failure in the OCR ingestion pipeline.`);
    }

    // Return new annotation with OCR data
    return {
        ...annotation,
        bbox: resolvedBbox,
        ocrSource: 'mathpix'
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
        isPhysicalPage: annotation.isPhysicalPage || annotation.page.isPhysicalPage,
        // [PTR-V-VAL] These will be hydrated in the Enrichment Service
        student_text: annotation.contentDesc || '',
        studentText: annotation.contentDesc || '',
        contentDesc: annotation.contentDesc,
        // Preserve new fields for debugging
        _immutable: true,
        _page: annotation.page,
        _aiMatchStatus: annotation.aiMatchStatus
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
        source: legacyAnno.ocrSource ? 'ocr' : 'inferred',
        isPhysicalPage: legacyAnno.isPhysicalPage || false // Set isPhysicalPage from legacyAnno
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
    // 🔧 PIXEL-AWARE FIX: Since these are enriched annotations in pixels,
    // we need larger thresholds. 50px is about 2% of a standard page.
    const POSITION_THRESHOLD = 50;
    const STACK_OFFSET_Y = 60; // Shift down by ~60 pixels (roughly 2-3 lines)

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

            // Resolve current box
            const cBox = current.bbox || (current.visual_position ? [current.visual_position.x, current.visual_position.y] : null);
            if (!cBox) continue;

            let stackLevel = 0;

            // Check against all PREVIOUS processed annotations on this page
            for (let j = 0; j < i; j++) {
                const prev = pageAnns[j];
                const pBox = prev.bbox || (prev.visual_position ? [prev.visual_position.x, prev.visual_position.y] : null);
                if (!pBox) continue;

                // Check overlap
                const xDiff = Math.abs(cBox[0] - pBox[0]);
                const yDiff = Math.abs(cBox[1] - pBox[1]);

                if (xDiff < POSITION_THRESHOLD && yDiff < POSITION_THRESHOLD) {
                    stackLevel++;
                }
            }

            // Apply Offset
            if (stackLevel > 0) {
                // Shift Y down
                if (current.bbox) {
                    current.bbox[1] = (current.bbox[1] || 0) + (stackLevel * STACK_OFFSET_Y);
                } else if (current.visual_position) {
                    current.visual_position.y = (current.visual_position.y || 0) + (stackLevel * STACK_OFFSET_Y);
                }
            }
        }
        result.push(...pageAnns);
    });

    // Restore original order (if needed, but grouping by page might scramble. The result push order is page-grouped)
    // Actually, simple iteration inplace is better
    return result;
}
