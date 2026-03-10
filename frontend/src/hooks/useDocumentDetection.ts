import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

// GLOBAL PERSISTENCE — reset to null intentionally on each camera start
let GLOBAL_LAST_CORNERS: NormalizedPoint[] | null = null;

// Helper: compute the area of a normalized quadrilateral (0..1 coords)
function quadArea(pts: NormalizedPoint[]): number {
    // Shoelace formula
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        area += pts[i].x * pts[j].y;
        area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
}

// Helper: max corner displacement between two quads (normalized 0..1)
function maxDisplacement(a: NormalizedPoint[], b: NormalizedPoint[]): number {
    return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
}

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);

    const anchorCornersRef = useRef<NormalizedPoint[] | null>(null);
    const anchorAreaRef = useRef<number>(0);
    const missedFramesRef = useRef<number>(0); // consecutive frames with no detection

    const loopRef = useRef<number>();
    const stoppedRef = useRef(false);

    const sortCorners = (pts: { x: number, y: number }[]) => {
        const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
        const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
        const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
        let tlIdx = 0, minSum = Infinity;
        for (let i = 0; i < 4; i++) {
            if ((sorted[i].x + sorted[i].y) < minSum) { minSum = sorted[i].x + sorted[i].y; tlIdx = i; }
        }
        return [...sorted.slice(tlIdx), ...sorted.slice(0, tlIdx)];
    };

    useEffect(() => {
        if (!isActive) {
            // FIX #1+#3: Stop any running loop and reset stale global corners on camera stop
            stoppedRef.current = true;
            if (loopRef.current) cancelAnimationFrame(loopRef.current);
            GLOBAL_LAST_CORNERS = null;
            anchorCornersRef.current = null;
            anchorAreaRef.current = 0;
            missedFramesRef.current = 0;
            setDetectedCorners(null);
            return;
        }

        // FIX #1: Properly stop any previous loop before starting a new one
        stoppedRef.current = true;
        if (loopRef.current) cancelAnimationFrame(loopRef.current);

        // Small delay so previous loop frame completes if mid-execution
        const startTimeout = setTimeout(() => {
            stoppedRef.current = false;

            const startLoop = () => {
                if (!window.cv || !window.cv.Mat) return;

                const cv = window.cv;
                const src = new cv.Mat();
                const gray = new cv.Mat();
                const blur = new cv.Mat();
                const edges = new cv.Mat();
                const contours = new cv.MatVector();
                const poly = new cv.Mat();

                const processFrame = () => {
                    if (stoppedRef.current) {
                        // Proper cleanup of OpenCV Mats on stop
                        try { src.delete(); gray.delete(); blur.delete(); edges.delete(); contours.delete(); poly.delete(); } catch (_) { }
                        return;
                    }
                    const video = videoRef.current;
                    if (!video || video.readyState < 2) {
                        loopRef.current = requestAnimationFrame(processFrame);
                        return;
                    }

                    try {
                        const w = 350;
                        const vW = video.videoWidth || 1;
                        const vH = video.videoHeight || 1;
                        const scale = w / vW;
                        const h = Math.floor(vH * scale);

                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        const ctx = canvas.getContext('2d', { willReadFrequently: true });

                        if (ctx) {
                            ctx.drawImage(video, 0, 0, w, h);
                            const imgData = ctx.getImageData(0, 0, w, h);

                            if (src.cols !== w || src.rows !== h) src.create(h, w, cv.CV_8UC4);
                            src.data.set(imgData.data);

                            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                            cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
                            cv.Canny(blur, edges, 30, 100);
                            cv.findContours(edges, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                            let maxArea = 0;
                            let rawCandidate: { x: number, y: number }[] | null = null;
                            const minArea = (w * h) * 0.05; // Option C: lowered 10%→5% to track smaller/farther docs

                            for (let i = 0; i < contours.size(); ++i) {
                                const cnt = contours.get(i);
                                try {
                                    const area = cv.contourArea(cnt);
                                    if (area < minArea) continue;
                                    const peri = cv.arcLength(cnt, true);
                                    cv.approxPolyDP(cnt, poly, 0.02 * peri, true);
                                    if (poly.rows === 4) {
                                        const rawPts = [];
                                        for (let j = 0; j < 4; j++) rawPts.push({ x: poly.data32S[j * 2], y: poly.data32S[j * 2 + 1] });
                                        const pts = sortCorners(rawPts);
                                        const topDx = Math.abs(pts[0].x - pts[1].x);
                                        const height = Math.abs(pts[0].y - pts[3].y);
                                        if (height > (topDx * 0.4) && area > maxArea) {
                                            maxArea = area;
                                            rawCandidate = pts;
                                        }
                                    }
                                } finally { cnt.delete(); }
                            }

                            if (rawCandidate) {
                                missedFramesRef.current = 0;
                                const newNorm = rawCandidate.map(p => ({ x: p.x / w, y: p.y / h }));
                                const newArea = quadArea(newNorm);

                                const currentAnchor = anchorCornersRef.current;

                                // Always accept valid detections — stability is handled by EMA smoothing.
                                // isBetter gate removed: it only allowed growing, never shrinking,
                                // causing the box to freeze when the document moved farther away.
                                const cornerDisp = currentAnchor
                                    ? maxDisplacement(newNorm, currentAnchor)
                                    : Infinity;
                                const isRepositioned = cornerDisp > 0.15; // >15% = real move

                                // EMA speed: fast follow for big moves, slow smooth for minor jitter
                                const smoothFactor = currentAnchor
                                    ? (isRepositioned ? 0.3 : 0.6) // 0.3=fast, 0.6=slow
                                    : 0; // no anchor yet → snap immediately

                                const smoothed = currentAnchor
                                    ? newNorm.map((p, i) => ({
                                        x: currentAnchor[i].x * smoothFactor + p.x * (1 - smoothFactor),
                                        y: currentAnchor[i].y * smoothFactor + p.y * (1 - smoothFactor)
                                    }))
                                    : newNorm;

                                anchorCornersRef.current = smoothed;
                                anchorAreaRef.current = newArea;
                                GLOBAL_LAST_CORNERS = smoothed;

                                // Skip re-render if jitter is negligible (<0.5% of frame)
                                const prevCorners = detectedCornersRef.current;
                                const displacement = prevCorners ? maxDisplacement(prevCorners, smoothed) : Infinity;
                                if (displacement > 0.005) {
                                    detectedCornersRef.current = smoothed;
                                    setDetectedCorners(smoothed);
                                }

                            } else {
                                // No document detected this frame
                                missedFramesRef.current++;
                                // Option C: after ~45 missed frames (≈0.75s), clear the box
                                // This signals the user to bring the document closer rather than
                                // showing a stale frozen rectangle.
                                if (missedFramesRef.current > 45) {
                                    anchorCornersRef.current = null;
                                    anchorAreaRef.current = 0;
                                    GLOBAL_LAST_CORNERS = null;
                                    detectedCornersRef.current = null;
                                    setDetectedCorners(null);
                                }
                            }
                        }
                    } catch (e: any) {
                        console.error('[Detection]', e);
                    }

                    if (!stoppedRef.current) loopRef.current = requestAnimationFrame(processFrame);
                };

                loopRef.current = requestAnimationFrame(processFrame);
            };

            const checkCv = setInterval(() => {
                if (window.cv && window.cv.Mat) { clearInterval(checkCv); startLoop(); }
            }, 100);

            // Store interval so we can clear it if isActive changes quickly
            return () => clearInterval(checkCv);
        }, 50); // 50ms grace period to ensure old frame completes

        return () => {
            clearTimeout(startTimeout);
            stoppedRef.current = true;
            if (loopRef.current) cancelAnimationFrame(loopRef.current);
        };
    }, [isActive]); // FIX #2: removed videoRef from deps (stable ref, no need to restart)

    // Ref to track current corners for displacement check without stale closure
    const detectedCornersRef = useRef<NormalizedPoint[] | null>(null);

    return { detectedCorners };
};
