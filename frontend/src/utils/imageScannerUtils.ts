import { NormalizedPoint } from '../hooks/useDocumentDetection';

export interface ScanOptions {
    contrast?: number;      // 0.0 to 2.0 (Default: 1.1)
    brightness?: number;    // -50 to 50 (Default: 0)
    blackPoint?: number;    // 0 to 255 (Default: 50)
    padding?: number;       // 0.0 to 0.1 (Default: 0.0)
    quality?: number;       // 0 to 1
    onStatusUpdate?: (status: string) => void;
}

export const processScannerImage = async (
    file: File | Blob,
    options: ScanOptions = {}
): Promise<Blob> => {
    const {
        contrast = 1.1,
        blackPoint = 50,
        onStatusUpdate
    } = options;

    const MAX_DIMENSION = 2500;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);
            onStatusUpdate?.('Loading image...');

            // 1. Resize
            let width = img.width;
            let height = img.height;
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject(new Error('Context failed')); return; }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // --- PHASE 1: DETECTION (LUMINANCE) ---
            onStatusUpdate?.('Detecting paper...');

            const dScale = 600 / width;
            const dw = 600;
            const dh = Math.floor(height * dScale);

            const gray = new Uint8Array(dw * dh);
            for (let y = 0; y < dh; y++) {
                for (let x = 0; x < dw; x++) {
                    const sx = Math.floor(x / dScale);
                    const sy = Math.floor(y / dScale);
                    const idx = (sy * width + sx) * 4;
                    gray[y * dw + x] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                }
            }

            const blurred = boxBlur(gray, dw, dh, 2);
            const threshold = getOtsuThreshold(blurred);
            const mask = new Uint8Array(dw * dh);
            for (let i = 0; i < dw * dh; i++) mask[i] = blurred[i] >= threshold ? 255 : 0;

            const paperMask = isolateLargestBlob(mask, dw, dh);
            let corners = findCornersFromMask(paperMask, dw, dh);

            corners = corners.map(p => ({ x: p.x / dScale, y: p.y / dScale }));
            corners = sortCorners(corners);

            // --- PHASE 2: WARP ---
            onStatusUpdate?.('Straightening...');

            const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
            let finalW = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2]));
            let finalH = Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));

            const ratio = finalW / finalH;
            if (ratio > 0.6 && ratio < 0.85) finalW = finalH * 0.707;
            else if (ratio > 1.2 && ratio < 1.6) finalW = finalH * 1.414;

            finalW = Math.round(finalW);
            finalH = Math.round(finalH);

            const warped = warpPerspective(data, width, height, corners, finalW, finalH);

            // --- PHASE 3: SHADOW KILLING ENHANCEMENT ---
            onStatusUpdate?.('Removing shadows...');

            const warpedGreen = new Uint8Array(finalW * finalH);
            for (let i = 0; i < finalW * finalH; i++) warpedGreen[i] = warped[i * 4 + 1];

            // 3.1 MORPHOLOGICAL CLOSING
            const textRemoved = maxFilter(warpedGreen, finalW, finalH, Math.ceil(finalW * 0.015));

            // Create Shadow Map with Heavy Blur
            const shadowMap = boxBlur(textRemoved, finalW, finalH, Math.ceil(finalW * 0.05));

            const enhanced = new Uint8ClampedArray(finalW * finalH * 4);

            for (let i = 0; i < finalW * finalH; i++) {
                const pixel = warped[i * 4 + 1]; // Green channel
                const bg = shadowMap[i] || 1;

                // 3.2 Division Normalization
                let val = (pixel / bg) * 255;

                // 3.3 Gamma Correction & Enhancement
                val = 255 * Math.pow(val / 255, 2.0); // Gamma
                if (val < blackPoint) val = 0; // Black point clamp
                val = ((val - 128) * contrast) + 128; // Contrast
                val = Math.max(0, Math.min(255, val));

                enhanced[i * 4] = val;
                enhanced[i * 4 + 1] = val;
                enhanced[i * 4 + 2] = val;
                enhanced[i * 4 + 3] = 255;
            }

            const fCanvas = document.createElement('canvas');
            fCanvas.width = finalW;
            fCanvas.height = finalH;
            const fCtx = fCanvas.getContext('2d');
            fCtx?.putImageData(new ImageData(enhanced, finalW, finalH), 0, 0);

            fCanvas.toBlob(blob => resolve(blob!), 'image/jpeg', 0.9);
        };
        img.onerror = reject;
        img.src = url;
    });
};

