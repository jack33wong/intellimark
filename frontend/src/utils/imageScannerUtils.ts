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
    // Pro-grade settings for the "Super Scanner"
    const {
        maxWidth = 2800,
        maxHeight = 2800,
        quality = 0.9
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
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

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
            const grayscale = new Uint8Array(width * height);
            for (let i = 0; i < data.length; i += 4) {
                // Standard luminance weights
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

            // Perform thresholding and store B&W in data
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

            // Step 3: Super Scanner Density-Grid Corner Detection
            // We scan a dense grid to find the "mass" of the document.
            const paperPoints: { x: number, y: number }[] = [];
            const gridSpacing = Math.max(4, Math.floor(width / 100));
            const window = Math.max(2, Math.floor(width / 200));
            const paperBrightnessThreshold = 200; // Documents are very bright white in BW

            for (let y = gridSpacing; y < height - gridSpacing; y += gridSpacing) {
                for (let x = gridSpacing; x < width - gridSpacing; x += gridSpacing) {
                    const x1 = x - window, x2 = x + window;
                    const y1 = y - window, y2 = y + window;
                    const count = (x2 - x1) * (y2 - y1);

                    // Simple pixel check on thresholded data is very reliable
                    let pCount = 0;
                    for (let wy = y1; wy <= y2; wy++) {
                        for (let wx = x1; wx <= x2; wx++) {
                            if (data[(wy * width + wx) * 4] === 255) pCount++;
                        }
                    }

                    if (pCount / count > 0.8) { // 80% white in window = paper
                        paperPoints.push({ x, y });
                    }
                }
            }

            if (paperPoints.length < 50) {
                // Return standard thresholded image if we can't find a paper mass
                ctx.putImageData(imageData, 0, 0);
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas fallback failed'));
                }, 'image/jpeg', quality);
                return;
            }

            // Quadrant-Extreme logic to find 4 corners
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

            // Pro-Warp Correction: Push corners slightly outwards (2%) to capture full paper
            const expand = (p: { x: number, y: number }, center: { x: number, y: number }, factor: number) => ({
                x: Math.max(0, Math.min(width - 1, p.x + (p.x - center.x) * factor)),
                y: Math.max(0, Math.min(height - 1, p.y + (p.y - center.y) * factor))
            });

            const center = {
                x: (tl.x + tr.x + br.x + bl.x) / 4,
                y: (tl.y + tr.y + br.y + bl.y) / 4
            };

            const margin = 0.02; // 2% outward margin
            tl = expand(tl, center, margin);
            tr = expand(tr, center, margin);
            br = expand(br, center, margin);
            bl = expand(bl, center, margin);

            // Perspective Warp Implementation
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
                    const bA = [d[0].x, d[0].y, d[1].x, d[1].y, d[2].x, d[2].y, d[3].x, d[3].y];
                    const n = 8;
                    for (let i = 0; i < n; i++) {
                        let max = i;
                        for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[max][i])) max = j;
                        [a[i], a[max]] = [a[max], a[i]];
                        [bA[i], bA[max]] = [bA[max], bA[i]];
                        for (let j = i + 1; j < n; j++) {
                            const c = a[j][i] / a[i][i];
                            for (let k = i; k < n; k++) a[j][k] -= c * a[i][k];
                            bA[j] -= c * bA[i];
                        }
                    }
                    const x = new Array(n);
                    for (let i = n - 1; i >= 0; i--) {
                        let sv = 0;
                        for (let j = i + 1; j < n; j++) sv += a[i][j] * x[j];
                        x[i] = (bA[i] - sv) / a[i][i];
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

            // Rectify: Warp corners to a top-down flat rectangle
            const warpedCanvas = warp(
                [tl, tr, br, bl],
                [{ x: 0, y: 0 }, { x: fW, y: 0 }, { x: fW, y: fH }, { x: 0, y: fH }],
                width, height, fW, fH
            );

            if (warpedCanvas) {
                warpedCanvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Warp result failed'));
                }, 'image/jpeg', quality);
            } else {
                ctx.putImageData(imageData, 0, 0);
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Final fallback failed'));
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
