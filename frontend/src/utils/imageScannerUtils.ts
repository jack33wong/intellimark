/**
 * Utility for client-side image scanning and enhancement.
 * This helper uses the Canvas API to:
 * 1. Fix orientation (by drawing to a canvas, we flatten EXIF)
 * 2. Apply document-style filters (Contrast, Brightness)
 * 3. Resize if necessary to save bandwidth
 */

export interface ScanOptions {
    contrast?: number;      // -100 to 100
    // Configuration: Max Resolution & Quality
    // Bumped to 4500px for "Ultra High Res"
    // maxWidth and maxHeight are now fixed constants within the function, not options.
    quality?: number;       // 0 to 1
    onStatusUpdate?: (status: string) => void;
}

export const processScannerImage = async (
    file: File | Blob,
    options: ScanOptions = {}
): Promise<Blob> => {
    // Pro-grade settings for the "Super Scanner"
    const {
        quality = 0.85, // Slightly lower quality for faster transmission
        onStatusUpdate
    } = options;

    // Fixed max dimensions for "Ultra High Res"
    const maxWidth = 4500;
    const maxHeight = 4500;

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

            // Helper for box blur
            const boxBlur = (pixels: Uint8ClampedArray, w: number, h: number, radius: number) => {
                const temp = new Uint8ClampedArray(w * h);
                // Horizontal pass
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        let sum = 0;
                        let count = 0;
                        for (let i = -radius; i <= radius; i++) {
                            const nx = x + i;
                            if (nx >= 0 && nx < w) {
                                sum += pixels[y * w + nx];
                                count++;
                            }
                        }
                        temp[y * w + x] = sum / count;
                    }
                }
                // Vertical pass
                for (let x = 0; x < w; x++) {
                    for (let y = 0; y < h; y++) {
                        let sum = 0;
                        let count = 0;
                        for (let i = -radius; i <= radius; i++) {
                            const ny = y + i;
                            if (ny >= 0 && ny < h) {
                                sum += temp[ny * w + x];
                                count++;
                            }
                        }
                        pixels[y * w + x] = sum / count;
                    }
                }
            };

            // Helper for integral image sum query
            const getSum = (x1: number, y1: number, x2: number, y2: number) => {
                let s = integral[y2 * width + x2];
                if (x1 > 0) s -= integral[y2 * width + (x1 - 1)];
                if (y1 > 0) s -= integral[(y1 - 1) * width + x2];
                if (x1 > 0 && y1 > 0) s += integral[(y1 - 1) * width + (x1 - 1)];
                return s;
            };

            // Helper: Otsu Threshold for robust mask generation
            const getOtsuThreshold = (pixels: Uint8ClampedArray) => {
                const histogram = new Array(256).fill(0);
                for (let i = 0; i < pixels.length; i++) histogram[pixels[i]]++;
                let total = pixels.length;
                let sum = 0;
                for (let i = 0; i < 256; i++) sum += i * histogram[i];
                let sumB = 0, wB = 0, wF = 0, varMax = 0, threshold = 0;
                for (let i = 0; i < 256; i++) {
                    wB += histogram[i];
                    if (wB === 0) continue;
                    wF = total - wB;
                    if (wF === 0) break;
                    sumB += i * histogram[i];
                    const mB = sumB / wB;
                    const mF = (sum - sumB) / wF;
                    const varBetween = wB * wF * (mB - mF) * (mB - mF);
                    if (varBetween > varMax) {
                        varMax = varBetween;
                        threshold = i;
                    }
                }
                return threshold;
            };

            // 1. Grayscale
            const gray = new Uint8ClampedArray(width * height);
            let minVal = 255, maxVal = 0;

            for (let i = 0; i < width * height; i++) {
                const r = data[i * 4];
                const g = data[i * 4 + 1];
                const b = data[i * 4 + 2];
                // Luma calculation
                const val = 0.299 * r + 0.587 * g + 0.114 * b;
                gray[i] = val;
                if (val < minVal) minVal = val;
                if (val > maxVal) maxVal = val;
            }

            // 1.1 Contrast Stretching (Enhance Text)
            // Essential since we removed standard normalization
            const range = maxVal - minVal;
            if (range > 0) {
                for (let i = 0; i < width * height; i++) {
                    gray[i] = ((gray[i] - minVal) / range) * 255;
                }
            }

            // 2. MASK GENERATION (For Corner Detection)
            // Use Otsu's Threshold to find the paper blob. This is robust vs shading.
            const otsuLevel = getOtsuThreshold(gray);
            const mask = new Uint8Array(width * height);
            for (let i = 0; i < width * height; i++) {
                mask[i] = gray[i] >= otsuLevel ? 1 : 0;
            }

            // 3. OUTPUT GENERATION (For Display/Warp)
            // Use standard Adaptive Thresholding on a BLURRED image to remove shadows/noise.
            // We reverted background division as it was unstable.

            // 3.1 Blur the gray channel (Denoise)
            // Tuning V5: Set to 5 (11x11). (Prioritize Solid Fill).
            const blurredGray = new Uint8ClampedArray(width * height);
            for (let i = 0; i < width * height; i++) blurredGray[i] = gray[i];
            boxBlur(blurredGray, width, height, 5);

            // 3.2 Adaptive Threshold
            const thresholded = new Uint8ClampedArray(width * height);
            const integral = new Int32Array(width * height);

            let sum = 0;
            for (let i = 0; i < width; i++) { sum += blurredGray[i]; integral[i] = sum; }
            for (let y = 1; y < height; y++) {
                sum = 0;
                for (let x = 0; x < width; x++) {
                    sum += blurredGray[y * width + x];
                    integral[y * width + x] = integral[(y - 1) * width + x] + sum;
                }
            }

            // TUNING FOR SHADOW RESCUE + CLARITY:
            // s = width / 40 (~100px): Local adaptation kills heavy shadows.
            // t = 8: Very gentle. (12 was still breaking text).
            const s = Math.round(width / 40);
            const t = 8;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const x1 = Math.max(0, x - s);
                    const x2 = Math.min(width - 1, x + s);
                    const y1 = Math.max(0, y - s);
                    const y2 = Math.min(height - 1, y + s);
                    const count = (x2 - x1 + 1) * (y2 - y1 + 1);
                    const sumRegion = getSum(x1, y1, x2, y2);
                    const regionMean = sumRegion / count;

                    if (blurredGray[y * width + x] <= regionMean * ((100 - t) / 100)) {
                        thresholded[y * width + x] = 1;
                    } else {
                        thresholded[y * width + x] = 0;
                    }
                }
            }

            // Apply thresholded result to image data (This is what wraps around the paper)
            for (let i = 0; i < width * height; i++) {
                const val = thresholded[i] === 1 ? 0 : 255;
                data[i * 4] = val;
                data[i * 4 + 1] = val;
                data[i * 4 + 2] = val;
                data[i * 4 + 3] = 255;
            }

            // Step 3: Pro Rectification (Uses 'mask' from Otsu)
            onStatusUpdate?.('Detecting edges...');

            // 3.1 Mask Processing (Use the Otsu mask we calculated earlier)
            // (Previously we re-calculated mask from data, but data is now noisy text. Otsu is solid.)

            // 3.1.2: Mask Erosion (3x3 kernel)
            // Detach paper from edge artifacts
            const kernelSize = 1; // 3x3
            const erodedMask = new Uint8Array(width * height);
            for (let y = kernelSize; y < height - kernelSize; y++) {
                for (let x = kernelSize; x < width - kernelSize; x++) {
                    let minVal = 1;
                    // If any neighbor is 0 (black), the pixel becomes 0
                    for (let ky = -kernelSize; ky <= kernelSize; ky++) {
                        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
                            if (mask[(y + ky) * width + (x + kx)] === 0) {
                                minVal = 0;
                                break;
                            }
                        }
                        if (minVal === 0) break;
                    }
                    erodedMask[y * width + x] = minVal;
                }
            }

            // 3.1.5: Vertical Smear (Bridge Gaps)
            // Tuned: Radius 15px (was 20), Bottom 50% (was 30).
            // - Reduced radius to prevent merging distant shadows (like the user's hand).
            // - Increased area to 50% to safely catch high footers without touching the top desk edge.
            const smearedMask = new Uint8Array(width * height);
            const smearRadius = 15;
            const smearStart = Math.floor(height * 0.5);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    // Only apply smear logic in the bottom half
                    if (y > smearStart && erodedMask[y * width + x] === 1) {
                        for (let k = 0; k <= smearRadius && y + k < height; k++) {
                            smearedMask[(y + k) * width + x] = 1;
                        }
                    }
                    // Always keep existing white pixels
                    if (erodedMask[y * width + x] === 1) smearedMask[y * width + x] = 1;
                }
            }
            erodedMask.set(smearedMask);

            // 3.1.6: Noise Isolation - Largest Connected Component (LCC)
            // Filter out independent noise blobs (like desk edges) that aren't the main paper.
            // Using Iterative BFS with a pre-allocated queue for performance.

            onStatusUpdate?.('Isolating document...');

            const labels = new Int32Array(width * height); // 0 = unvisited/background, >0 = label
            let currentLabel = 1;
            const labelAreas: Record<number, number> = {};
            const queue = new Int32Array(width * height); // Pre-allocated queue to avoid GC

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    if (erodedMask[idx] === 1 && labels[idx] === 0) {
                        // Start new component
                        const myLabel = currentLabel++;
                        labels[idx] = myLabel;
                        labelAreas[myLabel] = 1;

                        let qHead = 0;
                        let qTail = 0;
                        queue[qTail++] = idx;

                        while (qHead < qTail) {
                            const currIdx = queue[qHead++];
                            const cx = currIdx % width;
                            const cy = Math.floor(currIdx / width);

                            // Check 4-neighbors
                            const neighbors = [
                                { nx: cx - 1, ny: cy, nIdx: currIdx - 1 },
                                { nx: cx + 1, ny: cy, nIdx: currIdx + 1 },
                                { nx: cx, ny: cy - 1, nIdx: currIdx - width },
                                { nx: cx, ny: cy + 1, nIdx: currIdx + width }
                            ];

                            for (const { nx, ny, nIdx } of neighbors) {
                                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                    if (erodedMask[nIdx] === 1 && labels[nIdx] === 0) {
                                        labels[nIdx] = myLabel;
                                        labelAreas[myLabel]++;
                                        queue[qTail++] = nIdx;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Find largest component
            let maxLabel = -1;
            let maxArea = -1;
            for (const [lbl, area] of Object.entries(labelAreas)) {
                if (area > maxArea) {
                    maxArea = area;
                    maxLabel = parseInt(lbl);
                }
            }

            // Filter mask: Keep ONLY the largest component
            if (maxLabel !== -1) {
                for (let i = 0; i < width * height; i++) {
                    if (labels[i] !== maxLabel) {
                        erodedMask[i] = 0;
                    }
                }
            }

            // 3.1.6: Morphological Dilation (3x3) - "Grow" the mask back
            // The thresholding might have shrunk the paper due to shadows.
            // We dilate to push the edges back out to the real paper boundary.
            const dilatedMask = new Uint8Array(width * height);
            // Pass 1
            for (let y = kernelSize; y < height - kernelSize; y++) {
                for (let x = kernelSize; x < width - kernelSize; x++) {
                    let maxVal = 0;
                    for (let ky = -kernelSize; ky <= kernelSize; ky++) {
                        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
                            if (erodedMask[(y + ky) * width + (x + kx)] === 1) {
                                maxVal = 1; break;
                            }
                        }
                        if (maxVal === 1) break;
                    }
                    dilatedMask[y * width + x] = maxVal;
                }
            }
            // Pass 2 (Double Dilation) - Ensure we cover the real edge
            const dilatedMask2 = new Uint8Array(width * height);
            for (let y = kernelSize; y < height - kernelSize; y++) {
                for (let x = kernelSize; x < width - kernelSize; x++) {
                    let maxVal = 0;
                    for (let ky = -kernelSize; ky <= kernelSize; ky++) {
                        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
                            if (dilatedMask[(y + ky) * width + (x + kx)] === 1) {
                                maxVal = 1; break;
                            }
                        }
                        if (maxVal === 1) break;
                    }
                    dilatedMask2[y * width + x] = maxVal;
                }
            }

            // 3.2: Extract Edge Points from DILATED Mask
            const edgePoints: { x: number, y: number }[] = [];
            let cx = 0, cy = 0;
            let pointCount = 0;

            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    if (dilatedMask2[idx] === 1) {
                        // Check if it's an edge (has a 0 neighbor)
                        let isEdge = false;
                        if (dilatedMask2[idx - 1] === 0 || dilatedMask2[idx + 1] === 0 ||
                            dilatedMask2[idx - width] === 0 || dilatedMask2[idx + width] === 0) {
                            isEdge = true;
                        }

                        if (isEdge) {
                            // Downsample edges for performance
                            if (Math.random() < 0.2) {
                                edgePoints.push({ x, y });
                            }
                        }

                        // Accumulate for centroid (use all points for stability)
                        // Optimization: sample for centroid too
                        if (x % 4 === 0 && y % 4 === 0) {
                            cx += x;
                            cy += y;
                            pointCount++;
                        }
                    }
                }
            }

            if (pointCount === 0 || edgePoints.length < 20) {
                // Fallback: Return original
                ctx.putImageData(imageData, 0, 0);
                canvas.toBlob((blob) => resolve(blob!), 'image/png');
                return;
            }

            cx /= pointCount;
            cy /= pointCount;

            // 3.3 New Corner Finding Strategy: Quadrant Extremes (Robust for Trapezoids)
            // Instead of line intersection (which fails on angles), we find the specific pixel
            // in each quadrant that is "furthest" in the diagonal direction.
            // This is the absolute most robust way to find corners of an arbitrary convex blob.

            let tl = { x: 0, y: 0 }, tr = { x: width, y: 0 };
            let br = { x: width, y: height }, bl = { x: 0, y: height };
            let maxTL = -Infinity, maxTR = -Infinity, maxBR = -Infinity, maxBL = -Infinity;

            for (const p of edgePoints) {
                // Score = dot product with diagonal vector
                // TL: minimize x+y (or maximize -x-y)
                const scoreTL = -p.x - p.y;
                // TR: maximize x-y
                const scoreTR = p.x - p.y;
                // BR: maximize x+y
                const scoreBR = p.x + p.y;
                // BL: maximize -x+y
                const scoreBL = -p.x + p.y;

                if (scoreTL > maxTL) { maxTL = scoreTL; tl = p; }
                if (scoreTR > maxTR) { maxTR = scoreTR; tr = p; }
                if (scoreBR > maxBR) { maxBR = scoreBR; br = p; }
                if (scoreBL > maxBL) { maxBL = scoreBL; bl = p; }
            }

            // Safety check: if mask is weird, fallback to bbox
            const dist = (p1: any, p2: any) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
            if (dist(tl, tr) < width * 0.2) {
                tl = { x: 0, y: 0 }; tr = { x: width, y: 0 };
                br = { x: width, y: height }; bl = { x: 0, y: height };
            }

            // Pro-Warp Correction: Push corners slightly outwards (10%)
            // Reduced from 17% to 10% to fix "perspective distortion" and "bottom black edge" (User Report)
            // A tighter crop makes the paper larger and reduces desk inclusion.
            const margin = 0.10;

            const minX = Math.min(tl.x, tr.x, br.x, bl.x);
            const maxX = Math.max(tl.x, tr.x, br.x, bl.x);
            const minY = Math.min(tl.y, tr.y, br.y, bl.y);
            const maxY = Math.max(tl.y, tr.y, br.y, bl.y);

            const center = {
                x: (minX + maxX) / 2,
                y: (minY + maxY) / 2
            };
            const expand = (p: { x: number, y: number }) => ({
                x: Math.max(0, Math.min(width - 1, p.x + (p.x - center.x) * margin)),
                y: Math.max(0, Math.min(height - 1, p.y + (p.y - center.y) * margin))
            });
            tl = expand(tl); tr = expand(tr); br = expand(br); bl = expand(bl);

            // Perspective Warp (Reuse logic)
            onStatusUpdate?.('Warping document...');
            const warp = (
                srcP: { x: number, y: number }[],
                dstP: { x: number, y: number }[],
                sW: number, sH: number, dW: number, dH: number,
                srcData: Uint8ClampedArray = data // Default to main image data
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
                            dD[di] = srcData[si]; dD[di + 1] = srcData[si + 1]; dD[di + 2] = srcData[si + 2]; dD[di + 3] = 255;
                        } else {
                            const di = (y * dW + x) * 4;
                            dD[di] = 255; dD[di + 1] = 255; dD[di + 2] = 255; dD[di + 3] = 255;
                        }
                    }
                }
                dCtx.putImageData(dImgData, 0, 0);
                return dCanvas;
            };

            // 3.4: "Smart Snap" Aspect Ratio Enforcement
            // Problem: Angled A4 photos look short/fat (Squashed). 
            // Solution: Snap to A4 (1:1.414) ONLY if the raw shape is within the "A4 Zone".
            // Non-A4 items (Receipts, Square notes) are preserved exactly as-is.

            let fW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
            let fH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));

            const currentRatio = fW / fH;
            const targetRatio = 1 / 1.414; // A4 Portrait (~0.707)

            // A4 Zone: 0.60 to 0.85
            // - Raw A4 is 0.707.
            // - Angled A4 often reads as 0.75 - 0.80.
            // - Receipts are usually < 0.50.
            // - Letter/US Paper is ~0.77 (will snap to A4, which is acceptable).
            // - Square-ish items are > 0.85.
            if (currentRatio > 0.60 && currentRatio < 0.85) {
                // It's likely an A4 Page -> Snap to Perfect Dimensions
                if (fH > fW) {
                    fW = Math.round(fH * targetRatio);
                } else {
                    fH = Math.round(fW / targetRatio);
                }
            }

            // 3.5: Border Cleanup
            const cleanBorders = (canvas: HTMLCanvasElement) => {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const w = canvas.width;
                const h = canvas.height;
                const imgData = ctx.getImageData(0, 0, w, h);
                const d = imgData.data;
                const isBlack = (pixelIdx: number) => d[pixelIdx] === 0;

                // Clean Top (Aggressive)
                for (let y = 0; y < h * 0.1; y++) {
                    let blackCount = 0;
                    for (let x = 0; x < w; x++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > w * 0.15) {
                        for (let x = 0; x < w; x++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break;
                }

                // Clean Bottom (Tune: 0.50 Threshold)
                for (let y = h - 1; y > h * 0.95; y--) {
                    let blackCount = 0;
                    for (let x = 0; x < w; x++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > w * 0.50) {
                        for (let x = 0; x < w; x++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break;
                }

                // Clean Left (Aggressive)
                for (let x = 0; x < w * 0.1; x++) {
                    let blackCount = 0;
                    for (let y = 0; y < h; y++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > h * 0.15) {
                        for (let y = 0; y < h; y++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break;
                }

                // Clean Right (Aggressive)
                for (let x = w - 1; x > w * 0.9; x--) {
                    let blackCount = 0;
                    for (let y = 0; y < h; y++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > h * 0.15) {
                        for (let y = 0; y < h; y++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break;
                }

                ctx.putImageData(imgData, 0, 0);
            };

            // 3.5: Border Cleanup via Mask Compositing (Bulletproof)
            // Problem: Margin expansion (10%) brings back desk texture, which becomes black noise.
            // Solution: Warp the detection MASK along with the image. Force background pixels to White.

            // 1. Warp the Image (Thresholded Data)
            const warpedCanvas = warp(
                [tl, tr, br, bl],
                [{ x: 0, y: 0 }, { x: fW, y: 0 }, { x: fW, y: fH }, { x: 0, y: fH }],
                width, height, fW, fH,
                data // Source: Thresholded Image
            );

            // 2. Warp the Mask (dilatedMask2 - The Paper Blob)
            // We need to convert the Uint8 mask to RGBA for the warp function
            const maskData = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < width * height; i++) {
                const val = dilatedMask2[i] === 1 ? 255 : 0;
                maskData[i * 4] = val;   // R
                maskData[i * 4 + 1] = val; // G
                maskData[i * 4 + 2] = val; // B
                maskData[i * 4 + 3] = 255; // A
            }

            const warpedMaskCanvas = warp(
                [tl, tr, br, bl],
                [{ x: 0, y: 0 }, { x: fW, y: 0 }, { x: fW, y: fH }, { x: 0, y: fH }],
                width, height, fW, fH,
                maskData // Source: The Mask
            );

            if (warpedCanvas && warpedMaskCanvas) {
                const ctx = warpedCanvas.getContext('2d');
                const maskCtx = warpedMaskCanvas.getContext('2d');
                if (ctx && maskCtx) {
                    const outData = ctx.getImageData(0, 0, fW, fH);
                    const outMask = maskCtx.getImageData(0, 0, fW, fH).data;
                    const d = outData.data;

                    // 3. Composite: If Mask says "Background", Set to White.
                    // We check the Red channel of the mask (0 = Black/Bg, 255 = White/Paper)
                    for (let i = 0; i < fW * fH; i++) {
                        // Use a loose threshold (128) to handle interpolation gray areas
                        if (outMask[i * 4] < 128) {
                            d[i * 4] = 255;     // R
                            d[i * 4 + 1] = 255; // G
                            d[i * 4 + 2] = 255; // B
                            d[i * 4 + 3] = 255; // A
                        }
                    }
                    ctx.putImageData(outData, 0, 0);

                    // Optional: Run cleanBorders as a secondary safety net
                    cleanBorders(warpedCanvas);

                    warpedCanvas.toBlob((blob) => resolve(blob!), 'image/png');
                } else {
                    resolve(null as any); // Should not happen
                }
            } else {
                ctx.putImageData(imageData, 0, 0);
                canvas.toBlob((blob) => resolve(blob!), 'image/png');
            }
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };

        img.src = url;
    });
};
