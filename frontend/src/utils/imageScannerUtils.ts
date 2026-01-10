import { NormalizedPoint } from '../hooks/useDocumentDetection';

// V60: LANCZOS4 + UNSHARP MASK + GAMMA (Focus on Top-Clarity)

export const performInstantCrop = async (
    imageBlob: Blob,
    normalizedCorners: NormalizedPoint[]
): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (!window.cv || !window.cv.Mat) { reject("OpenCV missing"); return; }
        const cv = window.cv;
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // 1. NATIVE RESOLUTION (3800px)
            // We need every single pixel for the top part of the angled document.
            const MAX_DIM = 3800;
            let w = img.width;
            let h = img.height;
            let scale = 1;

            if (w > MAX_DIM || h > MAX_DIM) {
                scale = Math.min(MAX_DIM / w, MAX_DIM / h);
                w = Math.floor(w * scale);
                h = Math.floor(h * scale);
            }

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject("ctx error"); return; }
            ctx.drawImage(img, 0, 0, w, h);

            // 2. Map Corners
            const realCorners = normalizedCorners.map(p => ({
                x: p.x * w,
                y: p.y * h
            }));

            // 3. Dimensions (Max-Logic)
            const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const maxWidth = Math.max(
                dist(realCorners[0], realCorners[1]),
                dist(realCorners[2], realCorners[3])
            );

            // Force A4 Ratio
            const finalWidth = maxWidth;
            const finalHeight = maxWidth * 1.414;

            // 4. WARP with LANCZOS4 (The "Anti-Blur" Resampler)
            // Lanczos is slower but MUCH better at reconstructing details 
            // from the "far away" (top) part of the image.
            let src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
            let dst = new cv.Mat();

            let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                realCorners[0].x, realCorners[0].y,
                realCorners[1].x, realCorners[1].y,
                realCorners[2].x, realCorners[2].y,
                realCorners[3].x, realCorners[3].y
            ]);

            let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0, finalWidth, 0, finalWidth, finalHeight, 0, finalHeight
            ]);

            let M = cv.getPerspectiveTransform(srcTri, dstTri);

            // V60 CHANGE: INTER_LANCZOS4
            cv.warpPerspective(src, dst, M, new cv.Size(finalWidth, finalHeight), cv.INTER_LANCZOS4, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

            // 5. ENHANCEMENT PIPELINE
            let gray = new cv.Mat();
            cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);
            dst.delete();

            // A. Shadow Removal (Background Division)
            // Use a large kernel to avoid treating text as shadow
            let bg = new cv.Mat();
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(50, 50));
            cv.dilate(gray, bg, kernel);
            cv.GaussianBlur(bg, bg, new cv.Size(91, 91), 0, 0);
            let clean = new cv.Mat();
            cv.divide(gray, bg, clean, 255);

            // B. UNSHARP MASK (Professional Sharpening)
            // Formula: Sharp = Original + Amount * (Original - Blurred)
            // This pops edges without the "static noise" of simple filters.
            // Sigma 1.5 targets the structure of letters.
            let blurred = new cv.Mat();
            cv.GaussianBlur(clean, blurred, new cv.Size(0, 0), 1.5);
            let sharp = new cv.Mat();
            cv.addWeighted(clean, 2.5, blurred, -1.5, 0, sharp); // 2.5 weight = Strong pop

            // C. CLAHE (Local Contrast)
            let clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
            clahe.apply(sharp, sharp);

            // D. GAMMA CORRECTION (Darken Faint Text)
            // The top of the page is often washed out. Gamma < 1.0 forces grays to black.
            // Look Up Table (LUT) method for speed.
            let lut = new cv.Mat(1, 256, cv.CV_8U);
            const gamma = 0.7; // Strong darkening
            for (let i = 0; i < 256; i++) {
                lut.data[i] = Math.pow(i / 255, gamma) * 255;
            }
            let final = new cv.Mat();
            cv.LUT(sharp, lut, final);

            // 6. Export
            let finalRGBA = new cv.Mat();
            cv.cvtColor(final, finalRGBA, cv.COLOR_GRAY2RGBA);

            const imgData = new ImageData(
                new Uint8ClampedArray(finalRGBA.data),
                finalWidth,
                finalHeight
            );

            // Cleanup (Critical for large images)
            src.delete(); srcTri.delete(); dstTri.delete(); M.delete();
            gray.delete(); bg.delete(); clean.delete(); blurred.delete();
            sharp.delete(); lut.delete(); final.delete(); finalRGBA.delete();
            kernel.delete(); clahe.delete();

            const fCanvas = document.createElement('canvas');
            fCanvas.width = finalWidth; fCanvas.height = finalHeight;
            fCanvas.getContext('2d')?.putImageData(imgData, 0, 0);

            // High Quality JPEG
            fCanvas.toBlob(b => resolve(b!), 'image/jpeg', 0.95);
        };
        img.onerror = reject;
        img.src = url;
    });
};