// --- CORE UTILS ---

/**
 * Max Filter (Dilation)
 * Erases dark features (text) while preserving bright background (shadows/paper).
 */
function maxFilter(data: Uint8Array, w: number, h: number, radius: number) {
    const output = new Uint8Array(data.length);
    const temp = new Uint8Array(data.length);

    // Horizontal Pass
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let max = 0;
            const start = Math.max(0, x - radius);
            const end = Math.min(w - 1, x + radius);
            for (let k = start; k <= end; k += 2) {
                const val = data[y * w + k];
                if (val > max) max = val;
            }
            temp[y * w + x] = max;
        }
    }

    // Vertical Pass
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let max = 0;
            const start = Math.max(0, y - radius);
            const end = Math.min(h - 1, y + radius);
            for (let k = start; k <= end; k += 2) {
                const val = temp[k * w + x];
                if (val > max) max = val;
            }
            output[y * w + x] = max;
        }
    }
    return output;
}

// Helper: Convolution for Sharpening
function convolve(data: Uint8Array, w: number, h: number, kernel: number[]) {
    const out = new Float32Array(data.length);
    const kh = Math.sqrt(kernel.length);
    const half = Math.floor(kh / 2);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0;
            for (let ky = 0; ky < kh; ky++) {
                for (let kx = 0; kx < kh; kx++) {
                    const py = Math.min(Math.max(y + ky - half, 0), h - 1);
                    const px = Math.min(Math.max(x + kx - half, 0), w - 1);
                    r += data[py * w + px] * kernel[ky * kh + kx];
                }
            }
            out[y * w + x] = r;
        }
    }
    return out;
}

// --- HELPER: Box Blur for Background Estimation ---
function boxBlur(data: Uint8Array, w: number, h: number, r: number) {
    const temp = new Float32Array(data.length);
    const out = new Uint8Array(data.length);
    for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let i = 0; i <= r; i++) sum += data[y * w + Math.min(i, w - 1)];
        for (let i = 0; i < r; i++) sum += data[y * w];
        for (let x = 0; x < w; x++) {
            temp[y * w + x] = sum / (r * 2 + 1);
            sum -= data[y * w + Math.max(0, x - r)];
            sum += data[y * w + Math.min(w - 1, x + r + 1)];
        }
    }
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let i = 0; i <= r; i++) sum += temp[Math.min(i, h - 1) * w + x];
        for (let i = 0; i < r; i++) sum += temp[x];
        for (let y = 0; y < h; y++) {
            out[y * w + x] = sum / (r * 2 + 1);
            sum -= temp[Math.max(0, y - r) * w + x];
            sum += temp[Math.min(h - 1, y + r + 1) * w + x];
        }
    }
    return out;
}

function getOtsuThreshold(pixels: Uint8Array): number {
    const histogram = new Int32Array(256);
    for (let i = 0; i < pixels.length; i++) histogram[pixels[i]]++;
    let total = pixels.length, sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    let sumB = 0, wB = 0, wF = 0, varMax = 0, threshold = 0;
    for (let i = 0; i < 256; i++) {
        wB += histogram[i]; if (wB === 0) continue;
        wF = total - wB; if (wF === 0) break;
        sumB += i * histogram[i];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const varBetween = wB * wF * (mB - mF) * (mB - mF);
        if (varBetween > varMax) { varMax = varBetween; threshold = i; }
    }
    return threshold;
}

