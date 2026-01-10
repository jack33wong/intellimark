import { NormalizedPoint } from '../hooks/useDocumentDetection';

// V61: ADAPTIVE SHADOW REMOVAL (Shadow-Bane Engine)

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

            // 1. MAX RESOLUTION (3800px)
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

            // 3. Dimensions
            const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const maxWidth = Math.max(
                dist(realCorners[0], realCorners[1]),
                dist(realCorners[2], realCorners[3])
            );

            const finalWidth = maxWidth;
            const finalHeight = maxWidth * 1.414; // A4

            // 4. WARP
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
            // High Quality Warp
            cv.warpPerspective(src, dst, M, new cv.Size(finalWidth, finalHeight), cv.INTER_LANCZOS4, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

            // 5. ENHANCEMENT PIPELINE
            let gray = new cv.Mat();
            cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);
            dst.delete();

            // A. AGGRESSIVE BACKGROUND ESTIMATION
            let bg = new cv.Mat();
            // Dynamic kernel size relative to image width ensures consistency across resolutions
            let kernelSize = Math.floor(finalWidth * 0.02); // approx 60-80px
            if (kernelSize % 2 === 0) kernelSize++; // Must be odd

            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));

            // Dilate -> Blur = Robust Background map
            cv.dilate(gray, bg, kernel);
            cv.GaussianBlur(bg, bg, new cv.Size(kernelSize * 2 + 1, kernelSize * 2 + 1), 0, 0);

            let clean = new cv.Mat();
            // Divide original by background -> Normalizes lighting to flat gray
            cv.divide(gray, bg, clean, 255);

            // B. UNSHARP MASK (Structure Sharpening)
            let blurred = new cv.Mat();
            cv.GaussianBlur(clean, blurred, new cv.Size(0, 0), 1.5);
            let sharp = new cv.Mat();
            cv.addWeighted(clean, 2.5, blurred, -1.5, 0, sharp);

            // C. CLAHE (Local Contrast)
            let clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
            clahe.apply(sharp, sharp);

            // D. SMART THRESHOLD GAMMA
            let lut = new cv.Mat(1, 256, cv.CV_8U);
            for (let i = 0; i < 256; i++) {
                if (i > 180) {
                    // Bright pixels -> Pure White (Kills Shadows)
                    lut.data[i] = 255;
                } else {
                    // Dark/Mid pixels -> Darker (Enhances Text)
                    lut.data[i] = Math.pow(i / 180, 0.9) * 160;
                }
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

            src.delete(); srcTri.delete(); dstTri.delete(); M.delete();
            gray.delete(); bg.delete(); clean.delete(); blurred.delete();
            sharp.delete(); lut.delete(); final.delete(); finalRGBA.delete();
            kernel.delete(); clahe.delete();

            const fCanvas = document.createElement('canvas');
            fCanvas.width = finalWidth; fCanvas.height = finalHeight;
            fCanvas.getContext('2d')?.putImageData(imgData, 0, 0);

            fCanvas.toBlob(b => resolve(b!), 'image/jpeg', 0.95);
        };
        img.onerror = reject;
        img.src = url;
    });
};

/**
 * Fallback processor for images without detected corners.
 * V61 Upgrade: Applies Adaptive Shadow Removal and Smart Thresholding.
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

            const MAX_DIM = 2400;
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

            // A. AGGRESSIVE BACKGROUND ESTIMATION
            let bg = new cv.Mat();
            let kernelSize = Math.floor(w * 0.02);
            if (kernelSize % 2 === 0) kernelSize++;
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
            cv.dilate(gray, bg, kernel);
            cv.GaussianBlur(bg, bg, new cv.Size(kernelSize * 2 + 1, kernelSize * 2 + 1), 0, 0);
            let clean = new cv.Mat();
            cv.divide(gray, bg, clean, 255);

            // B. UNSHARP MASK
            let blurred = new cv.Mat();
            cv.GaussianBlur(clean, blurred, new cv.Size(0, 0), 1.5);
            let sharp = new cv.Mat();
            cv.addWeighted(clean, 2.5, blurred, -1.5, 0, sharp);

            // C. CLAHE
            let clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
            clahe.apply(sharp, sharp);

            // D. SMART THRESHOLD GAMMA
            let lut = new cv.Mat(1, 256, cv.CV_8U);
            for (let i = 0; i < 256; i++) {
                if (i > 180) {
                    lut.data[i] = 255;
                } else {
                    lut.data[i] = Math.pow(i / 180, 0.9) * 160;
                }
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
