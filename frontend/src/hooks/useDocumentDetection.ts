import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const [isSteady, setIsSteady] = useState(false);

    const [cvStatus, setCvStatus] = useState<string>("Init...");
    const [debugLog, setDebugLog] = useState<string>("Waiting...");
    const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const loopRef = useRef<number>();
    const processingRef = useRef(false);
    const historyRef = useRef<NormalizedPoint[][]>([]);

    const HISTORY_LENGTH = 5;

    // --- V15: RADIAL INFLATION FACTOR ---
    // 1.15 = Expand outwards by 15% from center.
    // This naturally covers margins regardless of perspective angle.
    const INFLATION_SCALE = 1.15;

    const isCvReady = () => window.cv && window.cv.Mat;

    useEffect(() => {
        if (!isActive) {
            setDebugLog("Paused");
            return;
        }

        const waitForCv = setInterval(() => {
            if (isCvReady()) {
                clearInterval(waitForCv);
                setCvStatus("Ready");
                startLoop();
            } else {
                setCvStatus("Loading OpenCV...");
            }
        }, 500);

        const startLoop = () => {
            const cv = window.cv;

            // Persistent Memory
            let src = new cv.Mat();
            let channels = new cv.MatVector();
            let blue = new cv.Mat();
            let blurred = new cv.Mat();
            let edges = new cv.Mat();
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            let poly = new cv.Mat();
            let hull = new cv.Mat();

            const processFrame = () => {
                const video = videoRef.current;
                if (!video || video.videoWidth === 0) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }

                if (processingRef.current) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }
                processingRef.current = true;

                try {
                    // Increase resolution slightly for better corner precision on angled shots
                    const w = 400;
                    const scale = w / video.videoWidth;
                    const h = Math.floor(video.videoHeight * scale);

                    // Debug Canvas
                    let debugCtx: CanvasRenderingContext2D | null = null;
                    if (debugCanvasRef.current) {
                        debugCanvasRef.current.width = w;
                        debugCanvasRef.current.height = h;
                        debugCtx = debugCanvasRef.current.getContext('2d');
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });

                    if (!ctx) throw new Error("No CTX");
                    ctx.drawImage(video, 0, 0, w, h);
                    const imgData = ctx.getImageData(0, 0, w, h);

                    if (src.cols !== w || src.rows !== h) {
                        src.delete(); src = new cv.Mat(h, w, cv.CV_8UC4);
                    }
                    src.data.set(imgData.data);

                    // Blue Channel Strategy
                    cv.split(src, channels);
                    const bChannel = channels.get(2);
                    bChannel.copyTo(blue);
                    bChannel.delete();

                    cv.GaussianBlur(blue, blurred, new cv.Size(5, 5), 0);
                    cv.Canny(blurred, edges, 30, 100);
                    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);

                    // Draw raw edges for debug
                    if (debugCtx) {
                        const imgDataEdges = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
                        for (let i = 0; i < w * h; i++) {
                            const val = edges.data[i];
                            imgDataEdges.data[i * 4] = val; imgDataEdges.data[i * 4 + 1] = val;
                            imgDataEdges.data[i * 4 + 2] = val; imgDataEdges.data[i * 4 + 3] = 255;
                        }
                        debugCtx.putImageData(imgDataEdges, 0, 0);
                    }

                    cv.findContours(edges, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

                    let bestCorners: NormalizedPoint[] | null = null;
                    let maxArea = 0;
                    const minArea = (w * h) * 0.10;
                    const candidates = [];

                    for (let i = 0; i < contours.size(); ++i) {
                        const cnt = contours.get(i);
                        const area = cv.contourArea(cnt);
                        if (area < minArea) continue;

                        cv.convexHull(cnt, hull);
                        const peri = cv.arcLength(hull, true);

                        let pointsFound = 0;
                        for (let eps = 0.02; eps < 0.10; eps += 0.02) {
                            cv.approxPolyDP(hull, poly, eps * peri, true);
                            if (poly.rows === 4) { pointsFound = 4; break; }
                        }

                        if (pointsFound === 4) {
                            const pts = [];
                            // Removed border check - we need to catch edges even if they touch screen bounds
                            for (let j = 0; j < 4; j++) {
                                pts.push({ x: poly.data32S[j * 2], y: poly.data32S[j * 2 + 1] });
                            }
                            candidates.push({ area: area, pts: pts });
                        }
                    }

                    candidates.sort((a, b) => b.area - a.area);

                    if (candidates.length > 0) {
                        const winner = candidates[0];
                        maxArea = winner.area;
                        const sorted = sortPointsClockwise(winner.pts);

                        // Draw Raw Red Box
                        if (debugCtx) {
                            debugCtx.beginPath(); debugCtx.strokeStyle = 'red'; debugCtx.lineWidth = 2;
                            debugCtx.moveTo(sorted[0].x, sorted[0].y);
                            sorted.forEach(p => debugCtx!.lineTo(p.x, p.y));
                            debugCtx.closePath(); debugCtx.stroke();
                        }

                        // --- V15: RADIAL "CENTER-OUT" INFLATION ---

                        // 1. Find geometric center
                        const cx = (sorted[0].x + sorted[1].x + sorted[2].x + sorted[3].x) / 4;
                        const cy = (sorted[0].y + sorted[1].y + sorted[2].y + sorted[3].y) / 4;

                        // 2. Expand every point outwards from center by scale factor
                        const inflated = sorted.map((p) => {
                            // Vector from center to point
                            const dx = p.x - cx;
                            const dy = p.y - cy;

                            // Scale vector and add back to center
                            return {
                                x: cx + (dx * INFLATION_SCALE),
                                y: cy + (dy * INFLATION_SCALE)
                            };
                        });

                        // 3. Safe Clamping (keep 1px buffer)
                        const clamped = inflated.map(p => ({
                            x: Math.max(1, Math.min(w - 1, p.x)),
                            y: Math.max(1, Math.min(h - 1, p.y))
                        }));

                        // Draw Final Green Box
                        if (debugCtx) {
                            debugCtx.beginPath(); debugCtx.strokeStyle = '#00ff00'; debugCtx.lineWidth = 3;
                            debugCtx.moveTo(clamped[0].x, clamped[0].y);
                            clamped.forEach(p => debugCtx!.lineTo(p.x, p.y));
                            debugCtx.closePath(); debugCtx.stroke();
                        }

                        bestCorners = clamped.map(p => ({ x: p.x / w, y: p.y / h }));
                        setDebugLog(`LOCKED: Area ${Math.round(maxArea)}`);

                    } else {
                        setDebugLog("Searching...");
                    }

                    // State Updates & Smoothing
                    if (bestCorners) {
                        historyRef.current.push(bestCorners);
                        if (historyRef.current.length > HISTORY_LENGTH) historyRef.current.shift();
                        const avg = calculateAverage(historyRef.current);
                        setDetectedCorners(avg);
                        setIsSteady(calculateSteadiness(bestCorners, avg) < 0.04);
                    } else {
                        if (historyRef.current.length > 0) {
                            historyRef.current.shift();
                            setDetectedCorners(historyRef.current.length ? calculateAverage(historyRef.current) : null);
                        } else {
                            setDetectedCorners(null);
                            setIsSteady(false);
                        }
                    }

                } catch (e: any) {
                    setDebugLog(`ERR: ${e.message}`);
                } finally {
                    processingRef.current = false;
                    loopRef.current = requestAnimationFrame(processFrame);
                }
            };

            loopRef.current = requestAnimationFrame(processFrame);

            // Cleanup
            return () => {
                cancelAnimationFrame(loopRef.current!);
                try {
                    if (src) src.delete(); if (channels) channels.delete();
                    if (blue) blue.delete(); if (blurred) blurred.delete();
                    if (edges) edges.delete(); if (kernel) kernel.delete();
                    if (contours) contours.delete(); if (hierarchy) hierarchy.delete();
                    if (poly) poly.delete(); if (hull) hull.delete();
                } catch (e) { }
            };
        };
    }, [isActive, videoRef]);

    return { detectedCorners, isSteady, isCvReady, cvStatus, debugLog, debugCanvasRef };
};

// --- Helpers remain the same ---
function sortPointsClockwise(pts: { x: number, y: number }[]) {
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let tlIdx = 0, minDist = Infinity;
    for (let i = 0; i < 4; i++) {
        const d = pts[i].x * pts[i].x + pts[i].y * pts[i].y;
        if (d < minDist) { minDist = d; tlIdx = i; }
    }
    return [...pts.slice(tlIdx), ...pts.slice(0, tlIdx)];
}

function calculateAverage(history: NormalizedPoint[][]): NormalizedPoint[] {
    if (history.length === 0) return [];
    const sums = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    history.forEach(frame => {
        frame.forEach((p, i) => { sums[i].x += p.x; sums[i].y += p.y; });
    });
    return sums.map(s => ({ x: s.x / history.length, y: s.y / history.length }));
}

function calculateSteadiness(curr: NormalizedPoint[], avg: NormalizedPoint[]): number {
    let maxDev = 0;
    for (let i = 0; i < 4; i++) {
        maxDev = Math.max(maxDev, Math.abs(curr[i].x - avg[i].x) + Math.abs(curr[i].y - avg[i].y));
    }
    return maxDev;
}