function isolateLargestBlob(mask: Uint8Array, w: number, h: number) {
    const labels = new Int32Array(w * h);
    let currentLabel = 1;
    const areas: Record<number, number> = {};
    const queue = new Int32Array(w * h);

    for (let i = 0; i < w * h; i++) {
        if (mask[i] === 255 && labels[i] === 0) {
            let qLen = 0; labels[i] = currentLabel; queue[qLen++] = i;
            let area = 0, head = 0;
            while (head < qLen) {
                const idx = queue[head++]; area++;
                const cx = idx % w;
                if (cx > 0 && mask[idx - 1] === 255 && labels[idx - 1] === 0) { labels[idx - 1] = currentLabel; queue[qLen++] = idx - 1; }
                if (cx < w - 1 && mask[idx + 1] === 255 && labels[idx + 1] === 0) { labels[idx + 1] = currentLabel; queue[qLen++] = idx + 1; }
                if (idx >= w && mask[idx - w] === 255 && labels[idx - w] === 0) { labels[idx - w] = currentLabel; queue[qLen++] = idx - w; }
                if (idx < w * (h - 1) && mask[idx + w] === 255 && labels[idx + w] === 0) { labels[idx + w] = currentLabel; queue[qLen++] = idx + w; }
            }
            areas[currentLabel] = area; currentLabel++;
        }
    }
    let maxArea = 0, maxLabel = 0;
    for (const l in areas) { if (areas[l] > maxArea) { maxArea = areas[l]; maxLabel = Number(l); } }
    const out = new Uint8Array(w * h);
    if (maxLabel !== 0) for (let i = 0; i < w * h; i++) out[i] = labels[i] === maxLabel ? 255 : 0;
    else for (let i = 0; i < w * h; i++) out[i] = 255;
    return out;
}

function findCornersFromMask(mask: Uint8Array, w: number, h: number) {
    let tl = { x: 0, y: 0, v: Infinity }, tr = { x: w, y: 0, v: -Infinity };
    let bl = { x: 0, y: h, v: Infinity }, br = { x: w, y: h, v: -Infinity };
    let found = false;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x] === 255) {
                found = true;
                const sum = x + y, diff = x - y;
                if (sum < tl.v) tl = { x, y, v: sum };
                if (diff > tr.v) tr = { x, y, v: diff };
                if (diff < bl.v) bl = { x, y, v: diff };
                if (sum > br.v) br = { x, y, v: sum };
            }
        }
    }
    if (!found) return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    return [tl, tr, br, bl];
}

