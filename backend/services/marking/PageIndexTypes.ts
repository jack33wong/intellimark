/**
 * Page Index Type System
 * 
 * Provides branded types to distinguish between different page coordinate systems,
 * preventing bugs where relative indices are treated as global or vice versa.
 * 
 * @module PageIndexTypes
 */

// ============================================================================
// BRANDED TYPES - Compile-time safety for page indices
// ============================================================================

/**
 * Page index relative to the images array sent to AI (0-based)
 * 
 * Example: For Q3 with sourcePages=[3,4]:
 * - RelativePageIndex 0 → Global page 3 (Page 4 in document)
 * - RelativePageIndex 1 → Global page 4 (Page 5 in document)
 */
export type RelativePageIndex = number & { readonly __brand: 'RelativePageIndex' };

/**
 * Page index in the original document (0-based)
 * 
 * Example: Page 5 of the exam = GlobalPageIndex 4
 */
export type GlobalPageIndex = number & { readonly __brand: 'GlobalPageIndex' };

/**
 * 1-based page number for display purposes
 * 
 * Example: "Page 5" = DisplayPageNumber 5
 */
export type DisplayPageNumber = number & { readonly __brand: 'DisplayPageNumber' };

// ============================================================================
// TYPE CONSTRUCTORS - Create branded types safely
// ============================================================================

export const RelativePageIndex = {
    from: (value: number): RelativePageIndex => {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`Invalid RelativePageIndex: ${value} (must be non-negative integer)`);
        }
        return value as RelativePageIndex;
    }
};

export const GlobalPageIndex = {
    from: (value: number): GlobalPageIndex => {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`Invalid GlobalPageIndex: ${value} (must be non-negative integer)`);
        }
        return value as GlobalPageIndex;
    }
};

export const DisplayPageNumber = {
    from: (value: number): DisplayPageNumber => {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error(`Invalid DisplayPageNumber: ${value} (must be positive integer)`);
        }
        return value as DisplayPageNumber;
    },

    fromGlobal: (globalIndex: GlobalPageIndex): DisplayPageNumber => {
        return DisplayPageNumber.from((globalIndex as number) + 1);
    }
};

// ============================================================================
// CORE INTERFACES
// ============================================================================

/**
 * Explicit page coordinate information
 * Tracks both relative and global indices with data provenance
 */
export interface PageCoordinates {
    /**
     * Page index relative to the images array (0-based)
     * Set when AI provides pageIndex in its response
     */
    readonly relative?: RelativePageIndex;

    /**
     * Global page index in the document (0-based)
     * Always set after mapping or from OCR
     */
    readonly global: GlobalPageIndex;

    /**
     * Source of the page index information
     * - 'ai': From AI's visual analysis
     * - 'ocr': From OCR block data (ground truth)
     * - 'inferred': Calculated from context
     */
    readonly source: 'ai' | 'ocr' | 'inferred';
}

/**
 * Immutable bounding box coordinates
 */
export type BoundingBox = readonly [number, number, number, number];

/**
 * Immutable AI position (percentage-based)
 */
export interface AIPosition {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly pageIndex?: number;
}

/**
 * Immutable annotation structure
 * Never mutated after creation - transformations return new objects
 */
export interface ImmutableAnnotation {
    /**
     * Unique identifier for this annotation
     */
    readonly id: string;

    /**
     * Annotation text (e.g., "M1 A1", "B1")
     */
    readonly text: string;

    /**
     * Sub-question identifier (e.g., "a", "b", "i", "ii")
     */
    readonly subQuestion?: string;

    /**
     * Page coordinates - explicit and immutable
     */
    readonly page: PageCoordinates;

    /**
     * Bounding box in pixel coordinates [x, y, width, height]
     * Undefined until enriched with OCR data
     */
    readonly bbox?: BoundingBox;

    /**
     * AI-provided position (percentage-based)
     * Used for drawings or when OCR bbox not available
     */
    readonly aiPosition?: Readonly<AIPosition>;

    /**
     * Reference to OCR block or step ID
     */
    readonly lineId?: string;

    /**
     * OCR source metadata
     */
    readonly ocrSource?: string;

    /**
   * Whether this annotation has line data
   */
    readonly hasLineData?: boolean;

    /**
     * Action type (e.g., 'tick', 'cross', 'text')
     * Required for SVG overlay generation
     */
    readonly action?: string;

    /**
     * Reasoning provided by AI for the mark
     */
    readonly reasoning?: string;

    /**
     * AI's original match status (MATCHED, VISUAL, UNMATCHED)
     * Preserved from AI response to guide rendering decisions
     */
    readonly aiMatchStatus?: string;

    /**
     * ID of the OCR block this annotation is linked to.
     * This is used when an annotation is derived from an OCR block,
     * but its primary `lineId` might refer to a specific line within that block.
     */
    readonly linkedOcrId?: string;

    /**
     * Student text from AI response (for UNMATCHED classification matching)
     * Used to find the corresponding line in classificationBlocks.studentWorkLines
     */
    readonly studentText?: string;

    /**
     * Classification text from AI response
     * Alternative text source when studentText not available
     */
    readonly classificationText?: string;

    /**
     * Line index from AI response (1-based)
     * Used to map to classificationBlocks.studentWorkLines array
     */
    readonly lineIndex?: number;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isRelativePageIndex(value: unknown): value is RelativePageIndex {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isGlobalPageIndex(value: unknown): value is GlobalPageIndex {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function hasRelativePage(annotation: ImmutableAnnotation): boolean {
    return annotation.page.relative !== undefined;
}

export function isFromAI(annotation: ImmutableAnnotation): boolean {
    return annotation.page.source === 'ai';
}

export function isFromOCR(annotation: ImmutableAnnotation): boolean {
    return annotation.page.source === 'ocr';
}

export function hasBoundingBox(annotation: ImmutableAnnotation): annotation is ImmutableAnnotation & { bbox: BoundingBox } {
    return annotation.bbox !== undefined;
}

export function hasAIPosition(annotation: ImmutableAnnotation): annotation is ImmutableAnnotation & { aiPosition: Readonly<AIPosition> } {
    return annotation.aiPosition !== undefined;
}
