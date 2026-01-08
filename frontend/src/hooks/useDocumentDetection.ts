import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const [isSteady, setIsSteady] = useState(false);

    // Debug
    const [cvStatus, setCvStatus] = useState<string>("Init...");
    const [debugLog, setDebugLog] = useState<string>("Waiting...");
    const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const loopRef = useRef<number>();
    const processingRef = useRef(false);
    const historyRef = useRef<NormalizedPoint[][]>([]);

    const HISTORY_LENGTH = 5;

    // --- V7.1: TUNED ASYMMETRIC INFLATION ---
    // Reduced factors to prevent grabbing table wood grain
    const PAD_TOP = 0.12;    // 12% Up (Header)
    const PAD_BOTTOM = 0.22; // 22% Down (Barcode Sweet Spot)
    const PAD_SIDE = 0.08;   // 8% Sides

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

            // Allocate Memory Once
            let src: any, channels: any, blue: any, blurred: any, edges: any, kernel: any;
            let contours: any, hierarchy: any, poly: any, hull: any;

            try {
                src = new cv.Mat();
                channels = new cv.MatVector();
                blue = new cv.Mat();
                blurred = new cv.Mat();
                edges = new cv.Mat();
                kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
                contours = new cv.MatVector();
                hierarchy = new cv.Mat();
                poly = new cv.Mat();
                hull = new cv.Mat();
            } catch (err) {
                setDebugLog(`Alloc Err: ${err}`);
                return;
            }

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
                    const w = 350;
                    const scale = w / video.videoWidth;
                    const h = Math.floor(video.videoHeight * scale);

                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });

                    if (!ctx) throw new Error("No CTX");
                    ctx.drawImage(video, 0, 0, w, h);
                    const imgData = ctx.getImageData(0, 0, w, h);

                    // Manual Data Load (Crash Proof)
                    if (src.cols !== w || src.rows !== h) {
                        try { src.delete(); } catch (e) { }
                        src = new cv.Mat(h, w, cv.CV_8UC4);
                    }
                    src.data.set(imgData.data);

                    // Blue Channel
                    cv.split(src, channels);
                    const bChannel = channels.get(2);
                    bChannel.copyTo(blue);
                    bChannel.delete();

                    // Pre-processing
                    cv.GaussianBlur(blue, blurred, new cv.Size(5, 5), 0);
                    cv.Canny(blurred, edges, 30, 100);
                    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);

                    if (debugCanvasRef.current) {
                        try { cv.imshow(debugCanvasRef.current, edges); } catch (e) { }
                    }

                    // Find Contours
                    cv.findContours(edges, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

                    let bestCorners: NormalizedPoint[] | null = null;
                    let maxArea = 0;
                    const minArea = (w * h) * 0.15;
                    const candidates = [];

                    for (let i = 0; i < contours.size(); ++i) {
                        const cnt = contours.get(i);
                        const area = cv.contourArea(cnt);

                        if (area < minArea) continue;

                        cv.convexHull(cnt, hull);
                        const peri = cv.arcLength(hull, true);

                        // Smart Epsilon
                        let pointsFound = 0;
                        for (let eps = 0.02; eps < 0.10; eps += 0.02) {
                            cv.approxPolyDP(hull, poly, eps * peri, true);
                            if (poly.rows === 4) {
                                pointsFound = 4;
                                break;
                            }
                        }

                        if (pointsFound === 4) {
                            const pts = [];
                            let touchesBorder = false;
                            const buffer = 2;
                            for (let j = 0; j < 4; j++) {
                                const px = poly.data32S[j * 2];
                                const py = poly.data32S[j * 2 + 1];
                                if (px < buffer || px > w - buffer || py < buffer || py > h - buffer) touchesBorder = true;
                                pts.push({ x: px, y: py });
                            }
                            if (!touchesBorder) candidates.push({ area: area, pts: pts });
                        }
                    }

                    // Pick Best
                    candidates.sort((a, b) => b.area - a.area);

                    if (candidates.length > 0) {
                        const winner = candidates[0];
                        maxArea = winner.area;
                        const sorted = sortPointsClockwise(winner.pts);

                        // --- V7.1: ASYMMETRIC INFLATION LOGIC ---
                        const widthX = Math.hypot(sorted[0].x - sorted[1].x, sorted[0].y - sorted[1].y);
                        const heightY = Math.hypot(sorted[0].x - sorted[3].x, sorted[0].y - sorted[3].y);

                        const shiftX = widthX * PAD_SIDE;
                        const shiftTop = heightY * PAD_TOP;
                        const shiftBot = heightY * PAD_BOTTOM;

                        // Center point
                        const cx = (sorted[0].x + sorted[1].x + sorted[2].x + sorted[3].x) / 4;
                        const cy = (sorted[0].y + sorted[1].y + sorted[2].y + sorted[3].y) / 4;

                        const inflated = sorted.map((p) => {
                            let dx = p.x - cx;
                            let dy = p.y - cy;

                            // Horizontal Stretch
                            const nx = p.x + (dx > 0 ? shiftX : -shiftX);

                            // Vertical Stretch (Asymmetric)
                            let ny = p.y;
                            if (dy < 0) ny -= shiftTop; // Move Top Up
                            else ny += shiftBot;        // Move Bottom Down

                            return { x: nx, y: ny };
                        });

                        // Clamp
                        const clamped = inflated.map(p => ({
                            x: Math.max(0, Math.min(w, p.x)),
                            y: Math.max(0, Math.min(h, p.y))
                        }));

                        bestCorners = clamped.map(p => ({ x: p.x / w, y: p.y / h }));
                    }

                    // Update State
                    if (bestCorners) {
                        historyRef.current.push(bestCorners);
                        if (historyRef.current.length > HISTORY_LENGTH) historyRef.current.shift();
                        const avg = calculateAverage(historyRef.current);
                        setDetectedCorners(avg);
                        setIsSteady(calculateSteadiness(bestCorners, avg) < 0.04);
                        setDebugLog(`LOCKED: Area ${Math.round(maxArea)}`);
                    } else {
                        if (historyRef.current.length > 0) {
                            historyRef.current.shift();
                            setDetectedCorners(historyRef.current.length ? calculateAverage(historyRef.current) : null);
                        } else {
                            setDetectedCorners(null);
                            setIsSteady(false);
                            setDebugLog("Searching...");
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
        };

        return () => {
            clearInterval(waitForCv);
            if (loopRef.current) cancelAnimationFrame(loopRef.current);
        };
    }, [isActive, videoRef]);

    return {
        detectedCorners,
        isSteady,
        cvStatus,
        debugLog,
        debugCanvasRef,
        isCvReady: isCvReady()
    };
};

// --- HELPERS ---
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