/**
 * Fallback processor for images without detected corners.
 * Applies the V60 enhancement pipeline (Shadow Removal, Unsharp Mask, CLAHE, Gamma)
 * to the entire image while maintaining quality.
 */
export const processScannerImage = async (
    imageBlob: Blob,
    options: { quality?: number } = {}
): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (!window.cv || !window.cv.Mat) { reject("OpenCV missing"); return; }
        const cv = window.cv;
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            const MAX_DIM = 2400; // Slightly lower for full-page fallback to save memory
            let w = img.width;
            let h = img.height;
            let scale = 1;

            if (w > MAX_DIM || h > MAX_DIM) {
                scale = Math.min(MAX_DIM / w, MAX_DIM / h);
                w = Math.floor(w * scale);
                h = Math.floor(h * scale);
            }

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject("ctx error"); return; }
            ctx.drawImage(img, 0, 0, w, h);

            let src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
            let gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // A. Shadow Removal (Background Division)
            let bg = new cv.Mat();
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(50, 50));
            cv.dilate(gray, bg, kernel);
            cv.GaussianBlur(bg, bg, new cv.Size(91, 91), 0, 0);
            let clean = new cv.Mat();
            cv.divide(gray, bg, clean, 255);

            // B. UNSHARP MASK (Professional Sharpening)
            let blurred = new cv.Mat();
            cv.GaussianBlur(clean, blurred, new cv.Size(0, 0), 1.5);
            let sharp = new cv.Mat();
            cv.addWeighted(clean, 2.5, blurred, -1.5, 0, sharp);

            // C. CLAHE (Local Contrast)
            let clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
            clahe.apply(sharp, sharp);

            // D. GAMMA CORRECTION (0.7)
            let lut = new cv.Mat(1, 256, cv.CV_8U);
            const gamma = 0.7;
            for (let i = 0; i < 256; i++) {
                lut.data[i] = Math.pow(i / 255, gamma) * 255;
            }
            let final = new cv.Mat();
            cv.LUT(sharp, lut, final);

            // Export
            let finalRGBA = new cv.Mat();
            cv.cvtColor(final, finalRGBA, cv.COLOR_GRAY2RGBA);

            const imgData = new ImageData(
                new Uint8ClampedArray(finalRGBA.data),
                w,
                h
            );

            // Cleanup
            src.delete(); gray.delete(); bg.delete(); clean.delete();
            blurred.delete(); sharp.delete(); lut.delete(); final.delete();
            finalRGBA.delete(); kernel.delete(); clahe.delete();

            const fCanvas = document.createElement('canvas');
            fCanvas.width = w; fCanvas.height = h;
            fCanvas.getContext('2d')?.putImageData(imgData, 0, 0);

            fCanvas.toBlob(b => resolve(b!), 'image/jpeg', options.quality || 0.90);
        };
        img.onerror = reject;
        img.src = url;
    });
};
