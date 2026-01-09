import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const loopRef = useRef<number>();
    const processingRef = useRef(false);

    // Smoothing Buffer (Prevents flickering)
    const historyRef = useRef<NormalizedPoint[][]>([]);

    const sortCorners = (pts: { x: number, y: number }[]) => {
        const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
        const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
        const sorted = [...pts].sort((a, b) =>
            Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
        );
        let tlIdx = 0, minSum = Infinity;
        for (let i = 0; i < 4; i++) {
            if ((sorted[i].x + sorted[i].y) < minSum) { minSum = sorted[i].x + sorted[i].y; tlIdx = i; }
        }
        return [...sorted.slice(tlIdx), ...sorted.slice(0, tlIdx)];
    };

    useEffect(() => {
        if (!isActive) return;

        const startLoop = () => {
            const cv = window.cv;
            const src = new cv.Mat();
            const gray = new cv.Mat();
            const blur = new cv.Mat();
            const edges = new cv.Mat();
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            const poly = new cv.Mat();

            const processFrame = () => {
                const video = videoRef.current;

                // CRITICAL FIX: Strict check for 'HAVE_ENOUGH_DATA' (4)
                if (!video || video.readyState !== 4 || video.videoWidth === 0) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }

                if (processingRef.current) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }
                processingRef.current = true;

                try {
                    // 1. Capture (Resolution 350px)
                    const w = 350;
                    const scale = w / video.videoWidth;
                    const h = Math.floor(video.videoHeight * scale);

                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });

                    if (ctx) {
                        ctx.drawImage(video, 0, 0, w, h);
                        const imgData = ctx.getImageData(0, 0, w, h);

                        if (src.cols !== w || src.rows !== h) {
                            src.delete(); src.create(h, w, cv.CV_8UC4);
                        }
                        src.data.set(imgData.data);

                        // 2. Process
                        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
                        cv.Canny(blur, edges, 30, 100); // Standard Thresholds

                        // 3. Find Contours
                        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                        let maxArea = 0;
                        let bestPts: { x: number, y: number }[] | null = null;
                        const minArea = (w * h) * 0.15;

                        for (let i = 0; i < contours.size(); ++i) {
                            const cnt = contours.get(i);
                            const area = cv.contourArea(cnt);
                            if (area < minArea) continue;

                            const peri = cv.arcLength(cnt, true);
                            cv.approxPolyDP(cnt, poly, 0.02 * peri, true);

                            if (poly.rows === 4) {
                                const rawPts = [];
                                for (let j = 0; j < 4; j++) {
                                    rawPts.push({ x: poly.data32S[j * 2], y: poly.data32S[j * 2 + 1] });
                                }
                                const pts = sortCorners(rawPts);

                                // --- TRAPEZOID LOCK DESIGN ---
                                // Requirement: Top/Bottom must be parallel (Horizontal). Sides can be angled.

                                const topDy = Math.abs(pts[0].y - pts[1].y);
                                const topDx = Math.abs(pts[0].x - pts[1].x);
                                const botDy = Math.abs(pts[3].y - pts[2].y);
                                const botDx = Math.abs(pts[3].x - pts[2].x);

                                // Allow max 20 degrees tilt (~0.36 slope)
                                const isTopHorizontal = topDy < (topDx * 0.36);
                                const isBotHorizontal = botDy < (botDx * 0.36);

                                // Must be generally upright (Height > Width/2)
                                const height = Math.abs(pts[0].y - pts[3].y);
                                const isTall = height > (topDx * 0.5);

                                if (isTopHorizontal && isBotHorizontal && isTall && area > maxArea) {
                                    maxArea = area;
                                    bestPts = pts;
                                }
                            }
                        }

                        // 4. Update State
                        if (bestPts) {
                            const norm = bestPts.map(p => ({ x: p.x / w, y: p.y / h }));

                            historyRef.current.push(norm);
                            if (historyRef.current.length > 5) historyRef.current.shift();

                            // Average for smoothness
                            const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                            historyRef.current.forEach(f => f.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y }));
                            const smoothed = avg.map(p => ({ x: p.x / historyRef.current.length, y: p.y / historyRef.current.length }));

                            setDetectedCorners(smoothed);
                        } else {
                            // Instant Decay (No lingering boxes)
                            if (historyRef.current.length > 0) {
                                historyRef.current.shift();
                                setDetectedCorners(null);
                            }
                        }
                    }
                } catch (e) { console.error(e); }
                finally {
                    processingRef.current = false;
                    loopRef.current = requestAnimationFrame(processFrame);
                }
            };

            loopRef.current = requestAnimationFrame(processFrame);
        };

        const checkCv = setInterval(() => {
            if (window.cv && window.cv.Mat) { clearInterval(checkCv); startLoop(); }
        }, 100);

        return () => { clearInterval(checkCv); if (loopRef.current) cancelAnimationFrame(loopRef.current); };
    }, [isActive, videoRef]);

    return { detectedCorners };
};
