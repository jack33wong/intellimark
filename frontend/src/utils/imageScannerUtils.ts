import { NormalizedPoint } from '../hooks/useDocumentDetection';

// V38: PURE NATIVE OPENCV PIPELINE (No JS Loops = No Glitches)

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

            // Detect Angle
            const topW = Math.hypot(realCorners[0].x - realCorners[1].x, realCorners[0].y - realCorners[1].y);
            const botW = Math.hypot(realCorners[2].x - realCorners[3].x, realCorners[2].y - realCorners[3].y);
            const isSteepAngle = (botW / (topW || 1)) > 1.35;

            const TARGET_WIDTH = 2480;
            const TARGET_HEIGHT = 3508;

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject("ctx error"); return; }
            ctx.drawImage(img, 0, 0);

            // 1. Warp
            let src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
            let dst = new cv.Mat();

            let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                realCorners[0].x, realCorners[0].y,
                realCorners[1].x, realCorners[1].y,
                realCorners[2].x, realCorners[2].y,
                realCorners[3].x, realCorners[3].y
            ]);

            // Pinch Correction
            const pinch = isSteepAngle ? TARGET_WIDTH * 0.05 : TARGET_WIDTH * 0.01;

            let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                pinch, 0,
                TARGET_WIDTH - pinch, 0,
                TARGET_WIDTH, TARGET_HEIGHT,
                0, TARGET_HEIGHT
            ]);

            let M = cv.getPerspectiveTransform(srcTri, dstTri);
            cv.warpPerspective(src, dst, M, new cv.Size(TARGET_WIDTH, TARGET_HEIGHT), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

            src.delete(); srcTri.delete(); dstTri.delete(); M.delete();

            // 2. Native Enhancement (No JS Loops)
            let gray = new cv.Mat();
            cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);
            dst.delete();

            // Estimate Background (Shadows)
            let bg = new cv.Mat();
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(20, 20));
            cv.dilate(gray, bg, kernel); // Remove text
            cv.GaussianBlur(bg, bg, new cv.Size(45, 45), 0, 0, cv.BORDER_DEFAULT); // Blur shadows
            kernel.delete();

            // Remove Shadows (Division)
            let result = new cv.Mat();
            cv.divide(gray, bg, result, 255);
            gray.delete(); bg.delete();

            // Sharpen
            let blur = new cv.Mat();
            cv.GaussianBlur(result, blur, new cv.Size(0, 0), 3);
            let sharpened = new cv.Mat();
            const alpha = isSteepAngle ? 2.5 : 1.5;
            const beta = 1.0 - alpha;
            cv.addWeighted(result, alpha, blur, beta, 0, sharpened);

            // Threshold Clean
            cv.threshold(sharpened, result, 240, 255, cv.THRESH_TRUNC);
            cv.normalize(result, result, 0, 255, cv.NORM_MINMAX);

            // Cleanup
            blur.delete(); sharpened.delete();

            // 3. Export
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
