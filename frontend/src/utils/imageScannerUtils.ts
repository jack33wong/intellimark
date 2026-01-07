/**
 * Ultimate Document Scanner V12 - Morphological Edition
 * 1. Detection: Luminance-based (Otsu) - ignores wood grain/textures.
 * 2. Perspective: sortCorners ensures NO twisted/hourglass images.
 * 3. Shadow Killer: Morphological Closing (Max Filter) erases text from background map.
 * 4. Legibility: Gamma + Black Point Clamping + Division Normalization.
 */

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
            // Erasure of text from bg map using Max Filter (Dilation)
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
export interface NormalizedPoint { x: number; y: number; }

/**
 * Performs an instant perspective crop using pre-calculated corners.
 * Skips heavy detection algorithms for immediate results.
 */
export const performInstantCrop = async (
    imageBlob: Blob,
    normalizedCorners: NormalizedPoint[]
): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            const width = img.width;
            const height = img.height;

            // 1. De-normalize corners to full image coordinates
            const realCorners = normalizedCorners.map(p => ({
                x: p.x * width,
                y: p.y * height
            }));

            // 2. Calculate destination dimensions (A4 logic)
            const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
            let dwW = Math.max(dist(realCorners[0], realCorners[1]), dist(realCorners[2], realCorners[3]));
            let dhH = Math.max(dist(realCorners[0], realCorners[3]), dist(realCorners[1], realCorners[2]));

            const ar = dwW / dhH;
            // Snap to A4 portrait if close
            if (ar > 0.6 && ar < 0.85) dwW = dhH * 0.707;
            // Snap to A4 landscape if close
            else if (ar > 1.2 && ar < 1.5) dwW = dhH * 1.414;

            dwW = Math.round(dwW);
            dhH = Math.round(dhH);

            // 3. Draw original image to get data
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { reject("Context failed"); return; }
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, width, height).data;

            // 4. Perform the Warp using existing utility function
            const warped = warpPerspective(data, width, height, realCorners, dwW, dhH);

            // --- PHASE 3: SHADOW KILLING ENHANCEMENT (V19.1 SYNC) ---
            const blackPoint = 50;
            const contrast = 1.1;

            const warpedGreen = new Uint8Array(dwW * dhH);
            for (let i = 0; i < dwW * dhH; i++) warpedGreen[i] = warped[i * 4 + 1];

            // 3.1 MORPHOLOGICAL CLOSING
            const textRemoved = maxFilter(warpedGreen, dwW, dhH, Math.ceil(dwW * 0.015));
            const shadowMap = boxBlur(textRemoved, dwW, dhH, Math.ceil(dwW * 0.05));

            const enhanced = new Uint8ClampedArray(dwW * dhH * 4);

            for (let i = 0; i < dwW * dhH; i++) {
                const pixel = warped[i * 4 + 1];
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

            // 5. Put data onto final canvas
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = dwW; finalCanvas.height = dhH;
            const fCtx = finalCanvas.getContext('2d');
            fCtx?.putImageData(new ImageData(enhanced, dwW, dhH), 0, 0);

            // 6. Return result
            finalCanvas.toBlob(blob => resolve(blob!), 'image/jpeg', 0.95);
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
