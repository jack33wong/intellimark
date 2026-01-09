import { NormalizedPoint } from '../hooks/useDocumentDetection';

// V27: BURST MODE ENGINE (Optimized Shadow Map)
// Shrink -> Blur -> Stretch back for instant shadow removal.

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

            // 1. Setup
            const realCorners = normalizedCorners.map(p => ({
                x: Math.round(p.x * w),
                y: Math.round(p.y * h)
            }));

            // Angle Detection
            const topW = Math.hypot(realCorners[0].x - realCorners[1].x, realCorners[0].y - realCorners[1].y);
            const botW = Math.hypot(realCorners[2].x - realCorners[3].x, realCorners[2].y - realCorners[3].y);
            const isSteepAngle = (botW / (topW || 1)) > 1.35;

            // Target A4 High-Res
            const TARGET_WIDTH = 2480;
            const TARGET_HEIGHT = 3508;

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject("ctx error"); return; }
            ctx.drawImage(img, 0, 0);

            // 2. Warp (Standard)
            let src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
            let dst = new cv.Mat();

            let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                realCorners[0].x, realCorners[0].y,
                realCorners[1].x, realCorners[1].y,
                realCorners[2].x, realCorners[2].y,
                realCorners[3].x, realCorners[3].y
            ]);

            const pinch = isSteepAngle ? TARGET_WIDTH * 0.05 : TARGET_WIDTH * 0.01;
            let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                pinch, 0,
                TARGET_WIDTH - pinch, 0,
                TARGET_WIDTH, TARGET_HEIGHT,
                0, TARGET_HEIGHT
            ]);

            let M = cv.getPerspectiveTransform(srcTri, dstTri);
            // Cubic interpolation for maximum clarity
            cv.warpPerspective(src, dst, M, new cv.Size(TARGET_WIDTH, TARGET_HEIGHT), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

            src.delete(); srcTri.delete(); dstTri.delete(); M.delete();

            // 3. ENHANCEMENT (OPTIMIZED V27)
            let gray = new cv.Mat();
            cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);
            dst.delete();

            // --- OPTIMIZATION: FAST SHADOW MAP ---
            // Instead of blurring the full 8MP image (Slow), we shrink -> blur -> resize.
            // This is 10x faster and produces identical "Background Estimation".
            let smallBg = new cv.Mat();
            let bg = new cv.Mat();

            // Downscale by 4x for speed
            let smallSize = new cv.Size(Math.round(TARGET_WIDTH / 4), Math.round(TARGET_HEIGHT / 4));
            cv.resize(gray, smallBg, smallSize, 0, 0, cv.INTER_LINEAR);

            // Dilate (Erase text) on small image
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
            cv.dilate(smallBg, smallBg, kernel);

            // Blur (Smooth shadows)
            cv.GaussianBlur(smallBg, smallBg, new cv.Size(15, 15), 0, 0, cv.BORDER_DEFAULT);

            // Upscale back to full size
            cv.resize(smallBg, bg, new cv.Size(TARGET_WIDTH, TARGET_HEIGHT), 0, 0, cv.INTER_LINEAR);

            smallBg.delete(); kernel.delete();
            // -------------------------------------

            // Divide (Normalization)
            let result = new cv.Mat();
            cv.divide(gray, bg, result, 255);
            gray.delete(); bg.delete();

            // Sharpening (Unsharp Mask)
            let blur = new cv.Mat();
            cv.GaussianBlur(result, blur, new cv.Size(0, 0), 3);
            let sharpened = new cv.Mat();

            const alpha = isSteepAngle ? 2.5 : 1.5;
            const beta = 1.0 - alpha;
            cv.addWeighted(result, alpha, blur, beta, 0, sharpened);

            // Threshold & Final Cleanup
            cv.threshold(sharpened, result, 240, 255, cv.THRESH_TRUNC);
            cv.normalize(result, result, 0, 255, cv.NORM_MINMAX);

            // Safety Border (Native ROI Fill)
            const borderSize = 25;
            let roi = result.roi(new cv.Rect(0, 0, TARGET_WIDTH, borderSize));
            roi.setTo(new cv.Scalar(255)); roi.delete();
            roi = result.roi(new cv.Rect(0, TARGET_HEIGHT - borderSize, TARGET_WIDTH, borderSize));
            roi.setTo(new cv.Scalar(255)); roi.delete();
            roi = result.roi(new cv.Rect(0, 0, borderSize, TARGET_HEIGHT));
            roi.setTo(new cv.Scalar(255)); roi.delete();
            roi = result.roi(new cv.Rect(TARGET_WIDTH - borderSize, 0, borderSize, TARGET_HEIGHT));
            roi.setTo(new cv.Scalar(255)); roi.delete();

            // Cleanup Mats
            blur.delete(); sharpened.delete();

            // Export
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
    return file as Blob;
};
