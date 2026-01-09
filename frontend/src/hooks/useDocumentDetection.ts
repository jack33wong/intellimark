import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const loopRef = useRef<number>();
    const processingRef = useRef(false);

    // Smoothing History (Reduces jitter)
    const historyRef = useRef<NormalizedPoint[][]>([]);
    const HISTORY_LENGTH = 5;

    // Helper: Sort corners to [TL, TR, BR, BL]
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
            const poly = new cv.Mat();
            const hierarchy = new cv.Mat();

            const processFrame = () => {
                const video = videoRef.current;

                // 1. Safety Check: Wait for video data
                if (!video || video.readyState < 2 || video.videoWidth === 0) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }

                if (processingRef.current) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }
                processingRef.current = true;

                try {
                    // 2. Resolution: 350px (Balance of speed vs accuracy)
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

                        // 3. Pre-process (Gray -> Blur -> Canny)
                        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
                        cv.Canny(blur, edges, 50, 150);

                        // 4. Find Contours (External Only)
                        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                        let maxArea = 0;
                        let bestPts: { x: number, y: number }[] | null = null;
                        const minArea = (w * h) * 0.15; // Must fill 15% of view

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

                                // --- TRAPEZOID LOCK LOGIC ---

                                // Calculate dimensions
                                const topDy = Math.abs(pts[0].y - pts[1].y);
                                const topDx = Math.abs(pts[0].x - pts[1].x);
                                const botDy = Math.abs(pts[3].y - pts[2].y);
                                const botDx = Math.abs(pts[3].x - pts[2].x);

                                // Calculate Angles (Deviation from horizontal)
                                // If dy is small compared to dx, it's horizontal.
                                // We allow ~20% deviation (approx 11 degrees)
                                const isTopHorizontal = topDy < (topDx * 0.20);
                                const isBotHorizontal = botDy < (botDx * 0.20);

                                // Aspect Ratio Safety (Prevent wide strips)
                                const height = Math.abs(pts[0].y - pts[3].y);
                                const isTall = height > (topDx * 0.5);

                                if (isTopHorizontal && isBotHorizontal && isTall && area > maxArea) {
                                    maxArea = area;
                                    bestPts = pts;
                                }
                            }
                        }

                        // 5. Update State with Smoothing
                        if (bestPts) {
                            const norm = bestPts.map(p => ({ x: p.x / w, y: p.y / h }));

                            historyRef.current.push(norm);
                            if (historyRef.current.length > HISTORY_LENGTH) historyRef.current.shift();

                            // Calculate Average
                            const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                            historyRef.current.forEach(f => f.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y }));
                            const smoothed = avg.map(p => ({ x: p.x / historyRef.current.length, y: p.y / historyRef.current.length }));

                            setDetectedCorners(smoothed);
                        } else {
                            // Decay: If detection lost, show last valid frame for a split second, then hide
                            if (historyRef.current.length > 0) {
                                historyRef.current.shift();
                                if (historyRef.current.length > 0) {
                                    const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                                    historyRef.current.forEach(f => f.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y }));
                                    setDetectedCorners(avg.map(p => ({ x: p.x / historyRef.current.length, y: p.y / historyRef.current.length })));
                                } else {
                                    setDetectedCorners(null);
                                }
                            } else {
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