// Interface for normalized points from the hook

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

            // --- 1. CALCULATE STRETCH FACTOR ---
            // How much is the top edge narrower than the bottom?
            // High Ratio (e.g., 2.0) means extreme angle -> Needs Extreme Sharpening
            const topWidth = Math.hypot(realCorners[0].x - realCorners[1].x, realCorners[0].y - realCorners[1].y);
            const botWidth = Math.hypot(realCorners[2].x - realCorners[3].x, realCorners[2].y - realCorners[3].y);
            const stretchRatio = botWidth / (topWidth || 1);

            const isExtremeAngle = stretchRatio > 1.3;

            // Target A4 High-Res
            const TARGET_WIDTH = 2480;
            const TARGET_HEIGHT = 3508;

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject("ctx error"); return; }
            ctx.drawImage(img, 0, 0);

            // --- 2. OPENCV WARP + ANTI-CURVE ---
            let src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
            let dst = new cv.Mat();

            let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                realCorners[0].x, realCorners[0].y,
                realCorners[1].x, realCorners[1].y,
                realCorners[2].x, realCorners[2].y,
                realCorners[3].x, realCorners[3].y
            ]);

            // Apply Pinch Correction based on angle severity
            // More angle = More pinch needed
            const pinchStrength = isExtremeAngle ? 0.05 : 0.02;
            const PAD = TARGET_WIDTH * pinchStrength;

            let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0 + PAD, 0,
                TARGET_WIDTH - PAD, 0,
                TARGET_WIDTH, TARGET_HEIGHT,
                0, TARGET_HEIGHT
            ]);

            let M = cv.getPerspectiveTransform(srcTri, dstTri);
            cv.warpPerspective(src, dst, M, new cv.Size(TARGET_WIDTH, TARGET_HEIGHT), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255));

            const warpedData = new Uint8ClampedArray(dst.data);
            src.delete(); dst.delete(); srcTri.delete(); dstTri.delete(); M.delete();

            // --- 3. DYNAMIC ENHANCEMENT ---
            const enhanced = new Uint8ClampedArray(TARGET_WIDTH * TARGET_HEIGHT * 4);
            const gray = new Uint8Array(TARGET_WIDTH * TARGET_HEIGHT);
            for (let i = 0; i < TARGET_WIDTH * TARGET_HEIGHT; i++) gray[i] = warpedData[i * 4 + 1];

            // A. Background Map
            const bgBlur = boxBlur(gray, TARGET_WIDTH, TARGET_HEIGHT, Math.ceil(TARGET_WIDTH * 0.04));

            // B. Conditional Sharpening Map
            // If extreme angle, use Strong Unsharp Mask
            let detailMap: Float32Array;
            if (isExtremeAngle) {
                // Strong sharpening kernel
                const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
                detailMap = convolve(gray, TARGET_WIDTH, TARGET_HEIGHT, kernel);
            } else {
                // Gentle blur subtraction
                detailMap = new Float32Array(gray.length);
                const subtle = boxBlur(gray, TARGET_WIDTH, TARGET_HEIGHT, 2);
                for (let i = 0; i < gray.length; i++) detailMap[i] = gray[i] + (gray[i] - subtle[i]) * 1.5;
            }

            for (let i = 0; i < warpedData.length; i += 4) {
                const px = warpedData[i + 1];
                const bg = bgBlur[i / 4] || 1;

                // 1. Flatten Lighting
                let val = (px / bg) * 255;

                // 2. Apply Sharpening
                if (isExtremeAngle) {
                    // Blend original with sharpened version
                    const sharpVal = detailMap[i / 4];
                    // On angled shots, text is grey/blurry. We prefer the sharpened signal.
                    val = (val * 0.4) + ((sharpVal / bg) * 255 * 0.6);
                } else {
                    const sharpVal = detailMap[i / 4];
                    val = (val * 0.7) + ((sharpVal / bg) * 255 * 0.3);
                }

                // 3. Contrast Crush (The "Scanner" Look)
                // If Angled, we must be more aggressive to hide blur
                const blackPoint = isExtremeAngle ? 120 : 100;
                const whitePoint = isExtremeAngle ? 190 : 210;

                if (val < blackPoint) val *= 0.7; // Crush blacks
                if (val > whitePoint) val = 255;  // Blow out whites

                // Gamma
                val = 255 * Math.pow(val / 255, 1.1);
                val = Math.max(0, Math.min(255, val));

                enhanced[i] = val;
                enhanced[i + 1] = val;
                enhanced[i + 2] = val;
                enhanced[i + 3] = 255;
            }

            // White Border
            const BORDER = 25;
            for (let y = 0; y < TARGET_HEIGHT; y++) {
                for (let x = 0; x < TARGET_WIDTH; x++) {
                    if (x < BORDER || x > TARGET_WIDTH - BORDER || y < BORDER || y > TARGET_HEIGHT - BORDER) {
                        const idx = (y * TARGET_WIDTH + x) * 4;
                        enhanced[idx] = 255; enhanced[idx + 1] = 255; enhanced[idx + 2] = 255; enhanced[idx + 3] = 255;
                    }
                }
            }

            const fCanvas = document.createElement('canvas');
            fCanvas.width = TARGET_WIDTH; fCanvas.height = TARGET_HEIGHT;
            fCanvas.getContext('2d')?.putImageData(new ImageData(enhanced, TARGET_WIDTH, TARGET_HEIGHT), 0, 0);
            fCanvas.toBlob(b => resolve(b!), 'image/jpeg', 0.90);
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

