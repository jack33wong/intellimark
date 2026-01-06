/**
 * Utility for client-side image scanning and enhancement.
 * This helper uses the Canvas API to:
 * 1. Fix orientation (by drawing to a canvas, we flatten EXIF)
 * 2. Apply document-style filters (Contrast, Brightness)
 * 3. Resize if necessary to save bandwidth
 */

export interface ScanOptions {
    contrast?: number;      // -100 to 100
    brightness?: number;    // -100 to 100
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;       // 0 to 1
}

export const processScannerImage = async (
    file: File | Blob,
    options: ScanOptions = {}
): Promise<Blob> => {
    const {
        contrast = 30,
        brightness = 5,
        maxWidth = 2000,
        maxHeight = 2000,
        quality = 0.85
    } = options;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // Calculate new dimensions
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = width * ratio;
                height = height * ratio;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            canvas.width = width;
            canvas.height = height;

            // Draw original image to canvas first
            ctx.drawImage(img, 0, 0, width, height);

            // Get image data for manual pixel manipulation
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // Step 1: Grayscale + Basic Contrast Boost
            // (Standard luminance weights: 0.299R + 0.587G + 0.114B)
            const grayscale = new Uint8Array(width * height);
            for (let i = 0; i < data.length; i += 4) {
                grayscale[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            }

            // Step 2: Adaptive Thresholding (Bradley-Roth)
            const s = Math.floor(width / 4);
            const t = 18;
            const integralImage = new Float64Array(width * height);

            // Calculate integral image (2D prefix sum)
            for (let i = 0; i < width; i++) {
                let colSum = 0;
                for (let j = 0; j < height; j++) {
                    const idx = j * width + i;
                    colSum += grayscale[idx];
                    if (i === 0) {
                        integralImage[idx] = colSum;
                    } else {
                        integralImage[idx] = integralImage[idx - 1] + colSum;
                    }
                }
            }

            // Perform thresholding
            for (let i = 0; i < width; i++) {
                for (let j = 0; j < height; j++) {
                    const index = j * width + i;

                    const x1 = Math.max(i - Math.floor(s / 2), 0);
                    const x2 = Math.min(i + Math.floor(s / 2), width - 1);
                    const y1 = Math.max(j - Math.floor(s / 2), 0);
                    const y2 = Math.min(j + Math.floor(s / 2), height - 1);

                    const count = (x2 - x1) * (y2 - y1);

                    let sum = integralImage[y2 * width + x2];
                    if (x1 > 0) sum -= integralImage[y2 * width + (x1 - 1)];
                    if (y1 > 0) sum -= integralImage[(y1 - 1) * width + x2];
                    if (x1 > 0 && y1 > 0) sum += integralImage[(y1 - 1) * width + (x1 - 1)];

                    const val = (grayscale[index] * count) < (sum * (100 - t) / 100) ? 0 : 255;

                    data[index * 4] = val;
                    data[index * 4 + 1] = val;
                    data[index * 4 + 2] = val;
                    data[index * 4 + 3] = 255;
                }
            }

            ctx.putImageData(imageData, 0, 0);

            // Step 3: 4-Point Corner Detection (Grid-Search Paper Mass)
            const paperPoints: { x: number, y: number }[] = [];
            const gridSize = 15;
            const win = 10;
            const paperThreshold = 180;

            for (let gy = gridSize; gy < height - gridSize; gy += gridSize) {
                for (let gx = gridSize; gx < width - gridSize; gx += gridSize) {
                    const x1 = Math.max(gx - win, 0);
                    const x2 = Math.min(gx + win, width - 1);
                    const y1 = Math.max(gy - win, 0);
                    const y2 = Math.min(gy + win, height - 1);
                    const count = (x2 - x1) * (y2 - y1);

                    let sum = integralImage[y2 * width + x2];
                    if (x1 > 0) sum -= integralImage[y2 * width + (x1 - 1)];
                    if (y1 > 0) sum -= integralImage[(y1 - 1) * width + x2];
                    if (x1 > 0 && y1 > 0) sum += integralImage[(y1 - 1) * width + (x1 - 1)];

                    if (sum / count > paperThreshold) {
                        paperPoints.push({ x: gx, y: gy });
                    }
                }
            }

            if (paperPoints.length < 100) {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas toBlob failed'));
                }, 'image/jpeg', quality);
                return;
            }

            // 2. Identify 4 extreme corners
            let tl = paperPoints[0], tr = paperPoints[0], br = paperPoints[0], bl = paperPoints[0];
            let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;

            for (const p of paperPoints) {
                const sum = p.x + p.y;
                const diff = p.x - p.y;
                if (sum < minSum) { minSum = sum; tl = p; }
                if (sum > maxSum) { maxSum = sum; br = p; }
                if (diff < minDiff) { minDiff = diff; bl = p; }
                if (diff > maxDiff) { maxDiff = diff; tr = p; }
            }

            // Safety Inset
            const inset = 20;
            tl = { x: tl.x + inset, y: tl.y + inset };
            tr = { x: tr.x - inset, y: tr.y + inset };
            br = { x: br.x - inset, y: br.y - inset };
            bl = { x: bl.x + inset, y: bl.y - inset };

            // 3. Perspective Warp
            const warp = (
                srcP: { x: number, y: number }[],
                dstP: { x: number, y: number }[],
                sW: number, sH: number, dW: number, dH: number
            ) => {
                const dCanvas = document.createElement('canvas');
                dCanvas.width = dW; dCanvas.height = dH;
                const dCtx = dCanvas.getContext('2d');
                if (!dCtx) return null;

                const getH = (s: typeof srcP, d: typeof dstP) => {
                    const a = [];
                    for (let i = 0; i < 4; i++) {
                        a.push([s[i].x, s[i].y, 1, 0, 0, 0, -s[i].x * d[i].x, -s[i].y * d[i].x]);
                        a.push([0, 0, 0, s[i].x, s[i].y, 1, -s[i].x * d[i].y, -s[i].y * d[i].y]);
                    }
                    const bArr = [d[0].x, d[0].y, d[1].x, d[1].y, d[2].x, d[2].y, d[3].x, d[3].y];
                    const n = 8;
                    for (let i = 0; i < n; i++) {
                        let max = i;
                        for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[max][i])) max = j;
                        [a[i], a[max]] = [a[max], a[i]];
                        [bArr[i], bArr[max]] = [bArr[max], bArr[i]];
                        for (let j = i + 1; j < n; j++) {
                            const c = a[j][i] / a[i][i];
                            for (let k = i; k < n; k++) a[j][k] -= c * a[i][k];
                            bArr[j] -= c * bArr[i];
                        }
                    }
                    const x = new Array(n);
                    for (let i = n - 1; i >= 0; i--) {
                        let sv = 0;
                        for (let j = i + 1; j < n; j++) sv += a[i][j] * x[j];
                        x[i] = (bArr[i] - sv) / a[i][i];
                    }
                    return [...x, 1];
                };

                const h = getH(dstP, srcP);
                const dImgData = dCtx.createImageData(dW, dH);
                const dD = dImgData.data;

                for (let y = 0; y < dH; y++) {
                    for (let x = 0; x < dW; x++) {
                        const w = h[6] * x + h[7] * y + h[8];
                        const sx = Math.floor((h[0] * x + h[1] * y + h[2]) / w);
                        const sy = Math.floor((h[3] * x + h[4] * y + h[5]) / w);
                        if (sx >= 0 && sx < sW && sy >= 0 && sy < sH) {
                            const si = (sy * sW + sx) * 4; const di = (y * dW + x) * 4;
                            dD[di] = data[si]; dD[di + 1] = data[si + 1]; dD[di + 2] = data[si + 2]; dD[di + 3] = 255;
                        }
                    }
                }
                dCtx.putImageData(dImgData, 0, 0);
                return dCanvas;
            };

            const dist = (p1: any, p2: any) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
            const fW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
            const fH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));

            const wCanvas = warp([tl, tr, br, bl], [{ x: 0, y: 0 }, { x: fW, y: 0 }, { x: fW, y: fH }, { x: 0, y: fH }], width, height, fW, fH);

            if (wCanvas) {
                wCanvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Warp failed'));
                }, 'image/jpeg', quality);
            } else {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Fallback failed'));
                }, 'image/jpeg', quality);
            }
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(url); reject(err);
        };
        img.src = url;
    });
};
