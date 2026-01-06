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
            // This handles variable lighting and removes shadows by comparing each pixel 
            // to the average of its neighbors.
            const s = Math.floor(width / 4); // Larger window size for better shadow removal
            const t = 18; // Increased threshold percentage (Bradley-Roth)
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

                    // Calc neighborhood bounds (s x s)
                    const x1 = Math.max(i - Math.floor(s / 2), 0);
                    const x2 = Math.min(i + Math.floor(s / 2), width - 1);
                    const y1 = Math.max(j - Math.floor(s / 2), 0);
                    const y2 = Math.min(j + Math.floor(s / 2), height - 1);

                    const count = (x2 - x1) * (y2 - y1);

                    // Sum of neighborhood using integral image
                    // Formula: S(x2, y2) - S(x1-1, y2) - S(x2, y1-1) + S(x1-1, y1-1)
                    let sum = integralImage[y2 * width + x2];
                    if (x1 > 0) sum -= integralImage[y2 * width + (x1 - 1)];
                    if (y1 > 0) sum -= integralImage[(y1 - 1) * width + x2];
                    if (x1 > 0 && y1 > 0) sum += integralImage[(y1 - 1) * width + (x1 - 1)];

                    // Set pixel to black or white
                    const val = (grayscale[index] * count) < (sum * (100 - t) / 100) ? 0 : 255;

                    data[index * 4] = val;     // R
                    data[index * 4 + 1] = val; // G
                    data[index * 4 + 2] = val; // B
                    data[index * 4 + 3] = 255; // Force opaque
                }
            }

            // Commit thresholded pixels back to the canvas
            ctx.putImageData(imageData, 0, 0);

            // Step 3: 4-Point Corner Detection & Perspective Warp
            // 1. Find all sharp edge points (Sobel)
            const edgePoints: { x: number, y: number }[] = [];
            const edgeThreshold = 30;

            for (let y = 4; y < height - 4; y += 4) { // Step 4 for speed
                for (let x = 4; x < width - 4; x += 4) {
                    const idx = y * width + x;
                    const p1 = grayscale[(y - 1) * width + (x - 1)];
                    const p2 = grayscale[(y - 1) * width + x];
                    const p3 = grayscale[(y - 1) * width + (x + 1)];
                    const p4 = grayscale[y * width + (x - 1)];
                    const p6 = grayscale[y * width + (x + 1)];
                    const p7 = grayscale[(y + 1) * width + (x - 1)];
                    const p8 = grayscale[(y + 1) * width + x];
                    const p9 = grayscale[(y + 1) * width + (x + 1)];

                    const gx = (p3 + 2 * p6 + p9) - (p1 + 2 * p4 + p7);
                    const gy = (p7 + 2 * p8 + p9) - (p1 + 2 * p2 + p3);
                    const magnitude = Math.sqrt(gx * gx + gy * gy);

                    if (magnitude > edgeThreshold) {
                        edgePoints.push({ x, y });
                    }
                }
            }

            if (edgePoints.length < 30) {
                // Fallback: Just return the thresholded image if we can't find edges
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas toBlob failed'));
                }, 'image/jpeg', quality);
                return;
            }

            // 2. Identify 4 extreme corners
            let tl = edgePoints[0], tr = edgePoints[0], br = edgePoints[0], bl = edgePoints[0];
            let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;

            for (const p of edgePoints) {
                const sum = p.x + p.y;
                const diff = p.x - p.y;
                if (sum < minSum) { minSum = sum; tl = p; }
                if (sum > maxSum) { maxSum = sum; br = p; }
                if (diff < minDiff) { minDiff = diff; bl = p; }
                if (diff > maxDiff) { maxDiff = diff; tr = p; }
            }

            // 3. Perspective Warp Implementation
            const warp = (
                srcPoints: { x: number, y: number }[],
                dstPoints: { x: number, y: number }[],
                sWidth: number,
                sHeight: number,
                dWidth: number,
                dHeight: number
            ) => {
                const dstCanvas = document.createElement('canvas');
                dstCanvas.width = dWidth;
                dstCanvas.height = dHeight;
                const dstCtx = dstCanvas.getContext('2d');
                if (!dstCtx) return null;

                // Solving for H where H * [xs, ys, 1] = [xd, yd, 1]
                // We actually solve for the inverse transform to sample pixels from src
                const getH = (s: typeof srcPoints, d: typeof dstPoints) => {
                    const a = [];
                    for (let i = 0; i < 4; i++) {
                        a.push([s[i].x, s[i].y, 1, 0, 0, 0, -s[i].x * d[i].x, -s[i].y * d[i].x]);
                        a.push([0, 0, 0, s[i].x, s[i].y, 1, -s[i].x * d[i].y, -s[i].y * d[i].y]);
                    }
                    const b = [d[0].x, d[0].y, d[1].x, d[1].y, d[2].x, d[2].y, d[3].x, d[3].y];

                    // Gaussian elimination Ax = B
                    const n = 8;
                    for (let i = 0; i < n; i++) {
                        let max = i;
                        for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[max][i])) max = j;
                        [a[i], a[max]] = [a[max], a[i]];
                        [b[i], b[max]] = [b[max], b[i]];
                        for (let j = i + 1; j < n; j++) {
                            const c = a[j][i] / a[i][i];
                            for (let k = i; k < n; k++) a[j][k] -= c * a[i][k];
                            b[j] -= c * b[i];
                        }
                    }
                    const xArr = new Array(n);
                    for (let i = n - 1; i >= 0; i--) {
                        let sumVal = 0;
                        for (let j = i + 1; j < n; j++) sumVal += a[i][j] * xArr[j];
                        xArr[i] = (b[i] - sumVal) / a[i][i];
                    }
                    return [...xArr, 1];
                };

                const h = getH(dstPoints, srcPoints); // Inverse transform
                const dstImgData = dstCtx.createImageData(dWidth, dHeight);
                const dData = dstImgData.data;

                for (let y = 0; y < dHeight; y++) {
                    for (let x = 0; x < dWidth; x++) {
                        const w = h[6] * x + h[7] * y + h[8];
                        const sx = Math.floor((h[0] * x + h[1] * y + h[2]) / w);
                        const sy = Math.floor((h[3] * x + h[4] * y + h[5]) / w);

                        if (sx >= 0 && sx < sWidth && sy >= 0 && sy < sHeight) {
                            const sIdx = (sy * sWidth + sx) * 4;
                            const dIdx = (y * dWidth + x) * 4;
                            dData[dIdx] = data[sIdx];
                            dData[dIdx + 1] = data[sIdx + 1];
                            dData[dIdx + 2] = data[sIdx + 2];
                            dData[dIdx + 3] = 255;
                        }
                    }
                }
                dstCtx.putImageData(dstImgData, 0, 0);
                return dstCanvas;
            };

            // Estimate final dimensions
            const dist = (p1: any, p2: any) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
            const finalW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
            const finalH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));

            const warpedCanvas = warp(
                [tl, tr, br, bl],
                [{ x: 0, y: 0 }, { x: finalW, y: 0 }, { x: finalW, y: finalH }, { x: 0, y: finalH }],
                width, height, finalW, finalH
            );

            if (warpedCanvas) {
                warpedCanvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Warp toBlob failed'));
                }, 'image/jpeg', quality);
            } else {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas toBlob failed'));
                }, 'image/jpeg', quality);
            }
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };

        img.src = url;
    });
};
