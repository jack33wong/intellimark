/**
 * Coordinate Transformation Service
 * Centralizes all logic for converting between relative units (%, PPT) and absolute Pixels.
 */

export interface RelativeBox {
    x: number;
    y: number;
    width: number;
    height: number;
    unit?: 'percentage' | 'ppt' | 'pixels';
}

export interface PixelBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class CoordinateTransformationService {
    /**
     * Detects the coordinate unit based on numerical values.
     * @param coords Array of coordinate values
     * @returns The detected unit
     */
    static detectUnit(coords: number[]): 'percentage' | 'ppt' | 'pixels' {
        const maxVal = Math.max(...coords);

        // Logic: 
        // < 101 -> Likely Percentages (0-100)
        // < 1001 -> Likely Parts Per Thousand (0-1000)
        // > 1000 -> Likely Raw Pixels

        if (maxVal <= 101) return 'percentage';
        if (maxVal > 1001) return 'pixels';

        // AMBIGUITY ZONE (101-1001): 
        // This is where many images (720p, 764px wide etc) collide with PPT.
        // Default to PPT for now, but we encourage passing explicit 'unit'.
        return 'ppt';
    }

    /**
     * Transforms a RelativeBox to absolute Pixels.
     */
    static transformToPixels(
        box: RelativeBox,
        pageWidth: number,
        pageHeight: number,
        context: string = 'GENERIC'
    ): PixelBox {
        const coords = [box.x, box.y, box.width, box.height];
        const unit = box.unit || this.detectUnit(coords);

        if (unit === 'pixels') {
            return { x: box.x, y: box.y, width: box.width, height: box.height };
        }

        let den = 1;
        if (unit === 'percentage') den = 100;
        else if (unit === 'ppt') den = 1000;

        const result: PixelBox = {
            x: (box.x / den) * pageWidth,
            y: (box.y / den) * pageHeight,
            width: (box.width / den) * pageWidth,
            height: (box.height / den) * pageHeight
        };

        /*
        console.log(`📐 [COORD-TRANSFORM][${context}]`);
        console.log(`   👉 Input:  [${coords.map(c => Math.round(c * 10) / 10).join(', ')}] units: ${unit}`);
        console.log(`   👉 Page:   ${pageWidth}x${pageHeight} | Denominator: ${den}`);
        console.log(`   🏁 Output: [${Math.round(result.x)}, ${Math.round(result.y)}] pixels`);
        */

        return result;
    }

    /**
     * Standardizes a box to "Parts Per Thousand" (0-1000) scale for AI Prompts.
     */
    static toPPT(box: any, pageWidth: number = 1000, pageHeight: number = 1000): PixelBox {
        const rawCoords = Array.isArray(box) ? box : [box.x, box.y, box.width, box.height];
        const unit = (box as any).unit || this.detectUnit(rawCoords);

        if (unit === 'pixels') {
            return {
                x: (rawCoords[0] / pageWidth) * 1000,
                y: (rawCoords[1] / pageHeight) * 1000,
                width: (rawCoords[2] / pageWidth) * 1000,
                height: (rawCoords[3] / pageHeight) * 1000
            };
        }

        let den = 1;
        if (unit === 'percentage') den = 100;
        else if (unit === 'ppt') den = 1000;

        return {
            x: (rawCoords[0] / den) * 1000,
            y: (rawCoords[1] / den) * 1000,
            width: (rawCoords[2] / den) * 1000,
            height: (rawCoords[3] / den) * 1000
        };
    }

    /**
     * Ensures a box is in pixel format, transforming if necessary.
     */
    static ensurePixels(
        box: any,
        pageWidth: number,
        pageHeight: number,
        context: string = 'ENSURE'
    ): PixelBox {
        const rawCoords = Array.isArray(box) ? box : [box.x, box.y, box.width, box.height];
        const unit = (box as any).unit || this.detectUnit(rawCoords);

        if (unit === 'pixels') {
            return Array.isArray(box)
                ? { x: box[0], y: box[1], width: box[2], height: box[3] }
                : { x: box.x, y: box.y, width: box.width, height: box.height };
        }

        return this.transformToPixels(
            Array.isArray(box) ? { x: box[0], y: box[1], width: box[2], height: box[3], unit } : { ...box, unit },
            pageWidth,
            pageHeight,
            context
        );
    }

    /**
     * MASTER RESOLVER: One function to rule them all.
     * Handles unit detection, scaling, and offset application as an atomic unit.
     */
    static resolvePixels(
        box: any,
        pageWidth: number,
        pageHeight: number,
        options: {
            offsetX?: number;
            offsetY?: number;
            context?: string;
            clamping?: { startY: number; endY: number; pad?: number }
        } = {}
    ): PixelBox {
        // console.log(`\n🌀 [RESOLVE-DEBUG][${options.context || 'UNSET'}] START`);

        const rawCoords = Array.isArray(box) ? box : [box.x, box.y, box.width, box.height];
        const explicitUnit = (box as any).unit || (box as any)._unit;
        const detectedUnit = this.detectUnit(rawCoords);
        const finalUnit = explicitUnit || detectedUnit;

        // console.log(`   📦 Input: [${rawCoords.join(', ')}] | ExplicitUnit: ${explicitUnit || 'NONE'} | DetectedUnit: ${detectedUnit} -> Final: ${finalUnit}`);

        const pixelBox = this.ensurePixels(box, pageWidth, pageHeight, options.context);

        // console.log(`   📏 Pre-Offset Pixels: (${Math.round(pixelBox.x)}, ${Math.round(pixelBox.y)}) [${pixelBox.width}x${pixelBox.height}]`);

        // Apply Offsets
        let x = pixelBox.x + (options.offsetX || 0);
        let y = pixelBox.y + (options.offsetY || 0);

        /*
        if (options.offsetX || options.offsetY) {
            console.log(`   ⚓ Applying Offsets: (+${options.offsetX || 0}, +${options.offsetY || 0}) -> New: (${Math.round(x)}, ${Math.round(y)})`);
        }
        */

        // Optional Clamping
        if (options.clamping) {
            const { startY, endY, pad = 5 } = options.clamping;
            const originalY = y;
            y = Math.max(startY + pad, Math.min(y, endY - pad));
            /*
            if (y !== originalY) {
                console.log(`   🛡️ Clamped Y: ${Math.round(originalY)} -> ${Math.round(y)} (Range: ${startY}-${endY})`);
            }
            */
        }

        // console.log(`   🏁 [RESOLVE-DEBUG][${options.context || 'UNSET'}] FINAL: (${Math.round(x)}, ${Math.round(y)})\n`);

        return {
            x,
            y,
            width: pixelBox.width,
            height: pixelBox.height
        };
    }
}