/**
 * OpenCV Perspective Warp (Mathematically Perfect)
 */
function warpPerspectiveCV(srcData: Uint8ClampedArray, sw: number, sh: number, corners: any[], dw: number, dh: number) {
    const cv = window.cv;
    const imageData = new ImageData(sw, sh);
    imageData.data.set(srcData);
    const src = cv.matFromImageData(imageData);
    const dst = new cv.Mat();
    const dsize = new cv.Size(dw, dh);

    // Source coordinates
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners[0].x, corners[0].y,
        corners[1].x, corners[1].y,
        corners[2].x, corners[2].y,
        corners[3].x, corners[3].y
    ]);

    // Destination coordinates
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        dw, 0,
        dw, dh,
        0, dh
    ]);

    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // Convert back to Uint8ClampedArray
    const result = new Uint8ClampedArray(dw * dh * 4);
    // Validation removed for lint compatibility
    result.set(dst.data);

    // Cleanup
    src.delete(); dst.delete(); M.delete(); srcPts.delete(); dstPts.delete();

    return result;
}

export function warpPerspective(src: Uint8ClampedArray, sw: number, sh: number, corners: any[], dw: number, dh: number) {
    const dst = new Uint8ClampedArray(dw * dh * 4);
    const x0 = corners[0].x, y0 = corners[0].y;
    const x1 = corners[1].x, y1 = corners[1].y;
    const x2 = corners[2].x, y2 = corners[2].y;
    const x3 = corners[3].x, y3 = corners[3].y;
    const system: number[][] = [];
    const sx = [0, dw, dw, 0], sy = [0, 0, dh, dh];
    const dx = [x0, x1, x2, x3], dy = [y0, y1, y2, y3];
    for (let i = 0; i < 4; i++) {
        system.push([sx[i], sy[i], 1, 0, 0, 0, -sx[i] * dx[i], -sy[i] * dx[i], dx[i]]);
        system.push([0, 0, 0, sx[i], sy[i], 1, -sx[i] * dy[i], -sy[i] * dy[i], dy[i]]);
    }
    for (let i = 0; i < 8; i++) {
        let max = i;
        for (let j = i + 1; j < 8; j++) if (Math.abs(system[j][i]) > Math.abs(system[max][i])) max = j;
        [system[i], system[max]] = [system[max], system[i]];
        for (let j = i + 1; j < 8; j++) {
            const m = system[j][i] / system[i][i];
            for (let k = i; k < 9; k++) system[j][k] -= m * system[i][k];
        }
    }
    const H = new Float32Array(9); H[8] = 1;
    for (let i = 7; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < 8; j++) sum += system[i][j] * H[j];
        H[i] = (system[i][8] - sum) / system[i][i];
    }
    for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
            const z = H[6] * x + H[7] * y + 1;
            const u = (H[0] * x + H[1] * y + H[2]) / z;
            const v = (H[3] * x + H[4] * y + H[5]) / z;
            const idx = (y * dw + x) * 4;
            if (u >= 0 && u < sw - 1 && v >= 0 && v < sh - 1) {
                const ix = Math.floor(u), iy = Math.floor(v);
                const fx = u - ix, fy = v - iy;
                const i00 = (iy * sw + ix) * 4, i10 = (iy * sw + ix + 1) * 4;
                const i01 = ((iy + 1) * sw + ix) * 4, i11 = ((iy + 1) * sw + ix + 1) * 4;
                for (let c = 0; c < 3; c++) {
                    dst[idx + c] = src[i00 + c] * (1 - fx) * (1 - fy) + src[i10 + c] * fx * (1 - fy) + src[i01 + c] * (1 - fx) * fy + src[i11 + c] * fx * fy;
                }
                dst[idx + 3] = 255;
            } else {
                dst[idx] = 255; dst[idx + 1] = 255; dst[idx + 2] = 255; dst[idx + 3] = 255;
            }
        }
    }
    return dst;
}
