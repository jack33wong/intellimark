import { NormalizedPoint } from '../hooks/useDocumentDetection';

// V26: PURE NATIVE OPENCV PIPELINE
// Zero manual JS loops = Zero artifacts.

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
            const w = img.width;
            const h = img.height;

            const realCorners = normalizedCorners.map(p => ({
                x: Math.round(p.x * w),
                y: Math.round(p.y * h)
            }));

            // 1. Detect Angle Severity
            const topW = Math.hypot(realCorners[0].x - realCorners[1].x, realCorners[0].y - realCorners[1].y);
            const botW = Math.hypot(realCorners[2].x - realCorners[3].x, realCorners[2].y - realCorners[3].y);
            const stretchRatio = botW / (topW || 1);
            const isSteepAngle = stretchRatio > 1.35;

            // Target A4 High-Res
            const TARGET_WIDTH = 2480;
            const TARGET_HEIGHT = 3508;

            // Draw Initial Image
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject("ctx error"); return; }
            ctx.drawImage(img, 0, 0);

            // --- 2. NATIVE OPENCV WARP ---
            let src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
            let dst = new cv.Mat();

            // Source Tri
            let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                realCorners[0].x, realCorners[0].y,
                realCorners[1].x, realCorners[1].y,
                realCorners[2].x, realCorners[2].y,
                realCorners[3].x, realCorners[3].y
            ]);

            // Pinch Correction (Stronger for steep angles)
            const pinch = isSteepAngle ? TARGET_WIDTH * 0.05 : TARGET_WIDTH * 0.01;

            let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                pinch, 0,
                TARGET_WIDTH - pinch, 0,
                TARGET_WIDTH, TARGET_HEIGHT,
                0, TARGET_HEIGHT
            ]);

            let M = cv.getPerspectiveTransform(srcTri, dstTri);
            // Cubic interpolation is critical for text sharpness on angled scans
            cv.warpPerspective(src, dst, M, new cv.Size(TARGET_WIDTH, TARGET_HEIGHT), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

            // Clean up Warp Vars
            src.delete(); srcTri.delete(); dstTri.delete(); M.delete();

            // --- 3. ILLUMINATION NORMALIZATION (Shadow Removal) ---
            // A. Convert to Gray
            let gray = new cv.Mat();
            cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);
            dst.delete();

            // B. Estimate Background
            // We use a morphological 'dilate' to erase the thin text lines, leaving only the paper background.
            // Then we blur it to make a smooth shadow map.
            let bg = new cv.Mat();
            let kernelSize = isSteepAngle ? 15 : 25; // Smaller kernel for steep angles to preserve local contrast
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
            cv.dilate(gray, bg, kernel);
            cv.GaussianBlur(bg, bg, new cv.Size(45, 45), 0, 0, cv.BORDER_DEFAULT);
            kernel.delete();

            // C. Divide (The Magic Step)
            // Text = (Original / Background) * 255. This makes the background pure white (255) and keeps text dark.
            let result = new cv.Mat();
            cv.divide(gray, bg, result, 255);
            gray.delete(); bg.delete();

            // --- 4. UNSHARP MASK (Clarity Boost) ---
            // Sharpened = Original + (Original - Blurred) * Strength
            let blur = new cv.Mat();
            cv.GaussianBlur(result, blur, new cv.Size(0, 0), 3);
            let sharpened = new cv.Mat();

            // Stronger sharpening for angled shots to recover lost resolution
            const alpha = isSteepAngle ? 2.5 : 1.5;
            const beta = 1.0 - alpha;

            cv.addWeighted(result, alpha, blur, beta, 0, sharpened);

            // --- 5. CLEANUP & THRESHOLD ---
            // Use THRESH_TRUNC to keep gray details (don't make it 1-bit black/white)
            // But force light grays to white.
            cv.threshold(sharpened, result, 240, 255, cv.THRESH_TRUNC);

            // Normalize to ensure text is dark enough
            cv.normalize(result, result, 0, 255, cv.NORM_MINMAX);

            // Safety Border (Native ROI Fill)
            // Paint 25px border white to hide crop artifacts
            const borderSize = 25;
            // Top
            let roi = result.roi(new cv.Rect(0, 0, TARGET_WIDTH, borderSize));
            roi.setTo(new cv.Scalar(255)); roi.delete();
            // Bottom
            roi = result.roi(new cv.Rect(0, TARGET_HEIGHT - borderSize, TARGET_WIDTH, borderSize));
            roi.setTo(new cv.Scalar(255)); roi.delete();
            // Left
            roi = result.roi(new cv.Rect(0, 0, borderSize, TARGET_HEIGHT));
            roi.setTo(new cv.Scalar(255)); roi.delete();
            // Right
            roi = result.roi(new cv.Rect(TARGET_WIDTH - borderSize, 0, borderSize, TARGET_HEIGHT));
            roi.setTo(new cv.Scalar(255)); roi.delete();

            // Cleanup Mats
            blur.delete(); sharpened.delete();

            // --- 6. EXPORT ---
            let finalRGBA = new cv.Mat();
            cv.cvtColor(result, finalRGBA, cv.COLOR_GRAY2RGBA);

            const imgData = new ImageData(
                new Uint8ClampedArray(finalRGBA.data),
                TARGET_WIDTH,
                TARGET_HEIGHT
            );

            result.delete(); finalRGBA.delete();

            const fCanvas = document.createElement('canvas');
            fCanvas.width = TARGET_WIDTH; fCanvas.height = TARGET_HEIGHT;
            fCanvas.getContext('2d')?.putImageData(imgData, 0, 0);

            fCanvas.toBlob(b => resolve(b!), 'image/jpeg', 0.95);
        };
        img.onerror = reject;
        img.src = url;
    });
};

export function sortCorners(pts: { x: number, y: number }[]) {
    pts.sort((a, b) => a.y - b.y);
    const top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = pts.slice(2, 4).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]];
}

export interface ScanOptions {
    contrast?: number;
    brightness?: number;
    blackPoint?: number;
    padding?: number;
    quality?: number;
    onStatusUpdate?: (status: string) => void;
}

export const processScannerImage = async (
    file: File | Blob,
    options: ScanOptions = {}
): Promise<Blob> => {
    // Keep a simplified version of this for desktop if needed, 
    // but for now we focus on the mobile instant crop.
    return file as Blob;
};
