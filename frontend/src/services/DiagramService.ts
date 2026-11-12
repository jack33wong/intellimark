/**
 * DiagramService - JSON-to-SVG Renderer
 * Reads AI-generated JSON and draws deterministic, mathematically perfect SVGs.
 */

export class DiagramService {
    private static renderedGlobalLabels = new Set<string>();
    private static lastLoggedQ5 = "";

    public static process(content: string): string {
        if (!content || typeof content !== 'string') return content;

        // Version 9.81 (Clean)

        // Reset global state for this message
        const renderedKeywords = new Set<string>();
        this.renderedGlobalLabels.clear();

        // Pass 1: Identify and Deduplicate (v9.17)
        // Find all JSON blocks first
        const jsonRegex = /(?:<|&lt;)script\s+type=(?:"|&quot;)application\/json(?:"|&quot;)\s+class=(?:"|&quot;)ai-diagram-data(?:"|&quot;)(?:>|&gt;)([\s\S]*?)(?:<|&lt;)\/script(?:>|&gt;)/gi;

        const diagramMap = new Map<string, { json: string, data: any, match: string }>();
        const matches = Array.from(content.matchAll(jsonRegex));

        matches.forEach(m => {
            try {
                const unescaped = m[1]
                    .replace(/&quot;/g, '"')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/\$/g, '') // [RESILIENCE] Strip AI-added LaTeX delimiters from JSON
                    .trim();
                const data = JSON.parse(unescaped);
                const label = data.equation_label || data.description || '';
                const key = `${data.sub_id || 'diag'}_${label}_${unescaped.length}`;

                const existing = diagramMap.get(key);

                // [Simple & Robust v9.18] Deduplication Rule:
                // 1. If no existing, set current.
                // 2. If current is "solution", it ALWAYS overrides "reference".
                // 3. Otherwise, keep the most complex one.
                let shouldReplace = !existing;
                if (existing) {
                    const existingIsSolution = existing.data.purpose === 'solution';
                    const currentIsSolution = data.purpose === 'solution';

                    if (currentIsSolution && !existingIsSolution) {
                        shouldReplace = true;
                    } else if (currentIsSolution === existingIsSolution) {
                        const currentComplexity = (data.layers?.length || 0) + (data.shapes?.length || 0) + (data.branches?.length || 0);
                        const existingComplexity = (existing.data.layers?.length || 0) + (existing.data.shapes?.length || 0) + (existing.data.branches?.length || 0);
                        if (currentComplexity >= existingComplexity) {
                            shouldReplace = true;
                        }
                    }
                }

                if (shouldReplace) {
                    diagramMap.set(key, { json: unescaped, data, match: m[0] });
                }
            } catch (e) {
                // Silent fail for malformed JSON in pre-pass
            }
        });

        // [v9.96] Fallback Suppression Pass
        // If the AI double-emits a `fallback` AND a real diagram for the same sub_id,
        // the real diagram wins and the fallback is silently dropped.
        const subIdWithRealDiagram = new Set<string>();
        diagramMap.forEach(({ data }) => {
            if (data.sub_id && data.type !== 'fallback') {
                subIdWithRealDiagram.add(String(data.sub_id).toLowerCase());
            }
        });
        diagramMap.forEach((value, key) => {
            if (value.data.type === 'fallback' && value.data.sub_id &&
                subIdWithRealDiagram.has(String(value.data.sub_id).toLowerCase())) {
                diagramMap.delete(key);
            }
        });

        // Pass 2: Replace matches
        let processedContent = content;

        // Context-aware enhancements (e.g. for Q11 Rotation Symmetry)
        const isSymmetryContext = content.toLowerCase().includes('rotational symmetry') || content.toLowerCase().includes('centre of rotation');

        // We replace each original match. 
        // If it's the "winning" version in our map, render it. If not, hide it.
        matches.forEach(m => {
            const unescaped = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
            let replacement = "";

            try {
                const data = JSON.parse(unescaped);

                // Inject specific improvements for symmetry questions
                if (isSymmetryContext && data.type === 'coordinate_grid') {
                    data.show_axes = false;
                    data.label_origin = 'A';
                    data._isSymmetry = true; // Reliable flag for bounds override
                }

                const label = data.equation_label || data.description || '';
                const key = `${data.sub_id || 'diag'}_${label}_${unescaped.length}`;
                const winner = diagramMap.get(key);

                if (winner && winner.json === unescaped) {
                    // This is the chosen version to render
                    if (data.sub_id) renderedKeywords.add(String(data.sub_id).toLowerCase());
                    if (data.type) renderedKeywords.add(String(data.type).toLowerCase());
                    if (data.shape_name) renderedKeywords.add(String(data.shape_name).toLowerCase());
                    if (data.description) renderedKeywords.add(String(data.description).toLowerCase());
                    if (data.details) renderedKeywords.add(String(data.details).toLowerCase());

                    const normalizedType = String(data.type || '').trim().toLowerCase();
                    switch (normalizedType) {
                        case 'triangle':
                        case 'triangle_sas':
                            replacement = this.drawTriangle(data);
                            if (replacement.includes("Not to scale") || replacement.includes("Not drawn accurately")) {
                                renderedKeywords.add("not to scale");
                                renderedKeywords.add("not drawn accurately");
                            }
                            break;
                        case 'polygon':
                            replacement = this.drawPolygon(data);
                            // [v9.67] More aggressive keyword population for better suppression
                            renderedKeywords.add("rectangle");
                            renderedKeywords.add("quadrilateral");
                            renderedKeywords.add("pentagon");
                            renderedKeywords.add("hexagon");
                            if (replacement.includes("Not drawn accurately")) {
                                renderedKeywords.add("not to scale");
                                renderedKeywords.add("not drawn accurately");
                            }
                            break;
                        case 'function_graph':
                            replacement = this.drawFunctionGraph(data); break;
                        case 'coordinate_grid': {
                            const idx = m.index || 0;
                            const matchEnd = idx + m[0].length;
                            const beforeRaw = content.substring(Math.max(0, idx - 800), idx);
                            const lastSubQ = Math.max(
                                beforeRaw.lastIndexOf('class="model_question"'),
                                beforeRaw.lastIndexOf("class='model_question'"),
                                beforeRaw.lastIndexOf('model-question-number'),
                                beforeRaw.lastIndexOf('question-group-container')
                            );
                            const qText = (lastSubQ >= 0 ? beforeRaw.substring(lastSubQ) : beforeRaw).toLowerCase();
                            const afterRaw = content.substring(matchEnd, Math.min(content.length, matchEnd + 600));
                            const nextSubQCandidates = [
                                afterRaw.indexOf('class="model_question"'),
                                afterRaw.indexOf("class='model_question'"),
                                afterRaw.indexOf('model-question-number')
                            ].filter(pos => pos >= 0);
                            const nextSubQ = nextSubQCandidates.length > 0 ? Math.min(...nextSubQCandidates) : -1;
                            const localAfterText = (nextSubQ >= 0 ? afterRaw.substring(0, nextSubQ) : afterRaw).toLowerCase();
                            const rawHintText = String(data._rawHint || data.description || '');
                            const qContext = `${qText} ${rawHintText.toLowerCase()} ${localAfterText}`;
                            data._rawHint = rawHintText;
                            data._qContext = qContext;
                            // Preserve case-sensitive context including afterRaw so sentences below the diagram are captured
                            data._rawCaseContext = `${beforeRaw.substring(lastSubQ >= 0 ? lastSubQ : 0)} ${rawHintText} ${afterRaw}`;

                            // [CRITICAL] Resolve and rectify vertex map after context strings are attached
                            this.resolveVertexMap(data);

                            // If AI omitted layers or failed to extract shapes from _rawHint when _rawHint explicitly lists shape vertices,
                            // deterministically parse the shapes and grid bounds from _rawHint!
                            if ((!Array.isArray(data.layers) || data.layers.length === 0) && rawHintText) {
                                const recovered = this.recoverCoordinateGridFromHint(rawHintText);
                                if (recovered) {
                                    Object.assign(data, recovered);
                                }
                            }

                            const isEnlargeOrReflect = qText.includes('enlarge shape') || qText.includes('reflect shape') ||
                                (qText.includes('enlarge') && qText.includes('scale factor'));

                            // Auto-Detect Compass Circle Constructions (e.g. Question 11) - strictly scoped to qContext!
                            const isCompassCircle = qContext.includes('pair of compasses') || qContext.includes('diameter of a circle');
                            if (isCompassCircle) {
                                data.show_axes = false;
                                data.hide_grid = true;
                                if (!data.layers) data.layers = [];
                                const hasCircle = data.layers.some((l: any) => l.shape_name === 'circle' || l.type === 'circle');
                                if (!hasCircle) {
                                    const diameterLayer = data.layers.find((l: any) =>
                                        (l.shape_name === 'line' || l.type === 'line' || l.shape_name === 'polyline') &&
                                        (l.points || l.vertices)?.length === 2
                                    );
                                    let center = [0, 0];
                                    let radius = 3;
                                    if (diameterLayer) {
                                        diameterLayer.purpose = 'reference';
                                        const pts = diameterLayer.points || diameterLayer.vertices;
                                        const p1 = [parseFloat(pts[0][0]), parseFloat(pts[0][1])];
                                        const p2 = [parseFloat(pts[1][0]), parseFloat(pts[1][1])];
                                        center = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
                                        radius = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2;
                                    }
                                    data.layers.push({ shape_name: 'circle', center, radius: radius || 3, purpose: 'solution' });
                                }
                            } else if (qContext.includes('cuboid') && qContext.includes('net')) {
                                // Always show 1cm grid without axes and render all 6 faces of the cuboid net
                                data.show_axes = false;
                                data.hide_grid = false;
                                const polyLayers = (data.layers || []).filter((l: any) => l.shape_name === 'polygon' || l.type === 'polygon');
                                if (polyLayers.length < 6) {
                                    const dimMatches = Array.from(qContext.matchAll(/(\d+(?:\.\d+)?)\s*cm/gi)).map(dm => parseFloat(dm[1])).filter(n => n > 0 && n <= 10);
                                    const sortedDims = dimMatches.length >= 3 ? dimMatches.slice(0, 3).sort((a, b) => b - a) : [5, 3, 2];
                                    const [L, W, D] = sortedDims;
                                    const x1 = D + 1;
                                    const y1 = D + 1;
                                    const x2 = x1 + L;
                                    const y2 = y1 + W;
                                    data.x_min = 0;
                                    data.x_max = L + 2 * D + 2;
                                    data.y_min = 0;
                                    data.y_max = 2 * W + 2 * D + 2;
                                    data.layers = [
                                        { shape_name: 'polygon', purpose: 'reference', label: `${L}×${W}`, points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] },
                                        { shape_name: 'polygon', purpose: 'solution', label: `${D}×${W}`, points: [[x1 - D, y1], [x1, y1], [x1, y2], [x1 - D, y2]] },
                                        { shape_name: 'polygon', purpose: 'solution', label: `${D}×${W}`, points: [[x2, y1], [x2 + D, y1], [x2 + D, y2], [x2, y2]] },
                                        { shape_name: 'polygon', purpose: 'solution', label: `${L}×${D}`, points: [[x1, y1 - D], [x2, y1 - D], [x2, y1], [x1, y1]] },
                                        { shape_name: 'polygon', purpose: 'solution', label: `${L}×${D}`, points: [[x1, y2], [x2, y2], [x2, y2 + D], [x1, y2 + D]] },
                                        { shape_name: 'polygon', purpose: 'solution', label: `${L}×${W}`, points: [[x1, y2 + D], [x2, y2 + D], [x2, y2 + D + W], [x1, y2 + D + W]] }
                                    ];
                                }
                            } else if (qContext.includes('complete the kite') || (qContext.includes('kite') && qContext.includes('grid'))) {
                                // Show the square grid without axis numbers and auto-complete the reflected kite sides
                                data.show_axes = false;
                                data.hide_grid = false;
                                if (!Array.isArray(data.layers)) data.layers = [];

                                // Collect unique vertices across layers
                                const allVertices: [number, number][] = [];
                                data.layers.forEach((l: any) => {
                                    const pts = l.points || l.vertices;
                                    if (Array.isArray(pts) && pts.length >= 2) {
                                        pts.forEach((pt: any) => {
                                            const px = parseFloat(Array.isArray(pt) ? pt[0] : pt.x);
                                            const py = parseFloat(Array.isArray(pt) ? pt[1] : pt.y);
                                            if (Number.isFinite(px) && Number.isFinite(py)) {
                                                if (!allVertices.some(([ex, ey]) => Math.abs(ex - px) < 1e-3 && Math.abs(ey - py) < 1e-3)) {
                                                    allVertices.push([px, py]);
                                                }
                                            }
                                        });
                                    }
                                });

                                if (allVertices.length === 3) {
                                    data.layers.forEach((l: any) => { l.purpose = 'reference'; });
                                    const [pA, pB, pC] = allVertices;
                                    const ux = pC[0] - pA[0];
                                    const uy = pC[1] - pA[1];
                                    const lenSq = ux * ux + uy * uy;
                                    if (lenSq > 0) {
                                        const vx = pB[0] - pA[0];
                                        const vy = pB[1] - pA[1];
                                        const t = (vx * ux + vy * uy) / lenSq;
                                        const dx = +(pA[0] + 2 * t * ux - vx).toFixed(2);
                                        const dy = +(pA[1] + 2 * t * uy - vy).toFixed(2);
                                        data.layers.push({
                                            shape_name: 'polyline',
                                            purpose: 'solution',
                                            is_open: true,
                                            points: [pA, [dx, dy], pC]
                                        });
                                    }
                                } else if (allVertices.length >= 4) {
                                    // Convert into clean top reference polyline + bottom solution polyline
                                    const sortedByY = [...allVertices].sort((a, b) => b[1] - a[1]);
                                    const topVertex = sortedByY[0];
                                    const bottomVertex = sortedByY[sortedByY.length - 1];
                                    const sideVertices = sortedByY.slice(1, sortedByY.length - 1).sort((a, b) => a[0] - b[0]);
                                    if (sideVertices.length >= 2) {
                                        const leftV = sideVertices[0];
                                        const rightV = sideVertices[sideVertices.length - 1];
                                        data.layers = [
                                            { shape_name: 'polyline', purpose: 'reference', is_open: true, points: [leftV, topVertex, rightV] },
                                            { shape_name: 'polyline', purpose: 'solution', is_open: true, points: [leftV, bottomVertex, rightV] }
                                        ];
                                    }
                                }
                            } else if (data.show_axes === false) {
                                const mentionsGrid = qContext.includes('grid') || qContext.includes('coordinate') || qContext.includes('graph') || qContext.includes('square');
                                if (!mentionsGrid) {
                                    data.hide_grid = true;
                                }
                            }

                            // Auto-populate solved transformation polygon from the adjacent <div class="model_answer"> if missing
                            if (Array.isArray(data.layers)) {
                                // 1. Universal Polygon Sanitizer: strip duplicate closing vertices, remove self-intersections/spikes,
                                // and reconcile vertex counts on congruent transformation pairs (e.g. Shape A -> Shape B)
                                const orient = (a: [number, number], b: [number, number], c: [number, number]): number =>
                                    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

                                const onSegment = (p: [number, number], a: [number, number], b: [number, number]): boolean =>
                                    Math.min(a[0], b[0]) - 1e-6 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-6 &&
                                    Math.min(a[1], b[1]) - 1e-6 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-6;

                                const segmentsIntersectOrOverlap = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean => {
                                    const o1 = orient(a, b, c);
                                    const o2 = orient(a, b, d);
                                    const o3 = orient(c, d, a);
                                    const o4 = orient(c, d, b);
                                    if (((o1 > 1e-6 && o2 < -1e-6) || (o1 < -1e-6 && o2 > 1e-6)) &&
                                        ((o3 > 1e-6 && o4 < -1e-6) || (o3 < -1e-6 && o4 > 1e-6))) {
                                        return true;
                                    }
                                    if (Math.abs(o1) <= 1e-6 && onSegment(c, a, b)) return true;
                                    if (Math.abs(o2) <= 1e-6 && onSegment(d, a, b)) return true;
                                    if (Math.abs(o3) <= 1e-6 && onSegment(a, c, d)) return true;
                                    if (Math.abs(o4) <= 1e-6 && onSegment(b, c, d)) return true;
                                    return false;
                                };

                                const isCleanSimplePolygon = (poly: [number, number][]): boolean => {
                                    const n = poly.length;
                                    if (n <= 3) return true;
                                    for (let i = 0; i < n; i++) {
                                        const prev = poly[(i - 1 + n) % n];
                                        const curr = poly[i];
                                        const next = poly[(i + 1) % n];
                                        // Reject degenerate zero-length edges or sharp 180-degree spike foldbacks
                                        const v1x = prev[0] - curr[0], v1y = prev[1] - curr[1];
                                        const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
                                        const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);
                                        if (len1 < 1e-3 || len2 < 1e-3) return false;
                                        const cosTheta = (v1x * v2x + v1y * v2y) / (len1 * len2);
                                        if (cosTheta > 0.96) return false; // interior angle < ~16° spike

                                        // Check non-adjacent edge intersections
                                        for (let j = i + 2; j < n; j++) {
                                            if (i === 0 && j === n - 1) continue;
                                            const b1 = poly[j], b2 = poly[(j + 1) % n];
                                            if (segmentsIntersectOrOverlap(curr, next, b1, b2)) return false;
                                        }
                                    }
                                    return true;
                                };

                                const getSortedEdgeLengths = (poly: [number, number][]): number[] =>
                                    poly.map((pt, i) => {
                                        const nxt = poly[(i + 1) % poly.length];
                                        return Math.hypot(nxt[0] - pt[0], nxt[1] - pt[1]);
                                    }).sort((a, b) => a - b);

                                // First pass: parse and clean individual polygons
                                const parsedPolyLayers: { layer: any; pts: [number, number][] }[] = [];
                                data.layers.forEach((l: any) => {
                                    const rawPts = l.points || l.vertices;
                                    const isPoly = !l.is_open && (l.shape_name === 'polygon' || l.type === 'polygon' || (!l.shape_name && !l.type && Array.isArray(rawPts) && rawPts.length >= 3));
                                    if (!isPoly || !Array.isArray(rawPts) || rawPts.length < 3) return;

                                    let pts: [number, number][] = rawPts.map((p: any) => [
                                        parseFloat(Array.isArray(p) ? p[0] : p?.x),
                                        parseFloat(Array.isArray(p) ? p[1] : p?.y)
                                    ]);
                                    if (pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return;

                                    // Strip duplicate closing vertex if first === last
                                    while (pts.length >= 4 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3) {
                                        pts = pts.slice(0, -1);
                                    }
                                    // Strip consecutive duplicate vertices
                                    pts = pts.filter((pt, idx) => idx === 0 || Math.hypot(pt[0] - pts[idx - 1][0], pt[1] - pts[idx - 1][1]) >= 1e-3);

                                    // If polygon self-intersects or has a degenerate spike, drop 1 stray vertex to restore simplicity
                                    if (pts.length >= 5 && !isCleanSimplePolygon(pts)) {
                                        for (let dropIdx = pts.length - 1; dropIdx >= 0; dropIdx--) {
                                            const candidate = pts.filter((_, idx) => idx !== dropIdx);
                                            if (isCleanSimplePolygon(candidate)) {
                                                pts = candidate;
                                                break;
                                            }
                                        }
                                    }

                                    if (l.points) l.points = pts;
                                    if (l.vertices) l.vertices = pts;
                                    parsedPolyLayers.push({ layer: l, pts });
                                });

                                // Second pass: if two polygons are on a transformation grid (e.g. Shape A with N vertices and Shape B with N+1 vertices
                                // due to a collinear/intermediate DB point), prune the extra vertex from the N+1 polygon if doing so makes them congruent!
                                if (parsedPolyLayers.length === 2) {
                                    const [p1, p2] = parsedPolyLayers;
                                    const [smaller, larger] = p1.pts.length < p2.pts.length ? [p1, p2] : [p2, p1];
                                    if (larger.pts.length === smaller.pts.length + 1 && smaller.pts.length >= 3) {
                                        const targetEdges = getSortedEdgeLengths(smaller.pts);
                                        for (let dropIdx = larger.pts.length - 1; dropIdx >= 0; dropIdx--) {
                                            const candidate = larger.pts.filter((_, idx) => idx !== dropIdx);
                                            const candEdges = getSortedEdgeLengths(candidate);
                                            const isCongruent = candEdges.every((len, idx) => Math.abs(len - targetEdges[idx]) < 0.15);
                                            if (isCongruent && isCleanSimplePolygon(candidate)) {
                                                larger.pts = candidate;
                                                if (larger.layer.points) larger.layer.points = candidate;
                                                if (larger.layer.vertices) larger.layer.vertices = candidate;
                                                break;
                                            }
                                        }
                                    }
                                }

                                // 2. If the answer text states "vertices at (x1, y1), (x2, y2) and (x3, y3)" (like Q9b),
                                // ensure the solved polygon is rendered on the grid in green ('solution' purpose)!
                                const hasSolPoly = data.layers.some((l: any) => l.purpose === 'solution' && (l.shape_name === 'polygon' || l.type === 'polygon'));
                                if (!hasSolPoly && localAfterText.includes('vertices at')) {
                                    const coordMatches = Array.from(localAfterText.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g))
                                        .map(cm => [parseFloat(cm[1]), parseFloat(cm[2])] as [number, number]);
                                    if (coordMatches.length >= 3) {
                                        data.layers.forEach((l: any) => { l.purpose = 'reference'; });
                                        data.layers.push({
                                            shape_name: 'polygon',
                                            purpose: 'solution',
                                            points: coordMatches
                                        });
                                    }
                                }
                            }

                            // Only show fallback if data.layers has NO valid polygon/line coordinates at all
                            const hasValidLayerCoords = Array.isArray(data.layers) && data.layers.some((l: any) => {
                                const pts = l.points || l.vertices;
                                return Array.isArray(pts) && pts.length >= 2;
                            });

                            if (isEnlargeOrReflect && !hasValidLayerCoords && !qText.match(/\(\s*-?\d+\s*,\s*-?\d+\s*\)/) && !qText.includes('vertex')) {
                                const desc = "Shape transformed on the grid (original shape coordinates unknown)";
                                replacement = this.renderFallbackBox(desc);
                            } else {
                                replacement = this.drawCoordinateGrid(data);
                            }
                            break;
                        }
                        case 'tree_diagram':
                        case 'frequency_tree': {
                            const idx = m.index || 0;
                            const matchEnd = idx + m[0].length;
                            const beforeRaw = content.substring(Math.max(0, idx - 600), idx);
                            const lastQHeader = Math.max(
                                beforeRaw.lastIndexOf('model-question-number'),
                                beforeRaw.lastIndexOf('question-group-container')
                            );
                            const qText = (lastQHeader >= 0 ? beforeRaw.substring(lastQHeader) : beforeRaw).toLowerCase();
                            const afterRaw = content.substring(matchEnd, Math.min(content.length, matchEnd + 800));
                            const nextQHeader = afterRaw.indexOf('model-question-number');
                            const localAfterText = nextQHeader >= 0 ? afterRaw.substring(0, nextQHeader) : afterRaw;

                            if (qText.includes('frequency tree')) {
                                data.is_frequency = true;
                            }
                            data._answerText = localAfterText;
                            replacement = this.drawTreeDiagram(data);
                            break;
                        }
                        case 'composite_2d':
                            replacement = this.drawComposite2D(data); break;
                        case 'histogram':
                            replacement = this.drawHistogram(data); break;
                        case 'bar_chart':
                            if (Array.isArray(data.bars) && data.bars.some((b: any) => b.x_start !== undefined && b.x_end !== undefined)) {
                                replacement = this.drawHistogram(data);
                            } else {
                                replacement = this.drawBarChart(data);
                            }
                            break;
                        case 'venn_diagram':
                            replacement = this.drawVennDiagram(data); break;
                        case 'number_line':
                            replacement = this.drawNumberLine(data); break;
                        case 'pictogram':
                            replacement = this.drawPictogram(data); break;
                        case 'number_machine':
                        case 'flowchart':
                            replacement = this.drawNumberMachine(data); break;
                        case 'solid_3d':
                            replacement = this.drawSolid3D(data); break;
                        case 'fallback':
                            const desc = (data.description || data.details || `Diagram (${data.type})`).trim();
                            const lowerDesc = desc.toLowerCase();
                            // [v9.98] Smart Fallback Routing: if the AI outputs a fallback box that is actually
                            // a bar chart, frequency tree, pictogram, number machine, 3D solid, or straight-line angle diagram, draw the SVG instead.
                            const fullFallbackHint = String(data._rawHint || desc);
                            if (/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/.test(fullFallbackHint) && /grid|axes|shape|triangle|pentagon|polygon|curve|velocity/i.test(fullFallbackHint)) {
                                const recoveredGrid = this.recoverCoordinateGridFromHint(fullFallbackHint);
                                if (recoveredGrid) {
                                    replacement = this.drawCoordinateGrid(recoveredGrid);
                                    break;
                                }
                            }
                            if (lowerDesc.includes("histogram") || lowerDesc.includes("frequency density")) {
                                replacement = this.renderHistogramFromHint(desc);
                            } else if (lowerDesc.startsWith("bar chart:")) {
                                replacement = this.renderBarChartFromHint(`[${desc}]`);
                            } else if (lowerDesc.startsWith("frequency tree:")) {
                                replacement = this.renderFrequencyTreeFromHint(`[Diagram: ${desc}]`);
                            } else if (lowerDesc.includes("circle represents") || lowerDesc.includes("pictogram")) {
                                replacement = this.renderPictogramFromHint(desc);
                            } else if (lowerDesc.includes("straight line") && lowerDesc.includes("angle")) {
                                replacement = this.renderStraightLineAngleFromHint(desc);
                            } else if (lowerDesc.includes("number machine") || lowerDesc.includes("function machine") || lowerDesc.includes("box labeled")) {
                                replacement = this.renderNumberMachineFromHint(desc);
                            } else if (lowerDesc.includes("cylinder") || lowerDesc.includes("cuboid") || lowerDesc.includes("cone") || lowerDesc.includes("sphere")) {
                                replacement = this.renderSolid3DFromHint(desc);
                            } else {
                                replacement = this.renderFallbackBox(desc);
                            }
                            break;
                        default:
                            replacement = this.renderFallbackBox(`Unrecognized Diagram Type: ${data.type}`);
                    }
                } else {
                    // This was a redundant/simpler block, hide it
                    replacement = "";
                }
            } catch (e) {
                replacement = m[0]; // Keep original if error
            }
            processedContent = processedContent.replace(m[0], replacement);
        });

        // [v9.78] Safety Nets - MUST run before legacy cleanup to avoid stripping hints
        // [v9.69] Table Safety Net (Q1/Q9) - Mandatory conversion of bracketed hints
        const tableRegex = /\[(Table:|Frequency Table:|Frequency Tree:)(.*?)\]/gi;
        processedContent = processedContent.replace(tableRegex, (match, prefix, content) => {
            return this.renderTableFromHint(content.trim());
        });

        // [v9.76] Triangle Safety Net (Q8/Q17) - Mandatory conversion of bracketed hints
        const triangleRegex = /\[(?:Triangle|Type: Diagram of (?:a )?triangle)[:]\s*(.*?)\]/gi;
        processedContent = processedContent.replace(triangleRegex, (match, content) => {
            return this.renderTriangleFromHint(content.trim());
        });

        // [v9.84] List Safety Net (Q13) - Parses raw data lists into clean numeric grids
        const listRegex = /\[(?:List)[:]\s*(.*?)\]/gi;
        processedContent = processedContent.replace(listRegex, (match, content) => {
            return this.renderListFromHint(content.trim());
        });

        // [v9.86] Angle Safety Net (Q4 etc) - Intersects lines and draws isolated angles
        const angleRegex = /\[(?:Angle|Type: Diagram (?:of|showing) (?:an? |two )?(?:angle|intersecting lines)).*?marked\s+([a-zA-Z0-9]+)\]/gi;
        processedContent = processedContent.replace(angleRegex, (match, label) => {
            return this.renderAngleFromHint(label.trim());
        });

        // [v9.97] Bar Chart Safety Net - intercept [Bar chart: ...] hints
        const barChartRegex = /\[Bar chart:\s*(.*?)\]/gi;
        processedContent = processedContent.replace(barChartRegex, (_match: string, content: string) => {
            return this.renderBarChartFromHint(content.trim());
        });

        // Histogram Safety Net - intercept [Diagram: A histogram ...] hints if unbridged
        const histogramRegex = /\[(?:Type:\s*Diagram|Diagram):\s*([^\[\]]*histogram[^\[\]]*)\]/gi;
        processedContent = processedContent.replace(histogramRegex, (_match: string, content: string) => {
            return this.renderHistogramFromHint(content.trim());
        });

        // [v9.97] Frequency Tree Safety Net - intercept [Diagram: Frequency tree ...] hints
        const freqTreeRegex = /\[Diagram:\s*Frequency tree(.*?)\]/gi;
        processedContent = processedContent.replace(freqTreeRegex, (_match: string, content: string) => {
            return this.renderFrequencyTreeFromHint(content.trim());
        });

        // Legacy hints... (Cleanup Pass - supports 1 level of nested brackets)
        const legacyRegex = /\[(Type:|Diagram:|Answer Diagram:)((?:[^\[\]]|\[[^\]]*\])*)\]/gi;
        processedContent = processedContent.replace(legacyRegex, (match, prefix, description) => {
            // [v9.63] Comprehensive Redundancy Suppression
            const desc = description.trim().toLowerCase();
            const isRedundant = Array.from(renderedKeywords).some(kw => {
                if (kw.length < 3) return false;
                // If the keyword is a significant part of the description or vice versa
                return desc.includes(kw) || kw.includes(desc);
            });
            const sidMatch = Array.from(renderedKeywords).some(kw => desc === kw || desc.startsWith(kw + ' '));

            if (isRedundant || sidMatch) {
                return "";
            }
            return this.renderFallbackBox(description.trim());
        });

        return processedContent;
    }

    /**
     * Unit Helper: Appends unit only if not already present (v9.64)
     */
    private static getAppliedLabel(label: string, unitStr: string): string {
        if (!label) return "";
        const cleanLabel = String(label).trim();
        // If it already has letters (cm, m, x), don't append unit
        if (/[a-z]/i.test(cleanLabel)) return cleanLabel;
        return `${cleanLabel}${unitStr}`;
    }

    /**
     * Resilience Helper: Extracts side labels from the description if they are missing from structured properties.
     * Looks for patterns like "AB: 5x+4", "AC=26", "BC is 10"
     */
    private static extractLabelsFromDescription(desc: string): Record<string, string> {
        const labels: Record<string, string> = {};
        if (!desc) return labels;

        // Pattern 1: Side: Value (e.g., AB: 5x+4, BC = 4x – 1)
        const patterns = [
            /([A-Z]{2})[:=]\s*([^.,\s(]+(?:\s*[+\-–—]\s*[^.,\s(]+)*)/gi, // AB: 5x+4, support special dashes
            /([A-Z]{2})\s+is\s+([^.,\s(]+(?:\s*[+\-–—]\s*[^.,\s(]+)*)/gi   // AB is 5x+4
        ];

        patterns.forEach(regex => {
            let match;
            while ((match = regex.exec(desc)) !== null) {
                const side = match[1].toUpperCase();
                labels[side] = match[2].trim();
            }
        });
        return labels;
    }

    /**
     * Generalized Triangle Drawer
     */
    private static drawTriangle(data: any): string {
        // [v9.55] Support for Coordinate-based Triangles (common in composite_2d)
        if (data.layers || (data.points && !data.side1)) {
            return this.drawCoordinateGrid(data);
        }

        const getVal = (v: any) => {
            if (typeof v === 'number') return v;
            if (v && typeof v === 'object' && v.description) return parseFloat(v.description);
            return parseFloat(v);
        };

        const getLabel = (v: any, fallback: string = "") => {
            if (v && typeof v === 'object' && v.description) return String(v.description);
            return v !== undefined && v !== null ? String(v) : fallback;
        };

        const extractedLabels = this.extractLabelsFromDescription(data.description || "");

        let s1 = getVal(data.side1);
        let s2 = getVal(data.side2);
        let ang = getVal(data.angle);

        const descLower = String(data.description || "").toLowerCase();
        let label1 = getLabel(data.side1) || extractedLabels['AB'] || extractedLabels['AC'] || "";
        let label2 = getLabel(data.side2) || extractedLabels['AC'] || "";

        const isIsosceles = descLower.includes("isosceles") || (label1 && label2 && label1 === label2) || (String(label1).includes('x') && String(label2).includes('x') && descLower.includes("isosceles"));

        // If label2 is still empty after check, and it's NOT a known isosceles side, avoid "faking" AC if only AB was found
        if (!label2 && extractedLabels['AB'] && isIsosceles) {
            label2 = extractedLabels['AB'];
        }

        // [v9.56] Rule #1: Don't break visuals. If non-numeric, sketch a "proportional" version
        const isSketch = !Number.isFinite(s1) || !Number.isFinite(s2) || !Number.isFinite(ang);

        const isRightAngled = descLower.includes("right-angled") || descLower.includes("right angled") || ang === 90;

        if (isSketch) {
            if (isRightAngled) { s1 = 10; s2 = 10; ang = 90; }
            else if (isIsosceles) { s1 = 12; s2 = 14; ang = 65; } // [v9.80] Better proportion for isosceles
            else { s1 = 10; s2 = 8; ang = 60; }
        }

        const angleRad = ang * (Math.PI / 180);
        const x1 = 0, y1 = 0;
        const x2 = s1, y2 = 0;
        let x3 = s2 * Math.cos(angleRad);
        const y3 = -(s2 * Math.sin(angleRad));

        // [v9.80] Force symmetry for anything flagged as isosceles
        if (isIsosceles) {
            x3 = x2 / 2;
        }
        const padding = isSketch ? 5 : 2;
        const minX = Math.min(x1, x2, x3) - padding;
        const maxX = Math.max(x1, x2, x3) + padding;
        const minY = Math.min(y1, y2, y3) - padding;
        const maxY = Math.max(y1, y2, y3) + padding;

        const unit = data.unit || "cm";
        const displayL1 = DiagramService.getAppliedLabel(label1, unit);
        const displayL2 = DiagramService.getAppliedLabel(label2, unit);

        let label3 = getLabel(data.side3) || extractedLabels['BC'] || "";
        // [v9.72] Robust Vertex Label Detection (Supports label_A at root or nested)
        const vA = data.label_A || data.A || "A";
        const vB = data.label_B || data.B || "B";
        const vC = data.label_C || data.C || "C";

        const displayL3 = DiagramService.getAppliedLabel(label3, unit);

        // [v9.94] Per-vertex angle labels (from structured JSON, fully optional)
        // Falls back to legacy single `data.angle` -> `displayLA` for old triangles
        const labelAng = getLabel(data.angle, "");
        const displayLA = labelAng ? (Number.isFinite(parseFloat(labelAng)) ? `${labelAng}°` : labelAng) : "";
        const angA = data.angle_A ? `${data.angle_A}°` : "";  // e.g. "x°"
        let angB = data.angle_B ? `${data.angle_B}°` : (displayLA || ""); // fallback for old JSON
        const angC = data.angle_C ? `${data.angle_C}°` : "";

        // [v9.94] Line Extension (from structured JSON, fully optional)
        const ext = data.line_extension;
        const hasExt = !!ext;
        // Extension goes from vertex B (x1,y1) to the left
        const extLen = isSketch ? 7 : 4;
        const xExt = x1 - extLen;
        const yExt = y1;

        const extPadding = hasExt ? extLen + 2 : 0;
        const adjMinX = Math.min(x1, x2, x3, hasExt ? xExt : x1) - padding - extPadding;

        const fontSize = isSketch ? 1.0 : 0.8;
        const angleFontSize = isSketch ? 0.9 : 0.7;

        // Tick marks for isosceles (on Side 2 and Side 3 / AB and AC)
        let tickMarks = "";
        if (isIsosceles && isSketch) {
            // Midpoint of side 2 (B to A)
            const m2x = x3 / 2;
            const m2y = y3 / 2;
            // Angle of side 2
            const ang2 = Math.atan2(y3, x3);
            const tx2_1 = m2x + 0.5 * Math.cos(ang2 + Math.PI / 2);
            const ty2_1 = m2y + 0.5 * Math.sin(ang2 + Math.PI / 2);
            const tx2_2 = m2x - 0.5 * Math.cos(ang2 + Math.PI / 2);
            const ty2_2 = m2y - 0.5 * Math.sin(ang2 + Math.PI / 2);
            tickMarks += `<line x1="${tx2_1}" y1="${ty2_1}" x2="${tx2_2}" y2="${ty2_2}" stroke="var(--diagram-foreground)" stroke-width="0.2" />`;

            // Midpoint of side 3 (C to A)
            const m3x = (x2 + x3) / 2;
            const m3y = (y2 + y3) / 2;
            const ang3 = Math.atan2(y3 - y2, x3 - x2);
            const tx3_1 = m3x + 0.5 * Math.cos(ang3 + Math.PI / 2);
            const ty3_1 = m3y + 0.5 * Math.sin(ang3 + Math.PI / 2);
            const tx3_2 = m3x - 0.5 * Math.cos(ang3 + Math.PI / 2);
            const ty3_2 = m3y - 0.5 * Math.sin(ang3 + Math.PI / 2);
            tickMarks += `<line x1="${tx3_1}" y1="${ty3_1}" x2="${tx3_2}" y2="${ty3_2}" stroke="var(--diagram-foreground)" stroke-width="0.2" />`;
        }

        // [v9.102] Right Angle Square Symbol (Q10/Q19)
        let rightAngleHtml = "";
        if (isRightAngled) {
            const sqSize = isSketch ? 1.5 : 1.0;
            // The square goes along x, then up (negative y), then back to y-axis
            rightAngleHtml = `<polyline points="${x1 + sqSize},${y1} ${x1 + sqSize},${y1 - sqSize} ${x1},${y1 - sqSize}" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.25" vector-effect="non-scaling-stroke" stroke-linejoin="round" />`;

            // Suppress writing "90°" text over the square
            if (angB === "90°" || angB === "90") {
                angB = "";
            }
        }

        return this.wrapSVG(adjMinX, minY, maxX - adjMinX, maxY - minY, `
            <polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" 
                     fill="none" stroke="var(--diagram-foreground)" stroke-width="0.25" vector-effect="non-scaling-stroke" />
            ${tickMarks}
            ${rightAngleHtml}

            <!-- Line Extension (v9.94) -->
            ${hasExt ? `<line x1="${x1}" y1="${y1}" x2="${xExt}" y2="${yExt}" stroke="var(--diagram-foreground)" stroke-width="0.25" vector-effect="non-scaling-stroke" />` : ""}

            <!-- Vertex Labels -->
            <text x="${x3}" y="${y3 - 1.0}" font-size="${fontSize}" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${vA}</text>
            <text x="${x1 - 1.0}" y="${y1 + 1.2}" font-size="${fontSize}" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${vB}</text>
            <text x="${x2 + 1.2}" y="${y2}" font-size="${fontSize}" fill="var(--diagram-foreground)" text-anchor="start" font-weight="bold">${vC}</text>
            ${hasExt ? `<text x="${xExt - 0.8}" y="${yExt}" font-size="${fontSize}" fill="var(--diagram-foreground)" text-anchor="end" font-weight="bold">${ext.label || "C"}</text>` : ""}

            <!-- Side Labels -->
            <text x="${x3 / 2 - (isSketch ? 2.5 : 1.0)}" y="${y3 / 2}" font-size="${fontSize}" font-weight="${isSketch ? '600' : 'normal'}" text-anchor="end" fill="var(--diagram-foreground)">${displayL2}</text>
            <text x="${(x2 + x3) / 2 + (isSketch ? 2.5 : 1.0)}" y="${(y2 + y3) / 2}" font-size="${fontSize}" font-weight="${isSketch ? '600' : 'normal'}" text-anchor="start" fill="var(--diagram-foreground)">${displayL1}</text>
            <text x="${(x1 + x2) / 2}" y="${y1 + (isSketch ? 3.0 : 1.5)}" font-size="${fontSize}" font-weight="${isSketch ? '600' : 'normal'}" text-anchor="middle" fill="var(--diagram-foreground)">${displayL3}</text>
            
            <!-- Angle Labels per vertex (v9.94) -->
            ${angA ? `<text x="${x3}" y="${y3 + (isSketch ? 2.2 : 1.2)}" font-size="${angleFontSize}" font-style="italic" fill="var(--diagram-foreground)" text-anchor="middle">${angA}</text>` : ""}
            ${angB ? `<text x="${x1 + (isSketch ? 1.8 : 0.8)}" y="${y1 - (isSketch ? 1.0 : 0.4)}" font-size="${angleFontSize}" font-style="italic" fill="var(--diagram-foreground)" text-anchor="start">${angB}</text>` : ""}
            ${angC ? `<text x="${x2 - (isSketch ? 1.8 : 0.8)}" y="${y2 - (isSketch ? 1.0 : 0.4)}" font-size="${angleFontSize}" font-style="italic" fill="var(--diagram-foreground)" text-anchor="end">${angC}</text>` : ""}

            <!-- Exterior angle at extension junction (v9.94) -->
            ${hasExt && ext.angle_label ? `<text x="${x1 - (isSketch ? 2.5 : 1.5)}" y="${y1 - (isSketch ? 1.2 : 0.6)}" font-size="${angleFontSize}" font-style="italic" fill="var(--diagram-foreground)" text-anchor="middle">${ext.angle_label}°</text>` : ""}
            
            ${isSketch ? `<text x="${maxX}" y="${maxY + 1.0}" font-size="0.8" fill="var(--diagram-grid)" font-weight="bold" text-anchor="end">Not to scale</text>` : ""}
        `);
    }

    /**
     * Draws Polygons (Pentagons, Hexagons, Rectangles)
     */
    private static drawPolygon(data: any): string {
        const shapeName = (data.shape_name || "").toLowerCase();
        const isRectangle = shapeName === 'rectangle' || shapeName === 'quadrilateral';
        const n = shapeName === 'pentagon' ? 5 : (shapeName === 'hexagon' ? 6 : (isRectangle ? 4 : 0));

        if (n === 0) {
            return this.renderFallbackBox(data.description || `Polygon Diagram: ${data.shape_name || "Unknown Shape"}`);
        }

        const points: [number, number][] = [];
        const sides = data.sides || [];
        const unit = data.unit || "cm";

        if (isRectangle) {
            // [v9.65] Horizontal Rectangle Fix (Q4)
            // Use numeric lengths if available, else default to 8x5 ratio
            const len = parseFloat(sides.find((s: any) => s.label === 'Length' || s.length > 5)?.length || 8);
            const wid = parseFloat(sides.find((s: any) => s.label === 'Width' || (s.length > 0 && s.length <= 5))?.length || 5);

            points.push([0, 0]);       // Bottom-Left
            points.push([len, 0]);     // Bottom-Right
            points.push([len, -wid]);  // Top-Right
            points.push([0, -wid]);    // Top-Left

            const ptsStr = points.map(p => p.join(',')).join(' ');

            const l1 = sides[0]?.length || len;
            const l2 = sides[1]?.length || wid;
            const displayL1 = DiagramService.getAppliedLabel(String(l1), unit);
            const displayL2 = DiagramService.getAppliedLabel(String(l2), unit);

            return this.wrapSVG(-2, -wid - 4, len + 8, wid + 8, `
                <polygon points="${ptsStr}" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.5" vector-effect="non-scaling-stroke" />
                <!-- Bottom Label -->
                <text x="${len / 2}" y="2.5" font-size="0.7" text-anchor="middle" fill="var(--diagram-foreground)" font-weight="bold">${displayL1}</text>
                <!-- Right Label -->
                <text x="${len + 1.2}" y="${-wid / 2}" font-size="0.7" text-anchor="start" dominant-baseline="middle" fill="var(--diagram-foreground)" font-weight="bold">${displayL2}</text>
            `);
        }

        // Default Regular Polygon fallback (Pentagon/Hexagon)
        const radius = 10;
        for (let i = 0; i < n; i++) {
            const angle = (i * 2 * Math.PI / n) - (Math.PI / 2);
            points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
        }

        const ptsStr = points.map(p => p.join(',')).join(' ');

        return this.wrapSVG(-15, -15, 30, 30, `
            <polygon points="${ptsStr}" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.5" vector-effect="non-scaling-stroke" />
            ${points.map((p1, i) => {
            const p2 = points[(i + 1) % n];
            const tx = (p1[0] + p2[0]) / 2 * 1.25;
            const ty = (p1[1] + p2[1]) / 2 * 1.25;
            const label = sides[i]?.label || sides[i]?.length || "";
            return label ? `<text x="${tx}" y="${ty}" font-size="1.2" text-anchor="middle" dominant-baseline="middle" fill="var(--diagram-foreground)" font-weight="bold">${label}</text>` : "";
        }).join('')}
        `);
    }

    /**
     * Resolves top-level `vertices` / `vertex_map` dictionaries OR harvests vertex coordinates from point layers,
     * runs `rectifyEuclideanGeometry`, and synchronizes all associated polygon/polyline/point layers.
     */
    private static resolveVertexMap(data: any): void {
        if (!data || typeof data !== 'object' || data._verticesResolved) return;
        data._verticesResolved = true;

        if (!Array.isArray(data.layers)) data.layers = [];
        const vertexMap = new Map<string, [number, number]>();

        const rawMap = (data.vertex_map && typeof data.vertex_map === 'object' && !Array.isArray(data.vertex_map))
            ? data.vertex_map
            : (data.vertices && typeof data.vertices === 'object' && !Array.isArray(data.vertices) ? data.vertices : null);

        if (rawMap) {
            Object.entries(rawMap).forEach(([k, v]: [string, any]) => {
                if (Array.isArray(v) && v.length >= 2) {
                    const vx = parseFloat(v[0]);
                    const vy = parseFloat(v[1]);
                    if (Number.isFinite(vx) && Number.isFinite(vy)) {
                        vertexMap.set(k.trim(), [vx, vy]);
                    }
                } else if (v && typeof v === 'object') {
                    const vx = parseFloat(v.x);
                    const vy = parseFloat(v.y);
                    if (Number.isFinite(vx) && Number.isFinite(vy)) {
                        vertexMap.set(k.trim(), [vx, vy]);
                    }
                }
            });
        }

        if (data.vertices && !Array.isArray(data.vertices)) {
            delete data.vertices;
        }

        // Fallback: harvest single-letter vertex coordinates from point layers if top-level dict was omitted
        data.layers.forEach((l: any) => {
            if (l.vertices && !Array.isArray(l.vertices)) {
                delete l.vertices;
            }
            const lbl = String(l.label || '').trim();
            if (/^[A-Z]$/.test(lbl) && !vertexMap.has(lbl)) {
                const c = l.coords || l.coord || (Array.isArray(l.points) && l.points.length === 1 ? l.points[0] : null);
                if (c) {
                    const cx = parseFloat(Array.isArray(c) ? c[0] : c.x);
                    const cy = parseFloat(Array.isArray(c) ? c[1] : c.y);
                    if (Number.isFinite(cx) && Number.isFinite(cy)) {
                        vertexMap.set(lbl, [cx, cy]);
                    }
                }
            }
        });

        if (vertexMap.size === 0) return;

        const oldVertexMap = new Map<string, [number, number]>();
        vertexMap.forEach((pt, k) => oldVertexMap.set(k, [pt[0], pt[1]]));

        // Enforce exact geometric constraints (squares, equilateral triangles, regular polygon chains)
        this.rectifyEuclideanGeometry(vertexMap, data);

        // Update layers with rectified coordinates
        data.layers.forEach((l: any) => {
            const refs = l.vertex_refs || l.refs;
            if (Array.isArray(refs) && refs.length > 0) {
                const resolved = refs
                    .map((ref: any) => vertexMap.get(String(ref).trim()))
                    .filter(Boolean) as [number, number][];
                if (resolved.length > 0) {
                    l.points = resolved.map(pt => [pt[0], pt[1]]);
                }
            } else if (Array.isArray(l.points) && l.points.length >= 2) {
                l.points = l.points.map((p: any) => {
                    const px = parseFloat(Array.isArray(p) ? p[0] : p?.x);
                    const py = parseFloat(Array.isArray(p) ? p[1] : p?.y);
                    if (!Number.isFinite(px) || !Number.isFinite(py)) return p;
                    for (const [vName, oldPt] of Array.from(oldVertexMap.entries())) {
                        if (Math.hypot(px - oldPt[0], py - oldPt[1]) < 0.25) {
                            const newPt = vertexMap.get(vName)!;
                            return [newPt[0], newPt[1]];
                        }
                    }
                    return [px, py];
                });
            }

            const lbl = String(l.label || '').trim();
            if (lbl && vertexMap.has(lbl) && (l.shape_name === 'point' || l.type === 'point' || l.coords || l.coord)) {
                const rectCoords = vertexMap.get(lbl)!;
                if (l.coords) l.coords = [rectCoords[0], rectCoords[1]];
                if (l.coord) l.coord = [rectCoords[0], rectCoords[1]];
                if (Array.isArray(l.points) && l.points.length === 1) l.points = [[rectCoords[0], rectCoords[1]]];
            }
        });

        // Ensure every vertex in vertexMap has a corresponding point label layer
        const existingLabeledVertices = new Set<string>();
        data.layers.forEach((l: any) => {
            const lbl = String(l.label || '').trim();
            if (lbl && (l.shape_name === 'point' || l.type === 'point' || l.coords || l.coord)) {
                existingLabeledVertices.add(lbl);
            }
        });

        vertexMap.forEach((coords, vName) => {
            if (!existingLabeledVertices.has(vName)) {
                data.layers.push({
                    shape_name: 'point',
                    coords: [coords[0], coords[1]],
                    label: vName,
                    hide_dot: true,
                    purpose: 'reference'
                });
            }
        });
    }

    /**
     * Generic Euclidean Geometry Constraint Solver:
     * Mathematically enforces 90° squares, 60° equilateral triangles, and regular polygon turns.
     */
    private static rectifyEuclideanGeometry(
        vertexMap: Map<string, [number, number]>,
        data: any
    ): void {
        const caseContext = `${data._rawCaseContext || ''} ${data._rawHint || ''} ${data.description || ''}`;
        if (!caseContext.trim() || vertexMap.size < 3) return;

        const fixedVertices = new Set<string>();
        const processedSquares = new Set<string>();
        const processedTriangles = new Set<string>();

        // 1. GENERIC SQUARE RECTIFIER
        const sqMatches = [
            ...Array.from(caseContext.matchAll(/\b([A-Z]{4})\s+is\s+a\s+square\b/g)),
            ...Array.from(caseContext.matchAll(/\bsquare\s+([A-Z]{4})\b/g))
        ];
        for (const m of sqMatches) {
            const name = m[1];
            const key = name.split('').sort().join('');
            if (processedSquares.has(key)) continue;

            const verts = name.split('');
            if (!verts.every(v => vertexMap.has(v))) continue;
            processedSquares.add(key);

            const [v0, v1, v2, v3] = verts;
            const p0 = [...vertexMap.get(v0)!] as [number, number];
            const p1 = [...vertexMap.get(v1)!] as [number, number];
            const p2 = vertexMap.get(v2);
            const p3 = vertexMap.get(v3);

            let dx = p1[0] - p0[0];
            let dy = p1[1] - p0[1];
            const len = Math.hypot(dx, dy) || 3;

            const ang = Math.atan2(dy, dx);
            if (Math.abs(Math.abs(ang) - Math.PI / 2) < 0.35) {
                dx = 0;
                dy = ang > 0 ? len : -len;
                p1[0] = p0[0] + dx;
                p1[1] = p0[1] + dy;
                vertexMap.set(v1, p1);
            } else if (Math.abs(ang) < 0.35 || Math.abs(Math.abs(ang) - Math.PI) < 0.35) {
                dx = Math.cos(ang) > 0 ? len : -len;
                dy = 0;
                p1[0] = p0[0] + dx;
                p1[1] = p0[1] + dy;
                vertexMap.set(v1, p1);
            }

            const refPt = p2 || p3;
            let nx = -dy, ny = dx;
            if (refPt) {
                const dot = (refPt[0] - p1[0]) * nx + (refPt[1] - p1[1]) * ny;
                if (dot < 0) { nx = dy; ny = -dx; }
            }
            if (nx < 0 && Math.abs(ny) < 1e-3) {
                nx = -nx;
            }

            const newP2: [number, number] = [+(p1[0] + nx).toFixed(3), +(p1[1] + ny).toFixed(3)];
            const newP3: [number, number] = [+(p0[0] + nx).toFixed(3), +(p0[1] + ny).toFixed(3)];
            vertexMap.set(v2, newP2);
            vertexMap.set(v3, newP3);
            verts.forEach(v => fixedVertices.add(v));

            if (Array.isArray(data.layers)) {
                const sqLayer = data.layers.find((l: any) => {
                    const refs = l.vertex_refs || l.refs;
                    if (Array.isArray(refs) && refs.length === 4 && verts.every(v => refs.includes(v))) return true;
                    const pts = l.points || l.vertices;
                    return !l.is_open && Array.isArray(pts) && pts.length === 4;
                });
                if (sqLayer) {
                    sqLayer.vertex_refs = [v0, v1, v2, v3];
                    sqLayer.points = [p0, p1, newP2, newP3];
                }
            }
        }

        // 2. GENERIC EQUILATERAL TRIANGLE RECTIFIER
        const eqMatches = [
            ...Array.from(caseContext.matchAll(/\b([A-Z]{3})\s+is\s+an\s+equilateral\s+triangle\b/g)),
            ...Array.from(caseContext.matchAll(/\bequilateral\s+triangle\s+([A-Z]{3})\b/g))
        ];
        for (const m of eqMatches) {
            const name = m[1];
            const key = name.split('').sort().join('');
            if (processedTriangles.has(key)) continue;

            const verts = name.split('');
            if (!verts.every(v => vertexMap.has(v))) continue;
            processedTriangles.add(key);

            const known = verts.filter(v => fixedVertices.has(v));
            if (known.length === 3) continue;

            const baseA = known.length === 2 ? known[0] : verts[0];
            const baseB = known.length === 2 ? known[1] : verts[1];
            const apex = verts.find(v => v !== baseA && v !== baseB)!;

            const pA = vertexMap.get(baseA)!;
            const pB = vertexMap.get(baseB)!;

            const dx = pB[0] - pA[0];
            const dy = pB[1] - pA[1];
            const mx = (pA[0] + pB[0]) / 2;
            const my = (pA[1] + pB[1]) / 2;
            const h = Math.sqrt(3) / 2;

            const cand1: [number, number] = [+(mx - dy * h).toFixed(3), +(my + dx * h).toFixed(3)];
            const cand2: [number, number] = [+(mx + dy * h).toFixed(3), +(my - dx * h).toFixed(3)];

            const otherFixedPts = Array.from(fixedVertices)
                .filter(v => v !== baseA && v !== baseB && v !== apex)
                .map(v => vertexMap.get(v)!)
                .filter(Boolean);

            let chosen = cand1;
            if (otherFixedPts.length > 0) {
                const dist1 = otherFixedPts.reduce((sum, pt) => sum + Math.hypot(cand1[0] - pt[0], cand1[1] - pt[1]), 0);
                const dist2 = otherFixedPts.reduce((sum, pt) => sum + Math.hypot(cand2[0] - pt[0], cand2[1] - pt[1]), 0);
                chosen = dist1 >= dist2 ? cand1 : cand2;
            }

            vertexMap.set(apex, chosen);
            verts.forEach(v => fixedVertices.add(v));

            if (Array.isArray(data.layers)) {
                const triLayer = data.layers.find((l: any) => {
                    const refs = l.vertex_refs || l.refs;
                    if (Array.isArray(refs) && refs.length === 3 && verts.every(v => refs.includes(v))) return true;
                    const pts = l.points || l.vertices;
                    return !l.is_open && Array.isArray(pts) && pts.length === 3;
                });
                if (triLayer) {
                    triLayer.vertex_refs = [baseA, baseB, apex];
                    triLayer.points = [pA, pB, chosen];
                }
            }
        }

        // 3. GENERIC REGULAR POLYGON CHAIN RECTIFIER
        if (/sides\s+of\s+a\s+regular\s+(?:[a-z0-9-]+\s+)?polygon/i.test(caseContext)) {
            const segMatches = Array.from(caseContext.matchAll(/\b([A-Z]{2})\b/g))
                .map(m => m[1])
                .filter(s => s[0] !== s[1] && vertexMap.has(s[0]) && vertexMap.has(s[1]));

            const chain: string[] = [];
            for (const seg of segMatches) {
                if (chain.length === 0) {
                    chain.push(seg[0], seg[1]);
                } else if (chain[chain.length - 1] === seg[0] && !chain.includes(seg[1])) {
                    chain.push(seg[1]);
                }
            }

            let anchorIdx = -1;
            for (let i = 0; i <= chain.length - 3; i++) {
                if (fixedVertices.has(chain[i]) && fixedVertices.has(chain[i + 1]) && fixedVertices.has(chain[i + 2])) {
                    anchorIdx = i;
                    break;
                }
            }

            if (anchorIdx >= 0) {
                const pPrev = vertexMap.get(chain[anchorIdx])!;
                const pMid = vertexMap.get(chain[anchorIdx + 1])!;
                const pNext = vertexMap.get(chain[anchorIdx + 2])!;

                const sideLen = Math.hypot(pNext[0] - pMid[0], pNext[1] - pMid[1]);
                const ang1 = Math.atan2(pMid[1] - pPrev[1], pMid[0] - pPrev[0]);
                const ang2 = Math.atan2(pNext[1] - pMid[1], pNext[0] - pMid[0]);
                let turnAngle = ang2 - ang1;
                while (turnAngle <= -Math.PI) turnAngle += 2 * Math.PI;
                while (turnAngle > Math.PI) turnAngle -= 2 * Math.PI;

                for (let i = anchorIdx + 2; i < chain.length - 1; i++) {
                    const pA = vertexMap.get(chain[i - 1])!;
                    const pB = vertexMap.get(chain[i])!;
                    const prevAng = Math.atan2(pB[1] - pA[1], pB[0] - pA[0]);
                    const nextAng = prevAng + turnAngle;
                    vertexMap.set(chain[i + 1], [
                        +(pB[0] + sideLen * Math.cos(nextAng)).toFixed(3),
                        +(pB[1] + sideLen * Math.sin(nextAng)).toFixed(3)
                    ]);
                }

                for (let i = anchorIdx; i > 0; i--) {
                    const pC = vertexMap.get(chain[i + 1])!;
                    const pB = vertexMap.get(chain[i])!;
                    const nextEdgeAng = Math.atan2(pC[1] - pB[1], pC[0] - pB[0]);
                    const prevEdgeAng = nextEdgeAng - turnAngle;
                    vertexMap.set(chain[i - 1], [
                        +(pB[0] - sideLen * Math.cos(prevEdgeAng)).toFixed(3),
                        +(pB[1] - sideLen * Math.sin(prevEdgeAng)).toFixed(3)
                    ]);
                }

                if (Array.isArray(data.layers)) {
                    const chainLayer = data.layers.find((l: any) => {
                        const refs = l.vertex_refs || l.refs;
                        if (Array.isArray(refs) && refs.length === chain.length) return true;
                        const pts = l.points || l.vertices;
                        return Boolean(l.is_open) && Array.isArray(pts) && pts.length === chain.length;
                    });
                    if (chainLayer) {
                        chainLayer.vertex_refs = [...chain];
                        chainLayer.points = chain.map(v => [...vertexMap.get(v)!]);
                        chainLayer.stroke_width = chainLayer.stroke_width || 0.7;
                    }
                }
            }
        }
    }

    /**
     * Draws Coordinate Grids and Shape Layers
     */
    private static drawCoordinateGrid(data: any): string {
        this.resolveVertexMap(data);

        if (data._isSymmetry) {
            const getPointsTemp = (item: any): any[] => {
                let pts: any[] = [];
                if (Array.isArray(item.points)) pts.push(...item.points);
                if (Array.isArray(item.vertices)) pts.push(...item.vertices);
                if (item.shapes) item.shapes.forEach((s: any) => pts.push(...getPointsTemp(s)));
                if (item.layers) item.layers.forEach((l: any) => pts.push(...getPointsTemp(l)));
                return pts;
            };
            const tPts = getPointsTemp(data);
            if (tPts.length > 0) {
                let smX = Infinity, smY = Infinity, lgX = -Infinity, lgY = -Infinity;
                tPts.forEach((p: any) => {
                    const px = parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0));
                    const py = parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0));
                    if (Number.isFinite(px)) { smX = Math.min(smX, px); lgX = Math.max(lgX, px); }
                    if (Number.isFinite(py)) { smY = Math.min(smY, py); lgY = Math.max(lgY, py); }
                });
                if (lgX - smX > 0 && lgX - smX <= 2 && lgY - smY <= 2) {
                    const scaleFactor = 3;
                    const scaleItem = (item: any) => {
                        if (item.points) {
                            item.points = item.points.map((p: any) => {
                                if (Array.isArray(p)) return [parseFloat(p[0]) * scaleFactor, parseFloat(p[1]) * scaleFactor];
                                return { x: parseFloat(p.x) * scaleFactor, y: parseFloat(p.y) * scaleFactor };
                            });
                        }
                        if (item.vertices) {
                            item.vertices = item.vertices.map((p: any) => {
                                if (Array.isArray(p)) return [parseFloat(p[0]) * scaleFactor, parseFloat(p[1]) * scaleFactor];
                                return { x: parseFloat(p.x) * scaleFactor, y: parseFloat(p.y) * scaleFactor };
                            });
                        }
                        if (item.x !== undefined && item.y !== undefined) {
                            item.x = parseFloat(item.x) * scaleFactor;
                            item.y = parseFloat(item.y) * scaleFactor;
                        }
                        if (item.shapes) item.shapes.forEach(scaleItem);
                        if (item.layers) item.layers.forEach(scaleItem);
                    };
                    scaleItem(data);
                }
            }
        }

        const getRawPoints = (item: any): any[] => {
            let pts: any[] = [];
            if ((item.shape_name === 'circle' || item.shape_name === 'arc') && item.center) {
                const cx = parseFloat(item.center[0]);
                const cy = parseFloat(item.center[1]);
                const r = parseFloat(item.radius || 1);
                if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r)) {
                    pts.push([cx - r, cy - r], [cx + r, cy + r]);
                }
            }
            if (Array.isArray(item.points)) pts.push(...item.points);
            if (Array.isArray(item.vertices)) pts.push(...item.vertices);
            if (item.coords) pts.push(item.coords);
            else if (item.coord) pts.push(item.coord);
            else if ((item.shape_name === 'point' || item.type === 'point') && item.center) pts.push(item.center);
            if (item.shapes) item.shapes.forEach((s: any) => pts.push(...getRawPoints(s)));
            if (item.layers) item.layers.forEach((l: any) => pts.push(...getRawPoints(l)));
            return pts;
        };
        const allPossiblePoints = getRawPoints(data);

        let xMin = parseFloat(data.x_min);
        let xMax = parseFloat(data.x_max);
        let yMin = parseFloat(data.y_min);
        let yMax = parseFloat(data.y_max);

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        if (allPossiblePoints.length > 0) {
            allPossiblePoints.forEach((p: any) => {
                const px = parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0));
                const py = parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0));
                if (Number.isFinite(px)) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); }
                if (Number.isFinite(py)) { minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
            });
        }

        const isPureGeometry = data.show_axes === false && (data.hide_grid === true || data.hide_grid === undefined);

        if (isPureGeometry && allPossiblePoints.length > 0 && Number.isFinite(minX) && Number.isFinite(maxX)) {
            // Always fit pure Euclidean geometry tightly to its actual vertices, ignoring arbitrary [-6, 6] LLM defaults
            const spanX = Math.max(1, maxX - minX);
            const spanY = Math.max(1, maxY - minY);
            const margin = Math.max(spanX, spanY) * 0.14;
            xMin = minX - margin;
            xMax = maxX + margin;
            yMin = minY - margin;
            yMax = maxY + margin;
        } else if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) {
            if (allPossiblePoints.length > 0) {
                xMin = Number.isFinite(xMin) ? xMin : minX - 2;
                xMax = Number.isFinite(xMax) ? xMax : maxX + 2;
                yMin = Number.isFinite(yMin) ? yMin : minY - 2;
                yMax = Number.isFinite(yMax) ? yMax : maxY + 2;
            } else {
                xMin = -10; xMax = 10; yMin = -10; yMax = 10;
            }
        }

        // Determine true data span from allPossiblePoints BEFORE padding
        const ptSpanX = (Number.isFinite(minX) && Number.isFinite(maxX)) ? (maxX - minX) : NaN;
        const ptSpanY = (Number.isFinite(minY) && Number.isFinite(maxY)) ? (maxY - minY) : NaN;

        // Route non-uniform scale graphs (like Q12 Velocity-Time where X is 0..6 and Y is 0..60) to drawNormalizedCartesianGraph!
        if (data.show_axes !== false && !data.hide_grid && !data._isSymmetry) {
            const checkW = (Number.isFinite(ptSpanX) && ptSpanX > 0) ? ptSpanX : (xMax - xMin);
            const checkH = (Number.isFinite(ptSpanY) && ptSpanY > 0) ? ptSpanY : (yMax - yMin);
            const contextStr = `${data.x_label || ''} ${data.y_label || ''} ${data.x_axis_label || ''} ${data.y_axis_label || ''} ${data._rawHint || ''} ${data._qContext || ''}`.toLowerCase();
            const hasPhysicalUnits = /velocity|m\/s|time\s*\(|seconds|frequency\s+density|cumulative\s+frequency|distance|speed|temperature/.test(contextStr);

            if (Number.isFinite(checkW) && Number.isFinite(checkH) && checkW > 0 && checkH > 0) {
                if (checkH / checkW > 2.2 || checkW / checkH > 2.2 || hasPhysicalUnits) {
                    return this.drawNormalizedCartesianGraph(data);
                }
            }
        }

        if (!isPureGeometry && allPossiblePoints.length > 0) {
            if (minX < xMin) xMin = minX - 1;
            if (maxX > xMax) xMax = maxX + 1;
            if (minY < yMin) yMin = minY - 1;
            if (maxY > yMax) yMax = maxY + 1;
        }

        let layers = data.layers || data.shapes || [];
        if (layers.length === 0 && allPossiblePoints.length > 0) {
            layers = [data];
        }

        let width = xMax - xMin;
        let height = yMax - yMin;

        const minWidthAllowed = height / 1.5;
        if (data.show_axes !== false && width < minWidthAllowed && Number.isFinite(width) && Number.isFinite(height)) {
            const widthDiff = minWidthAllowed - width;
            xMin -= widthDiff / 2;
            xMax += widthDiff / 2;
            width = xMax - xMin;
        }

        const xAxisY = (yMin <= 0 && yMax >= 0) ? 0 : (yMin > 0 ? -yMin : -yMax);
        const yAxisX = (xMin <= 0 && xMax >= 0) ? 0 : (xMin > 0 ? xMin : xMax);

        // Scale unit normalized to a 20x20 grid so font sizes and offsets stay visually consistent across any grid range
        const span = Math.max(width || 10, height || 10);
        const u = span / 20;
        const labelFontSize = +(0.48 * u).toFixed(3);
        const vertexFontSize = +(0.42 * u).toFixed(3);
        const axisFontSize = +(0.50 * u).toFixed(3);
        const tickFontSize = +(0.36 * u).toFixed(3);
        const pointRadius = +(0.18 * u).toFixed(3);
        const pad = +(0.85 * u).toFixed(3);

        let gridHtml = "";

        // Define arrowheads for Vectors
        gridHtml += `
            <defs>
                <marker id="vector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--diagram-foreground)" />
                </marker>
            </defs>
        `;

        // Auto-hide grid & axes when show_axes is false and no grid is explicitly requested
        if (data.show_axes === false && data.hide_grid === undefined) {
            data.hide_grid = true;
        }

        const xStep = Math.max(1, Math.ceil((width || 10) / 20));
        const yStep = Math.max(1, Math.ceil((height || 10) / 20));

        if (!data.hide_grid) {
            gridHtml += `<rect x="${xMin}" y="${-yMax}" width="${width}" height="${height}" fill="none" stroke="var(--diagram-grid)" stroke-width="0.3" opacity="1" vector-effect="non-scaling-stroke" />`;

            for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
                gridHtml += `<line x1="${x}" y1="${-yMax}" x2="${x}" y2="${-yMin}" stroke="var(--diagram-grid)" stroke-width="0.15" opacity="1" vector-effect="non-scaling-stroke" />`;
            }
            for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
                gridHtml += `<line x1="${xMin}" y1="${-y}" x2="${xMax}" y2="${-y}" stroke="var(--diagram-grid)" stroke-width="0.15" opacity="1" vector-effect="non-scaling-stroke" />`;
            }
        }

        let layersHtml = gridHtml;

        if (data.show_axes !== false) {
            layersHtml += `
                <line x1="${xMin}" y1="${xAxisY}" x2="${xMax}" y2="${xAxisY}" stroke="var(--diagram-grid)" stroke-width="0.4" vector-effect="non-scaling-stroke" />
                <line x1="${yAxisX}" y1="${-yMax}" x2="${yAxisX}" y2="${-yMin}" stroke="var(--diagram-grid)" stroke-width="0.4" vector-effect="non-scaling-stroke" />
                <text x="${xMax - 0.15 * u}" y="${xAxisY - 0.35 * u}" font-size="${axisFontSize}" fill="var(--diagram-grid)" text-anchor="end" font-style="italic">x</text>
                <text x="${yAxisX + 0.35 * u}" y="${-yMax + 0.55 * u}" font-size="${axisFontSize}" fill="var(--diagram-grid)" text-anchor="start" font-style="italic">y</text>
            `;

            // Render axis tick numbers so coordinates are easy to verify on the grid
            for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
                if (x === 0 && xMin < 0 && xMax > 0) continue;
                const tickY = (xAxisY + 0.52 * u <= -yMin + pad * 0.7) ? xAxisY + 0.48 * u : -yMin + 0.48 * u;
                layersHtml += `<text x="${x}" y="${tickY}" font-size="${tickFontSize}" fill="var(--diagram-grid)" text-anchor="middle">${Math.round(x * 10) / 10}</text>`;
            }
            for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
                if (y === 0 && yMin < 0 && yMax > 0) continue;
                const tickX = (yAxisX - 0.25 * u >= xMin - pad * 0.7) ? yAxisX - 0.25 * u : xMin - 0.25 * u;
                layersHtml += `<text x="${tickX}" y="${-y + tickFontSize * 0.35}" font-size="${tickFontSize}" fill="var(--diagram-grid)" text-anchor="end">${Math.round(y * 10) / 10}</text>`;
            }
        }

        if (data.label_origin) {
            layersHtml += `<circle cx="0" cy="0" r="${pointRadius}" fill="var(--diagram-foreground)" />`;
            layersHtml += `<text x="${0.25 * u}" y="${-0.25 * u}" font-size="${vertexFontSize}" fill="var(--diagram-foreground)" font-weight="bold">${data.label_origin}</text>`;
        }

        const pointLabelSet = new Set<string>();
        layers.forEach((l: any) => {
            if (l.shape_name === 'point' || l.type === 'point' || l.coords || l.coord) {
                const lbl = String(l.label || '').trim().toUpperCase();
                if (/^[A-Z]$/.test(lbl)) pointLabelSet.add(lbl);
            }
            const pts = l.points || l.vertices;
            if (Array.isArray(pts)) {
                pts.forEach((p: any) => {
                    const vLbl = String(Array.isArray(p) ? p[2] : (p?.label || '')).trim().toUpperCase();
                    if (/^[A-Z]$/.test(vLbl)) pointLabelSet.add(vLbl);
                });
            }
        });

        // Universal Bidirectional Parallel-Intercept Collinearity Snap (works for any vertex letters, e.g. ABC+ED or PQR+ST):
        // If a diagram has a triangle polygon and a 2-point line segment with one endpoint on one edge of the triangle
        // and the segment parallel to a second edge of the triangle, snap its floating endpoint onto the third edge of the triangle.
        const triPolyLayer = layers.find((l: any) => {
            const pts = l.points || l.vertices;
            return Array.isArray(pts) && (pts.length === 3 || (pts.length === 4 && Math.hypot(pts[0][0] - pts[3][0], pts[0][1] - pts[3][1]) < 1e-3));
        });
        if (triPolyLayer) {
            const rawTriPts = (triPolyLayer.points || triPolyLayer.vertices).slice(0, 3).map((p: any) => [
                parseFloat(Array.isArray(p) ? p[0] : p?.x),
                parseFloat(Array.isArray(p) ? p[1] : p?.y)
            ] as [number, number]);

            if (rawTriPts.length === 3 && rawTriPts.every(([x, y]: [number, number]) => Number.isFinite(x) && Number.isFinite(y))) {
                const distToSegment = (p: [number, number], a: [number, number], b: [number, number]): number => {
                    const dx = b[0] - a[0], dy = b[1] - a[1];
                    const lenSq = dx * dx + dy * dy;
                    if (lenSq < 1e-6) return Math.hypot(p[0] - a[0], p[1] - a[1]);
                    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
                    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
                };

                const lineRayIntersect = (p1: [number, number], p2: [number, number], a: [number, number], b: [number, number]): [number, number] | null => {
                    const r = [p2[0] - p1[0], p2[1] - p1[1]];
                    const s = [b[0] - a[0], b[1] - a[1]];
                    const rxs = r[0] * s[1] - r[1] * s[0];
                    if (Math.abs(rxs) < 1e-6) return null;
                    const u = ((a[0] - p1[0]) * r[1] - (a[1] - p1[1]) * r[0]) / rxs;
                    if (u < 0.01 || u > 0.99) return null;
                    return [+(a[0] + u * s[0]).toFixed(2), +(a[1] + u * s[1]).toFixed(2)];
                };

                const edges: [[number, number], [number, number]][] = [
                    [rawTriPts[0], rawTriPts[1]],
                    [rawTriPts[1], rawTriPts[2]],
                    [rawTriPts[2], rawTriPts[0]]
                ];

                layers.forEach((l: any) => {
                    if (l === triPolyLayer) return;
                    const pts = l.points || l.vertices;
                    if (!Array.isArray(pts) || pts.length !== 2) return;

                    const s0: [number, number] = [parseFloat(Array.isArray(pts[0]) ? pts[0][0] : pts[0]?.x), parseFloat(Array.isArray(pts[0]) ? pts[0][1] : pts[0]?.y)];
                    const s1: [number, number] = [parseFloat(Array.isArray(pts[1]) ? pts[1][0] : pts[1]?.x), parseFloat(Array.isArray(pts[1]) ? pts[1][1] : pts[1]?.y)];
                    if (!Number.isFinite(s0[0]) || !Number.isFinite(s0[1]) || !Number.isFinite(s1[0]) || !Number.isFinite(s1[1])) return;

                    const onEdgeIdx0 = edges.findIndex(([ea, eb]) => distToSegment(s0, ea, eb) < 0.25);
                    const onEdgeIdx1 = edges.findIndex(([ea, eb]) => distToSegment(s1, ea, eb) < 0.25);

                    let anchorPt: [number, number] | null = null;
                    let floatPt: [number, number] | null = null;
                    let floatIndex = -1;
                    let anchorEdgeIdx = -1;

                    if (onEdgeIdx0 >= 0 && onEdgeIdx1 === -1) {
                        anchorPt = s0; floatPt = s1; floatIndex = 1; anchorEdgeIdx = onEdgeIdx0;
                    } else if (onEdgeIdx1 >= 0 && onEdgeIdx0 === -1) {
                        anchorPt = s1; floatPt = s0; floatIndex = 0; anchorEdgeIdx = onEdgeIdx1;
                    }

                    if (anchorPt && floatPt && anchorEdgeIdx >= 0) {
                        const segAngle = Math.atan2(floatPt[1] - anchorPt[1], floatPt[0] - anchorPt[0]);
                        const parallelEdgeIdx = edges.findIndex(([ea, eb], idx) => {
                            if (idx === anchorEdgeIdx) return false;
                            const eAngle = Math.atan2(eb[1] - ea[1], eb[0] - ea[0]);
                            const diff = Math.abs((segAngle - eAngle) % Math.PI);
                            return diff < 0.08 || Math.abs(diff - Math.PI) < 0.08;
                        });
                        if (parallelEdgeIdx >= 0) {
                            const targetEdgeIdx = [0, 1, 2].find(idx => idx !== anchorEdgeIdx && idx !== parallelEdgeIdx)!;
                            const snapped = lineRayIntersect(anchorPt, floatPt, edges[targetEdgeIdx][0], edges[targetEdgeIdx][1]);
                            if (snapped) {
                                const oldX = floatPt[0], oldY = floatPt[1];
                                pts[floatIndex] = [snapped[0], snapped[1]];
                                layers.forEach((pl: any) => {
                                    const c = pl.coords || pl.coord || (Array.isArray(pl.points) && pl.points.length === 1 ? pl.points[0] : null);
                                    if (c) {
                                        const cx = parseFloat(Array.isArray(c) ? c[0] : c.x);
                                        const cy = parseFloat(Array.isArray(c) ? c[1] : c.y);
                                        if (Math.hypot(cx - oldX, cy - oldY) < 0.8) {
                                            if (pl.coords) pl.coords = [snapped[0], snapped[1]];
                                            if (pl.coord) pl.coord = [snapped[0], snapped[1]];
                                            if (Array.isArray(pl.points) && pl.points.length === 1) pl.points = [[snapped[0], snapped[1]]];
                                        }
                                    }
                                });
                            }
                        }
                    }
                });
            }
        }

        layers = layers.filter((layer: any) => {
            const lbl = String(layer.label || '').trim().toLowerCase();
            if (lbl.includes('not drawn accurately') || lbl.includes('not to scale')) return false;
            // Suppress 2-to-5 letter vertex-concatenation labels (e.g. "AC", "ABC", "ADE", "CDYX", "BCX")
            // on polygons/lines when individual vertex points are already labeled, preventing "ABC" from rendering at the centroid!
            if (layer.label && /^[A-Z]{2,5}$/.test(String(layer.label).trim())) {
                const chars = String(layer.label).trim().split('');
                if (pointLabelSet.size >= 2 && chars.some(c => pointLabelSet.has(c))) {
                    layer.label = '';
                }
            }
            const pts = layer.points || layer.vertices;
            if (pts && pts.length === 2) {
                const px1 = parseFloat(Array.isArray(pts[0]) ? pts[0][0] : pts[0].x);
                const py1 = parseFloat(Array.isArray(pts[0]) ? pts[0][1] : pts[0].y);
                const px2 = parseFloat(Array.isArray(pts[1]) ? pts[1][0] : pts[1].x);
                const py2 = parseFloat(Array.isArray(pts[1]) ? pts[1][1] : pts[1].y);
                if (px1 === 0 && px2 === 0 && py1 < -5 && py2 > 5) return false;
                if (py1 === 0 && py2 === 0 && px1 < -5 && px2 > 5) return false;
            }
            return true;
        });

        // Auto-inject angle arcs on straight-line angle diagrams (e.g. Question 13) when missing
        const hasArcLayer = layers.some((l: any) => l.shape_name === 'arc' || l.type === 'arc');
        const hasAngleLabel = layers.some((l: any) => {
            const s = String(l.label || '').trim();
            return s.includes('°') || /^\d+\s*[a-z]$/i.test(s);
        });
        if (data.hide_grid && !hasArcLayer && hasAngleLabel) {
            const lineLayers = layers.filter((l: any) =>
                (l.shape_name === 'line' || l.type === 'line' || l.shape_name === 'polyline') &&
                (l.points || l.vertices)?.length === 2
            );
            if (lineLayers.length >= 2) {
                const bPts = lineLayers[0].points || lineLayers[0].vertices;
                const rPts = lineLayers[1].points || lineLayers[1].vertices;
                const bx1 = parseFloat(bPts[0][0]), by1 = parseFloat(bPts[0][1]);
                const bx2 = parseFloat(bPts[1][0]), by2 = parseFloat(bPts[1][1]);
                const rx1 = parseFloat(rPts[0][0]), ry1 = parseFloat(rPts[0][1]);
                const rx2 = parseFloat(rPts[1][0]), ry2 = parseFloat(rPts[1][1]);
                if (Math.abs(by1 - by2) < 1e-3 && Math.abs(ry1 - by1) < 1e-3 && rx1 > Math.min(bx1, bx2) && rx1 < Math.max(bx1, bx2)) {
                    const rayDeg = Math.atan2(ry2 - ry1, rx2 - rx1) * (180 / Math.PI);
                    const arcR = Math.min(Math.abs(bx2 - bx1) * 0.14, Math.hypot(rx2 - rx1, ry2 - ry1) * 0.28);
                    if (rayDeg > 5 && rayDeg < 175 && arcR > 0.2) {
                        layers.push(
                            { shape_name: 'arc', center: [rx1, ry1], radius: arcR * 0.85, start_angle: 0, end_angle: rayDeg, is_open: true, purpose: 'reference' },
                            { shape_name: 'arc', center: [rx1, ry1], radius: arcR, start_angle: rayDeg, end_angle: 180, is_open: true, purpose: 'reference' }
                        );
                    }
                }
            }
        }

        let hasDrawnSomething = false;
        const hasRefLayer = layers.some((l: any) => l.purpose === 'reference');
        const hasSolLayer = layers.some((l: any) => l.purpose === 'solution');
        const useSolutionHighlight = hasRefLayer && hasSolLayer;

        layers.forEach((layer: any) => {
            const rawPoints = layer.points || layer.vertices || (layer.coords ? [layer.coords] : (layer.coord ? [layer.coord] : ((layer.shape_name === 'point' || layer.type === 'point') && layer.center ? [layer.center] : [])));
            const purpose = layer.purpose || (isPureGeometry ? "reference" : (data.purpose || "solution"));
            const isReference = purpose === 'reference';
            const isVector = layer.shape_name === 'vector' || layer.type === 'vector';
            const strokeColor = (useSolutionHighlight && !isReference) ? '#10b981' : 'var(--diagram-foreground)';
            const strokeOpacityAttr = '';
            const fillColor = (isReference && !layer.shaded) ? 'none' : (useSolutionHighlight ? 'rgba(16, 185, 129, 0.14)' : 'rgba(128, 128, 128, 0.15)');

            if (layer.shape_name === 'circle' || layer.type === 'circle') {
                const cx = parseFloat(layer.center ? layer.center[0] : 0);
                const cy = parseFloat(layer.center ? layer.center[1] : 0);
                const r = parseFloat(layer.radius || 1);
                if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r)) {
                    const dashed = layer.dashed ? 'stroke-dasharray="3,3"' : '';
                    layersHtml += `<circle cx="${cx}" cy="${-cy}" r="${r}" fill="${fillColor}" stroke="${strokeColor}" ${strokeOpacityAttr} stroke-width="${isReference ? 0.4 : 0.3}" ${dashed} vector-effect="non-scaling-stroke" />`;
                    hasDrawnSomething = true;
                }
                return;
            }

            if (layer.shape_name === 'arc' || layer.type === 'arc') {
                const cx = parseFloat(layer.center ? layer.center[0] : 0);
                const cy = parseFloat(layer.center ? layer.center[1] : 0);
                const r = Math.abs(parseFloat(layer.radius || 1));
                const startAngle = parseFloat(layer.start_angle ?? 0);
                const endAngle = parseFloat(layer.end_angle ?? 180);

                if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r)) {
                    const startRad = startAngle * (Math.PI / 180);
                    const endRad = endAngle * (Math.PI / 180);
                    const sx = cx + r * Math.cos(startRad);
                    const sy = cy + r * Math.sin(startRad);
                    const ex = cx + r * Math.cos(endRad);
                    const ey = cy + r * Math.sin(endRad);

                    let ad = (endAngle - startAngle) % 360;
                    if (ad < 0) ad += 360;
                    const largeArcFlag = ad > 180 ? 1 : 0;

                    let d = `M ${sx} ${-sy} A ${r} ${r} 0 ${largeArcFlag} 0 ${ex} ${-ey}`;
                    const isClosedSector = Boolean(layer.closed || layer.shape_name === 'sector');
                    if (isClosedSector) d += ' Z';

                    const dashed = layer.dashed ? 'stroke-dasharray="3,3"' : '';
                    layersHtml += `<path d="${d}" fill="${isClosedSector ? fillColor : 'none'}" stroke="${strokeColor}" ${strokeOpacityAttr} stroke-width="${isReference ? 0.35 : 0.3}" ${dashed} vector-effect="non-scaling-stroke" />`;
                    hasDrawnSomething = true;
                }
                return;
            }

            if (rawPoints.length > 0) {
                const parsedPts: [number, number][] = rawPoints.map((p: any) => [
                    parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0)),
                    parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0))
                ]);

                if (parsedPts.some(([px, py]) => !Number.isFinite(px) || !Number.isFinite(py))) return;

                const isSinglePoint = rawPoints.length === 1 || layer.shape_name === 'point' || layer.type === 'point' || layer.shape_name === 'label' || layer.type === 'label';
                const isOpen = !isSinglePoint && (layer.is_open || isVector || layer.type === 'polyline' || layer.shape_name === 'polyline' || layer.shape_name === 'line_path' || layer.shape_name === 'line');

                const labelStr = String(layer.label || '').trim();
                const isTextOnlyLabel = layer.shape_name === 'label' || layer.shape_name === 'text' || layer.type === 'label' ||
                    labelStr.includes('°') ||
                    /^\d+\s*[a-zA-Z]+$/.test(labelStr) ||
                    (labelStr.length > 2 && !labelStr.startsWith('('));

                const isVertexLetter = /^[A-Z]'?$/.test(labelStr);

                if (isSinglePoint) {
                    if (!isTextOnlyLabel && !layer.hide_dot && !(isPureGeometry && isVertexLetter)) {
                        const [px, py] = parsedPts[0];
                        layersHtml += `<circle cx="${px}" cy="${-py}" r="${pointRadius}" fill="${strokeColor}" />`;
                    }
                } else {
                    const pts = parsedPts.map(([px, py]) => `${px},${-py}`).join(' ');
                    const tag = isOpen ? 'polyline' : 'polygon';
                    const dashedStyle = layer.dashed ? 'stroke-dasharray="3,3"' : '';
                    const baseWidth = layer.stroke_width || (isVector ? 0.5 : (isReference ? 0.45 : 0.35));
                    const markerAttr = isVector ? 'marker-end="url(#vector-arrow)"' : '';

                    layersHtml += `<${tag} points="${pts}" fill="${isOpen ? 'none' : fillColor}" stroke="${strokeColor}" ${strokeOpacityAttr} stroke-width="${baseWidth}" ${dashedStyle} ${markerAttr} vector-effect="non-scaling-stroke" />`;
                }

                let hasLocalVertexLabels = false;
                rawPoints.forEach((p: any) => {
                    const vLabel = Array.isArray(p) ? p[2] : p.label;
                    if (vLabel) {
                        const vx = parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0));
                        const vy = parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0));
                        if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
                        const coordKey = `${Math.round(vx * 2) / 2},${Math.round(vy * 2) / 2}`;

                        if (!DiagramService.renderedGlobalLabels.has(coordKey)) {
                            layersHtml += `<text x="${vx}" y="${-vy - 0.45 * u}" font-size="${vertexFontSize}" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${vLabel}</text>`;
                            DiagramService.renderedGlobalLabels.add(coordKey);
                            hasLocalVertexLabels = true;
                        }
                    }
                });

                if (layer.label && !hasLocalVertexLabels) {
                    let lx = parsedPts[0][0];
                    let ly = parsedPts[0][1];
                    let textAnchor = "middle";
                    let dominantBaseline = "auto";

                    if (!isSinglePoint && !isOpen && parsedPts.length >= 3) {
                        // Closed polygon: place label at the polygon centroid
                        let uniquePts = parsedPts;
                        if (parsedPts.length > 3 &&
                            Math.abs(parsedPts[0][0] - parsedPts[parsedPts.length - 1][0]) < 1e-6 &&
                            Math.abs(parsedPts[0][1] - parsedPts[parsedPts.length - 1][1]) < 1e-6) {
                            uniquePts = parsedPts.slice(0, -1);
                        }
                        lx = uniquePts.reduce((sum, pt) => sum + pt[0], 0) / uniquePts.length;
                        ly = uniquePts.reduce((sum, pt) => sum + pt[1], 0) / uniquePts.length;
                        dominantBaseline = "middle";
                    } else if (isOpen && parsedPts.length >= 2) {
                        // Line / Vector: place label above the midpoint
                        lx = (parsedPts[0][0] + parsedPts[1][0]) / 2;
                        ly = (parsedPts[0][1] + parsedPts[1][1]) / 2 + 0.35 * u;
                    } else if (isSinglePoint) {
                        if (Array.isArray(layer.label_offset) && layer.label_offset.length === 2) {
                            lx += Number(layer.label_offset[0]) || 0;
                            ly += Number(layer.label_offset[1]) || 0;
                        } else if (isPureGeometry && isVertexLetter) {
                            // Generic Outward-Normal Vertex Offset:
                            // Find all incident segments meeting at (lx, ly) and push the label in the opposite direction
                            let sumDx = 0, sumDy = 0, incidentCount = 0;
                            layers.forEach((other: any) => {
                                const oPts = other.points || other.vertices;
                                if (!Array.isArray(oPts) || oPts.length < 2) return;
                                const parsed: [number, number][] = oPts.map((p: any) => [
                                    parseFloat(Array.isArray(p) ? p[0] : p?.x),
                                    parseFloat(Array.isArray(p) ? p[1] : p?.y)
                                ]);
                                const isClosed = !other.is_open && (other.shape_name === 'polygon' || other.type === 'polygon');
                                for (let i = 0; i < parsed.length; i++) {
                                    if (Math.hypot(parsed[i][0] - lx, parsed[i][1] - ly) < 0.15) {
                                        const neighbors: [number, number][] = [];
                                        if (i > 0) neighbors.push(parsed[i - 1]);
                                        else if (isClosed) neighbors.push(parsed[parsed.length - 1]);
                                        if (i < parsed.length - 1) neighbors.push(parsed[i + 1]);
                                        else if (isClosed) neighbors.push(parsed[0]);

                                        neighbors.forEach(([nx, ny]) => {
                                            const dist = Math.hypot(nx - lx, ny - ly);
                                            if (dist > 1e-3) {
                                                sumDx += (nx - lx) / dist;
                                                sumDy += (ny - ly) / dist;
                                                incidentCount++;
                                            }
                                        });
                                    }
                                }
                            });

                            const offsetDist = 0.65 * u;
                            if (incidentCount > 0 && Math.hypot(sumDx, sumDy) > 1e-2) {
                                const norm = Math.hypot(sumDx, sumDy);
                                lx -= (sumDx / norm) * offsetDist;
                                ly -= (sumDy / norm) * offsetDist;
                            } else {
                                // Fallback: push away from figure centroid
                                const cx = (minX + maxX) / 2;
                                const cy = (minY + maxY) / 2;
                                const dCent = Math.hypot(lx - cx, ly - cy) || 1;
                                lx += ((lx - cx) / dCent) * offsetDist;
                                ly += ((ly - cy) / dCent) * offsetDist;
                            }
                        } else if (!isTextOnlyLabel) {
                            if (lx - xMin < width * 0.3) {
                                lx += pointRadius * 1.8;
                                textAnchor = "start";
                            } else if (xMax - lx < width * 0.3) {
                                lx -= pointRadius * 1.8;
                                textAnchor = "end";
                            } else {
                                ly -= 0.45 * u;
                            }
                        }
                        dominantBaseline = "middle";
                    }

                    // Edge-clipping guard for non-point labels near left/right grid boundaries
                    if (textAnchor === "middle") {
                        if (lx - xMin < width * 0.18) textAnchor = "start";
                        else if (xMax - lx < width * 0.18) textAnchor = "end";
                    }

                    let labelKey = `${Math.round(lx * 2) / 2},${Math.round(ly * 2) / 2}`;
                    if (DiagramService.renderedGlobalLabels.has(labelKey)) {
                        ly += 0.55 * u;
                        labelKey = `${Math.round(lx * 2) / 2},${Math.round(ly * 2) / 2}`;
                    }

                    layersHtml += `<text x="${lx}" y="${-ly}" font-size="${labelFontSize}" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="${textAnchor}" dominant-baseline="${dominantBaseline}">${layer.label}</text>`;
                    DiagramService.renderedGlobalLabels.add(labelKey);
                }
                hasDrawnSomething = true;
            }
        });

        if (!hasDrawnSomething) {
            return this.renderFallbackBox(data.details || data.description || "Grid/Axis Reference (No shapes provided)");
        }

        return this.wrapSVG(xMin - pad, -yMax - pad, width + pad * 2, height + pad * 2, layersHtml);
    }

    /**
     * Draws Probability Tree Diagrams
     */
    private static drawTreeDiagram(data: any): string {
        let html = '';
        let initialBranches = data.branches || data.children || [];

        // Determine root value (either explicit data.root_value / data.root_label, or sum of top-level branch values for frequency trees)
        let rootDisplayVal = data.root_value ?? data.root_label ?? '';
        if (!rootDisplayVal && Array.isArray(initialBranches) && initialBranches.length > 1) {
            const topVals = initialBranches.map((b: any) => Number(b.value ?? b.prob)).filter(v => Number.isFinite(v) && v > 1);
            if (topVals.length === initialBranches.length) {
                rootDisplayVal = String(topVals.reduce((a, b) => a + b, 0));
            }
        }
        const rootNodeId = rootDisplayVal ? `Root_${rootDisplayVal}` : 'Start';

        const flattenTree = (node: any, fromId: string = rootNodeId): any[] => {
            const children = node.children || node.branches || [];
            if (!Array.isArray(children) || children.length === 0) return [];
            return children.flatMap((child: any, idx: number) => {
                const rawLabel = child.label || child.text || child.split || `Node_${idx}`;
                // Make node ID unique per parent path so "Year 10 -> Medal" and "Year 11 -> Medal" never collide!
                const uniqueToId = `${fromId}__${rawLabel}`;
                const flatBranch = {
                    from: fromId,
                    to: uniqueToId,
                    displayLabel: rawLabel,
                    prob: child.prob ?? child.value ?? ''
                };
                return [flatBranch, ...flattenTree(child, uniqueToId)];
            });
        };

        let branches = initialBranches;
        if (branches.length === 1 && (branches[0].children || branches[0].branches)) {
            const singleRootId = String(branches[0].label || branches[0].value || rootNodeId);
            branches = flattenTree(branches[0], singleRootId);
        } else if (branches.length > 0 && (branches[0].children || branches[0].branches)) {
            branches = branches.flatMap((b: any, idx: number) => {
                const rawLabel = b.split || b.label || `Branch_${idx}`;
                const uniqueToId = `${rootNodeId}__${rawLabel}`;
                return [
                    { from: rootNodeId, to: uniqueToId, displayLabel: rawLabel, prob: b.value ?? b.prob ?? '' },
                    ...flattenTree(b, uniqueToId)
                ];
            });
        }

        // Populate missing branch values from adjacent <div class="model_answer"> text if available
        if (data._answerText && branches.some((b: any) => !b.prob || String(b.prob).trim() === '')) {
            const plainAns = String(data._answerText)
                .replace(/<span[^>]*class=["']marking-code["'][^>]*>[\s\S]*?<\/span>/gi, '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\$/g, '');
            const ansLines = plainAns.split('\n').map(l => l.trim()).filter(Boolean);

            branches.forEach((b: any) => {
                if (b.prob && String(b.prob).trim() !== '') return;
                const pathParts = String(b.to || '')
                    .split('__')
                    .filter(p => p && !p.startsWith('Root_') && p !== 'Start');
                if (pathParts.length === 0) return;

                for (const line of ansLines) {
                    const eqIdx = line.indexOf('=');
                    if (eqIdx === -1) continue;
                    const lhs = line.slice(0, eqIdx).toLowerCase();
                    const rhsMatches = line.slice(eqIdx + 1).match(/(\d+(?:\.\d+)?)/g);
                    if (!rhsMatches || rhsMatches.length === 0) continue;
                    const finalNum = rhsMatches[rhsMatches.length - 1];

                    // Match all path segments on the LHS, ensuring "Medal" doesn't match "No medal"
                    const allMatched = pathParts.every(part => {
                        const pLow = part.toLowerCase().trim();
                        if (!lhs.includes(pLow)) return false;
                        if (!pLow.startsWith('no ') && lhs.includes(`no ${pLow}`)) return false;
                        return true;
                    });
                    if (allMatched) {
                        // Ensure a level-1 node ("Year 10") doesn't match a level-2 line ("Year 10 Medal = 52")
                        if (pathParts.length === 1 && (lhs.includes('medal') || lhs.includes('pass') || lhs.includes('win') || lhs.includes('yes') || lhs.includes('no '))) {
                            continue;
                        }
                        b.prob = finalNum;
                        break;
                    }
                }
            });
        }

        // [v9.99] Auto-detect frequency tree vs probability tree
        // Route to drawFrequencyTree if root_value is present, is_frequency is set, or values are integers > 1
        const isHz = Boolean(data.is_frequency) || data.type === 'frequency_tree' || Boolean(data.root_value) || Boolean(data.root_label) ||
            branches.some((b: any) => b.prob && parseInt(String(b.prob)) > 1 && !String(b.prob).includes('/'));

        if (isHz && branches.length > 0) {
            return this.drawFrequencyTree({ branches, headers: data.headers });
        }

        const xStep = 30;
        const yStep = 20;
        const positions: Record<string, { x: number, y: number }> = { "Start": { x: 0, y: 0 } };

        let levelCounts: Record<number, number> = { 0: 1 };

        branches.forEach((b: any) => {
            const from = b.from || "Start";
            const to = b.to || "End";

            if (!positions[from]) {
                positions[from] = { x: 0, y: 0 };
            }

            if (!positions[to]) {
                const parent = positions[from];
                const level = Math.round(parent.x / xStep) + 1;
                levelCounts[level] = (levelCounts[level] || 0) + 1;
                positions[to] = {
                    x: parent.x + xStep,
                    y: (levelCounts[level] - 2.5) * yStep
                };
            }
            const p1 = positions[from];
            const p2 = positions[to];
            const displayLabel = b.displayLabel || to.split('__').pop() || to;
            html += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="var(--diagram-foreground)" stroke-width="0.5" />`;
            html += `<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 2}" font-size="1.8" text-anchor="middle" fill="var(--diagram-foreground)">${b.prob}</text>`;
            html += `<text x="${p2.x + 2}" y="${p2.y + 1}" font-size="1.8" fill="var(--diagram-foreground)">${displayLabel}</text>`;
        });

        // If no branches rendered, fallback
        if (!html) return this.renderFallbackBox(data.description || "Tree Diagram");

        return this.wrapSVG(-5, -30, 80, 60, html);
    }

    /**
     * [v9.99] Dedicated Frequency Tree Renderer (Ovals, Column Headers, Exam-style layout)
     */
    private static drawFrequencyTree(data: any): string {
        try {
            const branches: any[] = Array.isArray(data) ? data : (data.branches || []);
            const headers: string[] = data.headers || [];

            // 1. Build Node Graph
            const nodes: Record<string, { id: string, label: string, displayLabel?: string, val: string, level: number, children: string[], parent: string | null }> = {};

            // Find root(s)
            const toSet = new Set(branches.map(b => b.to));
            const rootId = branches[0].from || "Start";

            nodes[rootId] = { id: rootId, label: rootId, displayLabel: rootId.replace(/^Root_/, ''), val: "", level: 0, children: [], parent: null };

            branches.forEach(b => {
                const p = b.from || rootId;
                const c = b.to;
                const dispLabel = b.displayLabel || b.to.split('__').pop() || b.to;
                if (!nodes[p]) nodes[p] = { id: p, label: p, displayLabel: p.replace(/^Root_/, ''), val: "", level: 0, children: [], parent: null };
                if (!nodes[c]) nodes[c] = { id: c, label: c, displayLabel: dispLabel, val: String(b.prob || ""), level: nodes[p].level + 1, children: [], parent: p };
                if (!nodes[p].children.includes(c)) nodes[p].children.push(c);
            });

            // Re-calculate levels cleanly from root down
            const calcLevel = (id: string, lvl: number) => {
                if (nodes[id]) {
                    nodes[id].level = lvl;
                    nodes[id].children.forEach(cid => calcLevel(cid, lvl + 1));
                }
            };
            calcLevel(rootId, 0);

            // 2. Position Nodes
            const xStep = 60; // Wide spacing for ovals
            const yStep = 25; // Vertical spacing between leaves
            const positions: Record<string, { x: number, y: number }> = {};

            // Assign Y to leaves first, then center parents
            // Note: assignLeafY visits children in their exact top-to-bottom branch order
            let currentY = 0;
            const assignLeafY = (id: string) => {
                const node = nodes[id];
                if (!node) return;
                if (node.children.length === 0) {
                    positions[id] = { x: node.level * xStep, y: currentY };
                    currentY += yStep;
                } else {
                    node.children.forEach(cid => assignLeafY(cid));
                    // Parent Y is average of children Y
                    const childrenY = node.children.map(cid => positions[cid]?.y ?? 0);
                    const avgY = childrenY.reduce((a, b) => a + b, 0) / childrenY.length;
                    positions[id] = { x: node.level * xStep, y: avgY };
                }
            };
            assignLeafY(rootId);

            // 3. Draw
            let html = '';
            const rx = 16;
            const ry = 9;

            // Draw Lines and Labels first (under ovals)
            branches.forEach(b => {
                const p1 = positions[b.from || rootId];
                const p2 = positions[b.to];
                if (!p1 || !p2) return;

                // Line from edge of parent to edge of child
                html += `<line x1="${p1.x + rx}" y1="${p1.y}" x2="${p2.x - rx}" y2="${p2.y}" stroke="var(--diagram-foreground)" stroke-width="0.5" />`;

                // Branch label (e.g. "Children", "Left") midway
                const mx = (p1.x + rx + p2.x - rx) / 2;
                const my = (p1.y + p2.y) / 2;
                // Parse out disambiguation e.g. "Left (C)" -> "Left"
                const cleanLabel = (b.displayLabel || b.to.split('__').pop() || '').replace(/\s*\([^)]*\)$/, '');
                html += `<text x="${mx}" y="${my - 2}" font-size="2.6" fill="var(--diagram-foreground)" text-anchor="middle">${cleanLabel}</text>`;
            });

            // Draw Ovals & Values
            Object.values(nodes).forEach(node => {
                const p = positions[node.id];
                if (!p) return;
                html += `<ellipse cx="${p.x}" cy="${p.y}" rx="${rx}" ry="${ry}" fill="transparent" stroke="var(--diagram-foreground)" stroke-width="0.5" />`;

                let displayVal = node.val;
                if (node.id === rootId && !displayVal) {
                    const match = String(node.label).match(/\d+/);
                    if (match) {
                        displayVal = match[0];
                    } else {
                        // Sum level-1 children values if numeric
                        const childSum = node.children
                            .map(cid => Number(nodes[cid]?.val))
                            .filter(v => Number.isFinite(v) && v > 0);
                        if (childSum.length > 0 && childSum.length === node.children.length) {
                            displayVal = String(childSum.reduce((a, b) => a + b, 0));
                        }
                    }
                }
                if (displayVal) {
                    html += `<text x="${p.x}" y="${p.y + 1.2}" font-size="3.5" fill="var(--diagram-foreground)" text-anchor="middle">${displayVal}</text>`;
                }
            });

            // 4. Bounding box & Headers
            const allX = Object.values(positions).map(p => p.x);
            const allY = Object.values(positions).map(p => p.y);
            let minX = Math.min(...allX) - rx - 5;
            const maxX = Math.max(...allX) + rx + 5;
            let minY = Math.min(...allY) - ry - 10;
            const maxY = Math.max(...allY) + ry + 5;

            // Render headers if available
            if (headers.length > 0) {
                minY -= 15; // Make room at the top
                headers.forEach((h, i) => {
                    const hx = i * xStep;
                    html += `<text x="${hx}" y="${minY + 8}" font-size="3.5" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle">${h}</text>`;
                });
            }

            return this.wrapSVG(minX, minY, maxX - minX, maxY - minY, html);

        } catch (e) {
            console.error("FreqTree error:", e);
            return this.renderFallbackBox("Frequency Tree");
        }
    }

    /**
     * Deterministically recovers a coordinate_grid JSON object from a natural language [Diagram: ...] hint
     * whenever the LLM returns a fallback or empty layers for a grid with explicit (x, y) coordinates.
     */
    private static recoverCoordinateGridFromHint(hint: string): any | null {
        try {
            const xRangeMatch = hint.match(/x(?:-axis)?\s+(?:ranging\s+)?from\s+(?:x\s*=\s*)?(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i);
            const yRangeMatch = hint.match(/y(?:-axis)?\s+(?:ranging\s+)?from\s+(?:y\s*=\s*)?(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i);

            const x_min = xRangeMatch ? parseFloat(xRangeMatch[1]) : -7;
            const x_max = xRangeMatch ? parseFloat(xRangeMatch[2]) : 7;
            const y_min = yRangeMatch ? parseFloat(yRangeMatch[1]) : -7;
            const y_max = yRangeMatch ? parseFloat(yRangeMatch[2]) : 7;

            const parseCoordList = (str: string): [number, number][] =>
                Array.from(str.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g))
                    .map(m => [parseFloat(m[1]), parseFloat(m[2])] as [number, number]);

            const layers: any[] = [];

            // Check for named shapes: "Shape A is ... vertices at (...) ... Shape B is ... vertices at (...)"
            const shapeSegments = Array.from(hint.matchAll(/Shape\s+([A-Z])\s+is\s+[^.]*?\s+vertices\s+at\s+([^.]+(?:\.[^.]+)*?)(?=Shape\s+[A-Z]|$)/gi));
            if (shapeSegments.length > 0) {
                shapeSegments.forEach(seg => {
                    const label = seg[1].toUpperCase();
                    const pts = parseCoordList(seg[2]);
                    if (pts.length >= 3) {
                        layers.push({ shape_name: 'polygon', purpose: 'reference', label, points: pts });
                    }
                });
            } else if (/curve/i.test(hint)) {
                const pts = parseCoordList(hint);
                if (pts.length >= 3) {
                    layers.push({ shape_name: 'curve', purpose: 'reference', smooth: true, points: pts });
                }
            } else {
                const pts = parseCoordList(hint);
                if (pts.length >= 3) {
                    layers.push({ shape_name: 'polygon', purpose: 'reference', points: pts });
                }
            }

            if (layers.length === 0) return null;
            return {
                type: 'coordinate_grid',
                purpose: 'reference',
                show_axes: true,
                x_min,
                x_max,
                y_min,
                y_max,
                _rawHint: hint,
                layers
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Renders non-uniform scale scientific/empirical Cartesian graphs (e.g., Q12 Velocity-Time graph
     * where x is 0..6 and y is 0..60) into a proportional exam-style grid with millimeter subdivisions,
     * smooth Catmull-Rom cubic Bezier curves through data points, viewport clipping, and external axis titles.
     */
    private static drawNormalizedCartesianGraph(data: any): string {
        const layers: any[] = Array.isArray(data.layers) ? data.layers : (Array.isArray(data.shapes) ? data.shapes : []);

        // Separate reference curve points from extrapolated solution lines (e.g. tangent lines that shoot up to y = 72)
        const refPts: [number, number][] = [];
        const allPts: [number, number][] = [];
        layers.forEach((l: any) => {
            const pts = l.points || l.vertices || (l.coords ? [l.coords] : (l.coord ? [l.coord] : []));
            if (Array.isArray(pts)) {
                const isSolLine = l.purpose === 'solution' || l.dashed === true || pts.length === 2;
                pts.forEach((p: any) => {
                    const px = parseFloat(Array.isArray(p) ? p[0] : p?.x);
                    const py = parseFloat(Array.isArray(p) ? p[1] : p?.y);
                    if (Number.isFinite(px) && Number.isFinite(py)) {
                        allPts.push([px, py]);
                        if (!isSolLine) refPts.push([px, py]);
                    }
                });
            }
        });

        const boundPts = refPts.length >= 3 ? refPts : allPts;
        const minPtX = boundPts.length > 0 ? Math.min(...boundPts.map(p => p[0])) : 0;
        const maxPtX = boundPts.length > 0 ? Math.max(...boundPts.map(p => p[0])) : 6;
        const minPtY = boundPts.length > 0 ? Math.min(...boundPts.map(p => p[1])) : 0;
        const maxPtY = boundPts.length > 0 ? Math.max(...boundPts.map(p => p[1])) : 60;

        // Parse explicit bounds from _rawHint if LLM omitted x_min/x_max/y_min/y_max or left default -6..6
        const hintStr = String(data._rawHint || data._qContext || '');
        const xHintMatch = hintStr.match(/x-axis\s+ranging\s+from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i);
        const yHintMatch = hintStr.match(/y-axis\s+ranging\s+from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i);

        let xMin = xHintMatch ? parseFloat(xHintMatch[1]) : (Number.isFinite(parseFloat(data.x_min)) && parseFloat(data.x_min) >= 0 ? parseFloat(data.x_min) : Math.min(0, minPtX));
        let xMax = xHintMatch ? parseFloat(xHintMatch[2]) : (Number.isFinite(parseFloat(data.x_max)) && parseFloat(data.x_max) >= maxPtX ? parseFloat(data.x_max) : maxPtX);
        let yMin = yHintMatch ? parseFloat(yHintMatch[1]) : (Number.isFinite(parseFloat(data.y_min)) && parseFloat(data.y_min) >= 0 ? parseFloat(data.y_min) : Math.min(0, minPtY));
        let yMax = yHintMatch ? parseFloat(yHintMatch[2]) : (Number.isFinite(parseFloat(data.y_max)) && parseFloat(data.y_max) >= maxPtY ? parseFloat(data.y_max) : maxPtY);

        const getNiceStep = (span: number): number => {
            if (span <= 6.5) return 1;
            if (span <= 13) return 2;
            if (span <= 32) return 5;
            if (span <= 75) return 10;
            if (span <= 150) return 20;
            return Math.ceil(span / 6 / 10) * 10;
        };

        const xStep = (Number.isFinite(parseFloat(data.x_step)) && parseFloat(data.x_step) > 0) ? parseFloat(data.x_step) : getNiceStep(Math.max(1e-3, xMax - xMin));
        const yStep = (Number.isFinite(parseFloat(data.y_step)) && parseFloat(data.y_step) > 0) ? parseFloat(data.y_step) : getNiceStep(Math.max(1e-3, yMax - yMin));

        // Universal Axis Top-Tick Snapping (e.g. 65 -> 60 or 72 -> 60 when reference curve max is 60 and step is 10)
        const snappedXMax = Math.floor(xMax / xStep) * xStep;
        if (snappedXMax > xMin && xMax > snappedXMax && maxPtX <= snappedXMax + 1e-3) {
            xMax = snappedXMax;
        }
        const snappedYMax = Math.floor(yMax / yStep) * yStep;
        if (snappedYMax > yMin && yMax > snappedYMax && maxPtY <= snappedYMax + 1e-3) {
            yMax = snappedYMax;
        }

        const xSpan = Math.max(1e-3, xMax - xMin);
        const ySpan = Math.max(1e-3, yMax - yMin);

        const VIEW_W = 160;
        const VIEW_H = 160;
        const LEFT_PAD = 32;
        const RIGHT_PAD = 14;
        const TOP_PAD = 12;
        const BOTTOM_PAD = 28;

        const mapX = (x: number) => LEFT_PAD + ((x - xMin) / xSpan) * VIEW_W;
        const mapY = (y: number) => TOP_PAD + VIEW_H - ((y - yMin) / ySpan) * VIEW_H;

        const clipId = `norm-grid-clip-${Math.round(xMax * 100)}-${Math.round(yMax * 100)}`;
        let svg = `<defs><clipPath id="${clipId}"><rect x="${LEFT_PAD}" y="${TOP_PAD}" width="${VIEW_W}" height="${VIEW_H}" /></clipPath></defs>`;

        // 1. Fine Millimeter Sub-Gridlines (5 subdivisions per major step)
        const xMinor = xStep / 5;
        const yMinor = yStep / 5;
        for (let x = xMin; x <= xMax + 1e-6; x += xMinor) {
            const sx = +mapX(x).toFixed(2);
            svg += `<line x1="${sx}" y1="${TOP_PAD}" x2="${sx}" y2="${TOP_PAD + VIEW_H}" stroke="var(--diagram-grid)" stroke-width="0.2" opacity="0.32" vector-effect="non-scaling-stroke" />`;
        }
        for (let y = yMin; y <= yMax + 1e-6; y += yMinor) {
            const sy = +mapY(y).toFixed(2);
            svg += `<line x1="${LEFT_PAD}" y1="${sy}" x2="${LEFT_PAD + VIEW_W}" y2="${sy}" stroke="var(--diagram-grid)" stroke-width="0.2" opacity="0.32" vector-effect="non-scaling-stroke" />`;
        }

        // 2. Major Gridlines & Tick Labels
        for (let x = xMin; x <= xMax + 1e-6; x += xStep) {
            const sx = +mapX(x).toFixed(2);
            svg += `<line x1="${sx}" y1="${TOP_PAD}" x2="${sx}" y2="${TOP_PAD + VIEW_H}" stroke="var(--diagram-grid)" stroke-width="0.45" opacity="0.75" vector-effect="non-scaling-stroke" />`;
            svg += `<line x1="${sx}" y1="${TOP_PAD + VIEW_H}" x2="${sx}" y2="${TOP_PAD + VIEW_H + 2.5}" stroke="var(--diagram-foreground)" stroke-width="0.6" vector-effect="non-scaling-stroke" />`;
            svg += `<text x="${sx}" y="${TOP_PAD + VIEW_H + 8}" font-size="5" fill="var(--diagram-foreground)" text-anchor="middle">${Math.round(x * 100) / 100}</text>`;
        }
        for (let y = yMin; y <= yMax + 1e-6; y += yStep) {
            const sy = +mapY(y).toFixed(2);
            svg += `<line x1="${LEFT_PAD}" y1="${sy}" x2="${LEFT_PAD + VIEW_W}" y2="${sy}" stroke="var(--diagram-grid)" stroke-width="0.45" opacity="0.75" vector-effect="non-scaling-stroke" />`;
            svg += `<line x1="${LEFT_PAD - 2.5}" y1="${sy}" x2="${LEFT_PAD}" y2="${sy}" stroke="var(--diagram-foreground)" stroke-width="0.6" vector-effect="non-scaling-stroke" />`;
            svg += `<text x="${LEFT_PAD - 4}" y="${sy + 1.6}" font-size="5" fill="var(--diagram-foreground)" text-anchor="end">${Math.round(y * 100) / 100}</text>`;
        }

        // 3. Axes with Arrowheads
        svg += `
            <line x1="${LEFT_PAD}" y1="${TOP_PAD + VIEW_H}" x2="${LEFT_PAD}" y2="${TOP_PAD - 6}" stroke="var(--diagram-foreground)" stroke-width="0.9" vector-effect="non-scaling-stroke" />
            <polygon points="${LEFT_PAD},${TOP_PAD - 8} ${LEFT_PAD - 2.2},${TOP_PAD - 3.5} ${LEFT_PAD + 2.2},${TOP_PAD - 3.5}" fill="var(--diagram-foreground)" />
            <line x1="${LEFT_PAD}" y1="${TOP_PAD + VIEW_H}" x2="${LEFT_PAD + VIEW_W + 6}" y2="${TOP_PAD + VIEW_H}" stroke="var(--diagram-foreground)" stroke-width="0.9" vector-effect="non-scaling-stroke" />
            <polygon points="${LEFT_PAD + VIEW_W + 8},${TOP_PAD + VIEW_H} ${LEFT_PAD + VIEW_W + 3.5},${TOP_PAD + VIEW_H - 2.2} ${LEFT_PAD + VIEW_W + 3.5},${TOP_PAD + VIEW_H + 2.2}" fill="var(--diagram-foreground)" />
        `;

        const buildSmoothPath = (pts: [number, number][]): string => {
            if (pts.length === 0) return '';
            if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
            if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`;
            let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[Math.max(0, i - 1)];
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const p3 = pts[Math.min(pts.length - 1, i + 2)];
                const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
                const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
                const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
                const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
                d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
            }
            return d;
        };

        // 4. Render Layers (Smooth Curves, Lines, Points)
        let xTitle = data.x_label || data.x_axis_label || '';
        let yTitle = data.y_label || data.y_axis_label || '';

        if (!yTitle && /showing\s+([^']+?)\s+on\s+the\s+vertical\s+y-axis/i.test(hintStr)) {
            yTitle = hintStr.match(/showing\s+([^']+?)\s+on\s+the\s+vertical\s+y-axis/i)![1].trim();
        }
        if (!xTitle && /against\s+([^']+?)\s+on\s+the\s+horizontal\s+x-axis/i.test(hintStr)) {
            xTitle = hintStr.match(/against\s+([^']+?)\s+on\s+the\s+horizontal\s+x-axis/i)![1].trim();
        }

        layers.forEach((layer: any) => {
            const lbl = String(layer.label || '').trim();
            if (/time|seconds/i.test(lbl) && !xTitle) { xTitle = lbl; return; }
            if (/velocity|m\/s|frequency/i.test(lbl) && !yTitle) { yTitle = lbl; return; }
            if (/^t\s*=\s*\d+/i.test(lbl)) return; // Suppress floating "t = 3" label in middle of curve

            const rawPts = layer.points || layer.vertices || (layer.coords ? [layer.coords] : (layer.coord ? [layer.coord] : []));
            if (!Array.isArray(rawPts) || rawPts.length === 0) return;

            const screenPts: [number, number][] = rawPts
                .map((p: any) => [
                    parseFloat(Array.isArray(p) ? p[0] : p?.x),
                    parseFloat(Array.isArray(p) ? p[1] : p?.y)
                ] as [number, number])
                .filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py))
                .map(([px, py]) => [mapX(px), mapY(py)]);

            if (screenPts.length === 0) return;

            const isSolution = layer.purpose === 'solution' || layer.dashed === true;
            const strokeColor = isSolution ? '#10b981' : 'var(--diagram-foreground)';
            const dashed = layer.dashed ? 'stroke-dasharray="4,3"' : '';

            if (screenPts.length >= 4 && (layer.shape_name === 'curve' || layer.smooth !== false)) {
                const pathD = buildSmoothPath(screenPts);
                svg += `<path d="${pathD}" clip-path="url(#${clipId})" fill="none" stroke="${strokeColor}" stroke-width="1.2" ${dashed} vector-effect="non-scaling-stroke" />`;
            } else if (screenPts.length >= 2) {
                const ptsStr = screenPts.map(([sx, sy]) => `${sx.toFixed(2)},${sy.toFixed(2)}`).join(' ');
                const tag = (layer.shape_name === 'polygon' && !layer.is_open) ? 'polygon' : 'polyline';
                const fill = tag === 'polygon' ? (isSolution ? 'rgba(16, 185, 129, 0.14)' : 'rgba(128, 128, 128, 0.15)') : 'none';
                svg += `<${tag} points="${ptsStr}" clip-path="url(#${clipId})" fill="${fill}" stroke="${strokeColor}" stroke-width="1.1" ${dashed} vector-effect="non-scaling-stroke" />`;
            } else if (screenPts.length === 1 && lbl) {
                const [sx, sy] = screenPts[0];
                svg += `<text x="${sx.toFixed(2)}" y="${(sy - 4).toFixed(2)}" font-size="5" fill="${strokeColor}" font-weight="bold" text-anchor="middle">${lbl}</text>`;
            }
        });

        // 5. Render Axis Titles Outside the Grid
        if (xTitle) {
            svg += `<text x="${LEFT_PAD + VIEW_W / 2}" y="${TOP_PAD + VIEW_H + 21}" font-size="5.6" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle">${xTitle}</text>`;
        }
        if (yTitle) {
            const cy = TOP_PAD + VIEW_H / 2;
            svg += `<text x="9" y="${cy}" font-size="5.6" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle" transform="rotate(-90 9 ${cy})">${yTitle}</text>`;
        }

        return this.wrapSVG(0, 0, LEFT_PAD + VIEW_W + RIGHT_PAD, TOP_PAD + VIEW_H + BOTTOM_PAD, svg);
    }

    /**
     * Draws an unequal-width GCSE Histogram with continuous x-axis intervals,
     * Frequency Density y-axis, minor gridlines, and shaded interval bars.
     */
    private static drawHistogram(data: any): string {
        const rawBars: any[] = Array.isArray(data.bars) ? data.bars : [];
        if (rawBars.length === 0) {
            return this.renderFallbackBox(data.description || 'Histogram (no bar data)');
        }

        const bars = rawBars.map((b: any) => ({
            xStart: parseFloat(b.x_start ?? b.xMin ?? b.start ?? 0),
            xEnd: parseFloat(b.x_end ?? b.xMax ?? b.end ?? 10),
            height: parseFloat(b.height ?? b.fd ?? b.value ?? 0)
        })).filter(b => Number.isFinite(b.xStart) && Number.isFinite(b.xEnd) && b.xEnd > b.xStart && Number.isFinite(b.height));

        if (bars.length === 0) {
            return this.renderFallbackBox(data.description || 'Histogram (invalid bar intervals)');
        }

        const minBarX = Math.min(...bars.map(b => b.xStart));
        const maxBarX = Math.max(...bars.map(b => b.xEnd));
        const maxBarH = Math.max(...bars.map(b => b.height));

        const xMin = Number.isFinite(parseFloat(data.x_min)) ? parseFloat(data.x_min) : Math.min(0, minBarX);
        const xMax = Number.isFinite(parseFloat(data.x_max)) ? Math.max(parseFloat(data.x_max), maxBarX) : maxBarX;
        const yMin = 0;
        const yMax = Number.isFinite(parseFloat(data.y_max)) ? Math.max(parseFloat(data.y_max), maxBarH) : Math.ceil(maxBarH * 1.15);

        const xSpan = Math.max(1, xMax - xMin);
        const ySpan = Math.max(1, yMax - yMin);

        const getNiceStep = (span: number): number => {
            if (span <= 5) return 1;
            if (span <= 15) return 2;
            if (span <= 35) return 5;
            if (span <= 70) return 10;
            if (span <= 150) return 20;
            return Math.ceil(span / 6 / 10) * 10;
        };

        const xStep = (Number.isFinite(parseFloat(data.x_step)) && parseFloat(data.x_step) > 0) ? parseFloat(data.x_step) : getNiceStep(xSpan);
        const yStep = (Number.isFinite(parseFloat(data.y_step)) && parseFloat(data.y_step) > 0) ? parseFloat(data.y_step) : getNiceStep(ySpan);

        const VIEW_W = 180;
        const VIEW_H = 120;
        const LEFT_PAD = 28;
        const RIGHT_PAD = 12;
        const TOP_PAD = 10;
        const BOTTOM_PAD = 26;

        const mapX = (x: number) => LEFT_PAD + ((x - xMin) / xSpan) * VIEW_W;
        const mapY = (y: number) => TOP_PAD + VIEW_H - ((y - yMin) / ySpan) * VIEW_H;

        let svg = '';

        const xMinorStep = xStep / 5;
        const yMinorStep = yStep / 5;

        for (let x = xMin; x <= xMax + 1e-6; x += xMinorStep) {
            const sx = +mapX(x).toFixed(2);
            svg += `<line x1="${sx}" y1="${TOP_PAD}" x2="${sx}" y2="${TOP_PAD + VIEW_H}" stroke="var(--diagram-grid)" stroke-width="0.2" opacity="0.35" vector-effect="non-scaling-stroke" />`;
        }
        for (let y = yMin; y <= yMax + 1e-6; y += yMinorStep) {
            const sy = +mapY(y).toFixed(2);
            svg += `<line x1="${LEFT_PAD}" y1="${sy}" x2="${LEFT_PAD + VIEW_W}" y2="${sy}" stroke="var(--diagram-grid)" stroke-width="0.2" opacity="0.35" vector-effect="non-scaling-stroke" />`;
        }

        for (let x = xMin; x <= xMax + 1e-6; x += xStep) {
            const sx = +mapX(x).toFixed(2);
            svg += `<line x1="${sx}" y1="${TOP_PAD}" x2="${sx}" y2="${TOP_PAD + VIEW_H}" stroke="var(--diagram-grid)" stroke-width="0.45" opacity="0.75" vector-effect="non-scaling-stroke" />`;
            svg += `<line x1="${sx}" y1="${TOP_PAD + VIEW_H}" x2="${sx}" y2="${TOP_PAD + VIEW_H + 2.5}" stroke="var(--diagram-foreground)" stroke-width="0.6" vector-effect="non-scaling-stroke" />`;
            svg += `<text x="${sx}" y="${TOP_PAD + VIEW_H + 8}" font-size="5" fill="var(--diagram-foreground)" text-anchor="middle">${Math.round(x * 100) / 100}</text>`;
        }
        for (let y = yMin; y <= yMax + 1e-6; y += yStep) {
            const sy = +mapY(y).toFixed(2);
            svg += `<line x1="${LEFT_PAD}" y1="${sy}" x2="${LEFT_PAD + VIEW_W}" y2="${sy}" stroke="var(--diagram-grid)" stroke-width="0.45" opacity="0.75" vector-effect="non-scaling-stroke" />`;
            svg += `<line x1="${LEFT_PAD - 2.5}" y1="${sy}" x2="${LEFT_PAD}" y2="${sy}" stroke="var(--diagram-foreground)" stroke-width="0.6" vector-effect="non-scaling-stroke" />`;
            svg += `<text x="${LEFT_PAD - 4}" y="${sy + 1.6}" font-size="5" fill="var(--diagram-foreground)" text-anchor="end">${Math.round(y * 100) / 100}</text>`;
        }

        bars.forEach(b => {
            const bx = +mapX(b.xStart).toFixed(2);
            const bw = +(mapX(b.xEnd) - mapX(b.xStart)).toFixed(2);
            const by = +mapY(b.height).toFixed(2);
            const bh = +(TOP_PAD + VIEW_H - by).toFixed(2);
            svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="rgba(148, 163, 184, 0.28)" stroke="var(--diagram-foreground)" stroke-width="0.75" vector-effect="non-scaling-stroke" />`;
        });

        svg += `<line x1="${LEFT_PAD}" y1="${TOP_PAD}" x2="${LEFT_PAD}" y2="${TOP_PAD + VIEW_H}" stroke="var(--diagram-foreground)" stroke-width="0.9" vector-effect="non-scaling-stroke" />`;
        svg += `<line x1="${LEFT_PAD}" y1="${TOP_PAD + VIEW_H}" x2="${LEFT_PAD + VIEW_W}" y2="${TOP_PAD + VIEW_H}" stroke="var(--diagram-foreground)" stroke-width="0.9" vector-effect="non-scaling-stroke" />`;

        const xLabel = data.x_label || data.x_axis_label || '';
        const yLabel = data.y_label || data.y_axis_label || 'Frequency density';
        if (xLabel) {
            svg += `<text x="${LEFT_PAD + VIEW_W / 2}" y="${TOP_PAD + VIEW_H + 19}" font-size="5.5" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle">${xLabel}</text>`;
        }
        if (yLabel) {
            const cy = TOP_PAD + VIEW_H / 2;
            svg += `<text x="8" y="${cy}" font-size="5.5" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle" transform="rotate(-90 8 ${cy})">${yLabel}</text>`;
        }

        return this.wrapSVG(0, 0, LEFT_PAD + VIEW_W + RIGHT_PAD, TOP_PAD + VIEW_H + BOTTOM_PAD, svg);
    }

    /**
     * Safety Net: Parses a raw histogram description (e.g. Question 15) into a structured drawHistogram() call.
     */
    private static renderHistogramFromHint(desc: string): string {
        try {
            const xAxisMatch = desc.match(/['"]([^'"]+)['"]\s+on\s+the\s+horizontal\s+x-axis\s+from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i);
            const yAxisMatch = desc.match(/['"]([^'"]+)['"]\s+on\s+the\s+vertical\s+y-axis\s+from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i);

            const x_label = xAxisMatch ? xAxisMatch[1] : 'Value';
            const x_min = xAxisMatch ? parseFloat(xAxisMatch[2]) : 0;
            const x_max = xAxisMatch ? parseFloat(xAxisMatch[3]) : 60;

            const y_label = yAxisMatch ? yAxisMatch[1] : 'Frequency density';
            const y_min = yAxisMatch ? parseFloat(yAxisMatch[2]) : 0;
            const y_max = yAxisMatch ? parseFloat(yAxisMatch[3]) : 12;

            const bars: { x_start: number; x_end: number; height: number }[] = [];
            const barRegex = /from\s+(?:x\s*=\s*)?(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)\s+with\s+(?:height|frequency\s+density)\s+(\d+(?:\.\d+)?)/gi;
            let m;
            while ((m = barRegex.exec(desc)) !== null) {
                bars.push({
                    x_start: parseFloat(m[1]),
                    x_end: parseFloat(m[2]),
                    height: parseFloat(m[3])
                });
            }

            if (bars.length === 0) return this.renderFallbackBox(desc);
            return this.drawHistogram({
                type: 'histogram',
                x_min,
                x_max,
                y_min,
                y_max,
                x_label,
                y_label,
                bars
            });
        } catch (e) {
            console.error('[DiagramService] renderHistogramFromHint error:', e);
            return this.renderFallbackBox(desc);
        }
    }

    /**
     * Draws Function Graphs (Algebraic Curves) - Dynamic Equation Evaluator v11.0
     * IMPLEMENTS: Generic Normalization & Background Grids
     */
    private static drawFunctionGraph(data: any): string {
        const xMinData = parseFloat(data.x_min ?? 0);
        const xMaxData = parseFloat(data.x_max ?? 10);
        const yMinData = parseFloat(data.y_min ?? 0);
        const yMaxData = parseFloat(data.y_max ?? 10);

        if (!Number.isFinite(xMinData) || !Number.isFinite(xMaxData) || !Number.isFinite(yMinData) || !Number.isFinite(yMaxData)) {
            return this.renderFallbackBox(data.description || "Function Graph (Invalid bounds)");
        }

        // 1. Normalization Constants (The "Viewport")
        // We map any data range to a fixed 200x200 SVG space for consistent styling
        const VIEW_W = 200;
        const VIEW_H = 200;
        const MARGIN = 40; // Space for labels and titles

        const mapX = (x: number) => ((x - xMinData) / (xMaxData - xMinData)) * VIEW_W;
        const mapY = (y: number) => VIEW_H - (((y - yMinData) / (yMaxData - yMinData)) * VIEW_H);

        const mainEqn = data.equation || data.equation_label || "";
        if (!mainEqn && (!data.layers || data.layers.length === 0)) {
            return this.renderFallbackBox(data.description || "Graph (No equation provided)");
        }

        // 2. Grid Generation (Major Ticks)
        let gridHtml = '';
        const getNiceStep = (span: number): number => {
            if (span <= 0 || !Number.isFinite(span)) return 1;
            if (span <= 5) return 1;
            if (span <= 12) return span % 2 === 0 ? 2 : 1;
            if (span <= 25) return 5;
            if (span <= 60) return 10;
            if (span <= 120) return 20;
            const raw = span / 5;
            const mag = Math.pow(10, Math.floor(Math.log10(raw)));
            const norm = raw / mag;
            return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
        };
        const xStep = parseFloat(data.x_step) || getNiceStep(xMaxData - xMinData);
        const yStep = parseFloat(data.y_step) || getNiceStep(yMaxData - yMinData);

        // Vertical lines & X-axis labels
        for (let x = xMinData; x <= xMaxData + 0.001; x += xStep) {
            const vx = mapX(x);
            gridHtml += `<line x1="${vx}" y1="0" x2="${vx}" y2="${VIEW_H}" stroke="var(--diagram-grid)" stroke-width="0.3" opacity="0.3" />`;
            gridHtml += `<text x="${vx}" y="${VIEW_H + 12}" font-size="8" fill="var(--diagram-foreground)" text-anchor="middle">${Math.round(x * 10) / 10}</text>`;
        }

        // Horizontal lines & Y-axis labels
        for (let y = yMinData; y <= yMaxData + 0.001; y += yStep) {
            const vy = mapY(y);
            gridHtml += `<line x1="0" y1="${vy}" x2="${VIEW_W}" y2="${vy}" stroke="var(--diagram-grid)" stroke-width="0.3" opacity="0.3" />`;
            gridHtml += `<text x="-8" y="${vy + 3}" font-size="8" fill="var(--diagram-foreground)" text-anchor="end">${Math.round(y * 10) / 10}</text>`;
        }

        // 3. Curve Generation (Uses Normalized Coordinates)
        const generatePath = (eqn: string, scaleY = 1, shiftY = 0, reflectX = false) => {
            if (!eqn) return "";
            let pathD = "";
            const steps = 150; 
            let norm = String(eqn).toLowerCase().replace(/\s+/g, '');
            if (norm.startsWith('y=')) norm = norm.substring(2);

            let jsEqn = norm.replace(/\^/g, '**').replace(/(\d)([x])/g, '$1*$2').replace(/(\d)([a-zA-Z(])/g, '$1*$2');
            let evalFunc: (x: number) => number;
            try {
                evalFunc = new Function('x', `return ${jsEqn};`) as (x: number) => number;
                evalFunc(1);
            } catch (e) {
                evalFunc = (x: number) => norm.includes('x') ? x : 0;
            }

            for (let i = 0; i <= steps; i++) {
                const xVal = xMinData + ((xMaxData - xMinData) * (i / steps));
                let yVal = evalFunc(xVal);
                if (reflectX || norm.includes('=-')) yVal = -yVal;
                yVal = (yVal * scaleY) + shiftY;

                const sx = mapX(xVal);
                const sy = mapY(yVal);
                
                if (!Number.isFinite(sy) || Math.abs(sy) > 2000) continue; 
                pathD += `${pathD === "" ? 'M' : 'L'} ${sx} ${sy} `;
            }
            return pathD;
        };

        const curvesHtml = mainEqn ? `<path d="${generatePath(mainEqn)}" fill="none" stroke="var(--diagram-foreground)" stroke-width="2" vector-effect="non-scaling-stroke" />` : '';

        // 4. Labels & Wraparound
        const xTitle = data.x_axis_label || data.x_label || "x";
        const yTitle = data.y_axis_label || data.y_label || "y";

        const isLongTitle = xTitle.length > 3 || yTitle.length > 3;
        const axisLabelsHtml = isLongTitle
            ? `<text x="${VIEW_W / 2}" y="${VIEW_H + 28}" font-size="10" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle">${xTitle}</text>
               <text x="-26" y="${VIEW_H / 2}" font-size="10" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle" transform="rotate(-90 -26 ${VIEW_H / 2})">${yTitle}</text>`
            : `<text x="${VIEW_W + 20}" y="${VIEW_H + 5}" font-size="10" font-weight="bold" fill="var(--diagram-foreground)">${xTitle}</text>
               <text x="0" y="-25" font-size="10" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle">${yTitle}</text>`;

        const equationHtml = (data.show_equation !== false && xTitle === 'x' && yTitle === 'y' && mainEqn)
            ? `<text x="${VIEW_W - 6}" y="-6" font-size="9" fill="var(--diagram-foreground)" font-style="italic" text-anchor="end">y = ${String(mainEqn).replace(/\*/g, '')}</text>`
            : '';

        return this.wrapSVG(-MARGIN, -MARGIN/2, VIEW_W + MARGIN*2, VIEW_H + MARGIN*1.5, `
            <defs>
                <marker id="arrowhead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--diagram-grid)" />
                </marker>
            </defs>
            
            ${gridHtml}

            <!-- Main Axes -->
            <line x1="0" y1="${VIEW_H}" x2="${VIEW_W + 15}" y2="${VIEW_H}" stroke="var(--diagram-foreground)" stroke-width="1" marker-end="url(#arrowhead)" />
            <line x1="0" y1="${VIEW_H}" x2="0" y2="-15" stroke="var(--diagram-foreground)" stroke-width="1" marker-end="url(#arrowhead)" />
            
            ${curvesHtml}

            <!-- Axis Labels -->
            ${axisLabelsHtml}

            ${equationHtml}
        `);
    }

    private static drawComposite2D(data: any): string {
        const components = data.components || [];
        if (components.length === 0) return this.renderFallbackBox("Composite 2D (No components)");

        // Calculate global bounds
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;

        const renderedComponents = components.map((comp: any) => {
            // Render each component type
            switch (comp.type) {
                case 'triangle': return this.drawTriangle(comp);
                case 'polygon': return this.drawPolygon(comp);
                case 'coordinate_grid': return this.drawCoordinateGrid(comp);
                default: return "";
            }
        }).filter((html: string) => html !== "");

        if (renderedComponents.length === 0) return this.renderFallbackBox(data.description || "Composite 2D (Render Error)");

        // Wrap them in a flex container for side-by-side or stacked display
        return `<div class="model_diagram_composite" style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">${renderedComponents.join('')}</div>`;
    }

    private static wrapSVG(x: number, y: number, w: number, h: number, body: string): string {
        // [FIX] Defensive Validation for viewBox
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
            return `<div class="diagram-error">Diagram render error: NaN in viewBox</div>`;
        }

        // Compact internal indentation & blank lines so CommonMark/ReactMarkdown does not treat 4+ space indented lines as <pre><code> blocks
        const compactBody = body.replace(/^\s+/gm, '').replace(/\n+/g, ' ').trim();

        // [v9.53] Internal viewBox is tight to graph again. Layout handled by CSS.
        return `<div class="model_diagram"><div class="diagram-accuracy-label">Not drawn accurately</div><svg viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="ai-diagram-svg">${compactBody}</svg></div>`;
    }

    private static renderFallbackBox(description: string): string {
        return `<div class="diagram-fallback-wrapper"><strong>📐 Diagram Reference:</strong> ${description}</div>`;
    }

    /**
     * Safety Net: Converts bracketed hint strings into HTML tables (v9.69)
     * e.g. "120<=t<140 (12), 140<=t<160 (28)"
     */
    private static renderTableFromHint(content: string): string {
        try {
            // Split by comma or semicolon
            const entries = content.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 0);
            if (entries.length === 0) return "";

            let rowsHtml = "";
            entries.forEach(entry => {
                // Look for "Label (Value)" pattern
                const match = entry.match(/^(.*?)\s*\((\$?[^)]+\$?)\)$/);
                if (match) {
                    let label = match[1].trim();
                    let value = match[2].trim();
                    // Avoid double dollar signs
                    if (!label.startsWith('$')) label = `$${label}$`;
                    if (!value.startsWith('$')) value = `$${value}$`;
                    rowsHtml += `<tr><td>${label}</td><td>${value}</td></tr>`;
                } else {
                    // Fallback for simple key:value
                    const parts = entry.split(':');
                    if (parts.length === 2) {
                        let k = parts[0].trim();
                        let v = parts[1].trim();
                        if (!k.startsWith('$')) k = `$${k}$`;
                        if (!v.startsWith('$')) v = `$${v}$`;
                        rowsHtml += `<tr><td>${k}</td><td>${v}</td></tr>`;
                    }
                }
            });

            if (!rowsHtml) return `[Table: ${content}]`; // Return original if parsing failed

            return `<table class="model_table" style="margin: 10px 0;"><thead><tr><th>Class / Interval</th><th>Frequency</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
        } catch (e) {
            return `[Table Error: ${content}]`;
        }
    }
    /**
     * Safety Net: Converts bracketed triangle hints into SVGs (v9.75)
     * e.g. "side1=10, side2=8, angle=60, description=isosceles"
     */
    /**
     * Safety Net: Converts bracketed list hints into a clean Flexbox grid (v9.85)
     * e.g. "[List: 36, 20, 37, 53, 42, 41, 24, 18, ...]"
     */
    private static renderListFromHint(content: string): string {
        try {
            // Split by comma, clean whitespace, and filter out empty items
            const items = content.split(',').map(s => s.trim()).filter(s => s.length > 0);

            if (items.length === 0) return `[List: ${content}]`;

            // Draw them as a fluid grid of numbers using CSS classes
            const itemsHtml = items.map(item => {
                return `<div class="diagram-list-item">${item}</div>`;
            }).join('');

            return `<div class="diagram-list-wrapper">${itemsHtml}</div>`;
        } catch (e) {
            return `[List Error: ${content}]`;
        }
    }

    /**
     * Safety Net: Converts bracketed triangle hints into SVGs (v9.76)
     * e.g. "side1=10, side2=8, angle=60" or "AB=10, AC=8, angle=60"
     */
    private static renderTriangleFromHint(content: string): string {
        try {
            const data: any = { type: 'triangle' };
            // Extract key-value pairs (supports side1=10 or side1: 10 or AB=10)
            const paramRegex = /([\w\d]+)\s*[:=]\s*([^,;]+)/g;
            let match;
            while ((match = paramRegex.exec(content)) !== null) {
                const key = match[1].trim().toLowerCase();
                const val = match[2].trim();
                if (key === 'description' || key === 'unit' || key.startsWith('label_') || key === 'a' || key === 'b' || key === 'c') {
                    const finalKey = key.length === 1 ? `label_${key.toUpperCase()}` : key;
                    data[finalKey] = val;
                } else {
                    // Try numeric, but keep as string if algebraic (e.g. 5x+4)
                    const num = parseFloat(val.replace(/[^\d.]/g, ''));
                    data[key] = isNaN(num) ? val : num;
                }
            }

            // Map common side labels (AB, AC, BC) to side1, side2, side3 if missing
            if (!data.side1) data.side1 = data.ab || data.ba;
            if (!data.side2) data.side2 = data.ac || data.ca;
            if (!data.side3) data.side3 = data.bc || data.cb;

            // Fallback for unlabeled sequences like "10, 8, 60"
            if (!data.side1 && !data.angle) {
                const parts = content.split(/[,;]/).map(s => s.trim());
                if (parts.length >= 2) {
                    data.side1 = parseFloat(parts[0]) || parts[0];
                    data.side2 = parseFloat(parts[1]) || parts[1];
                    if (parts[2]) data.angle = parseFloat(parts[2]) || parts[2];
                    if (parts[3]) data.description = parts[3];
                }
            }

            // If we still have nothing, it's just a text description. Use it as description.
            if (!data.side1 && content.length > 5) {
                data.description = content;
            }

            // [v9.76] If we have a description but no sides, Sketch Mode will handle it if we provide dummy values
            if (!data.side1 && data.description) {
                data.side1 = "Sketch";
                data.side2 = "Sketch";
                data.angle = "Sketch";
            }

            if (!data.side1) return `[Triangle: ${content}]`;

            if (!data.side1) return `[Triangle: ${content}]`;

            return this.drawTriangle(data);
        } catch (e) {
            console.error('[DiagramService] renderTriangleFromHint error:', e);
            return `[Triangle Error: ${content}]`;
        }
    }

    /**
     * Safety Net: Converts bracketed angle hints into standalone SVGs (v9.86)
     * e.g. "Diagram showing two intersecting lines forming an acute angle marked x"
     */
    private static renderAngleFromHint(label: string): string {
        try {
            // We draw a simple V-shape (two intersecting lines)
            // Vertex at (0,0)
            const lineLength = 10;
            const angleDeg = 60; // Default to an acute 60 degree angle
            const angleRad = angleDeg * (Math.PI / 180);

            // Line 1: straight up the Y axis (0, -10)
            const x1 = 0, y1 = -lineLength;

            // Line 2: up and right (8.66, -5)
            const x2 = lineLength * Math.sin(angleRad);
            const y2 = -lineLength * Math.cos(angleRad);

            // Angle arc properties
            const arcRadius = 3;
            const arcStartX = 0;
            const arcStartY = -arcRadius;
            const arcEndX = arcRadius * Math.sin(angleRad);
            const arcEndY = -arcRadius * Math.cos(angleRad);

            // Position the label deeply inside the arc
            const labelDist = arcRadius * 0.6;
            const labelAngle = angleRad / 2; // Bisect the angle
            const labelX = labelDist * Math.sin(labelAngle);
            const labelY = -labelDist * Math.cos(labelAngle);

            const padding = 2;
            const minX = -padding;
            const maxX = Math.max(x1, x2) + padding;
            const minY = Math.min(y1, y2) - padding;
            const maxY = padding; // Vertex is at 0,0 

            return this.wrapSVG(minX, minY, maxX - minX, maxY - minY, `
                <!-- The two intersecting lines -->
                <line x1="0" y1="0" x2="${x1}" y2="${y1}" stroke="var(--diagram-foreground)" stroke-width="0.3" vector-effect="non-scaling-stroke" />
                <line x1="0" y1="0" x2="${x2}" y2="${y2}" stroke="var(--diagram-foreground)" stroke-width="0.3" vector-effect="non-scaling-stroke" />
                
                <!-- The Angle Arc -->
                <path d="M ${arcStartX} ${arcStartY} A ${arcRadius} ${arcRadius} 0 0 1 ${arcEndX} ${arcEndY}" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.2" vector-effect="non-scaling-stroke" />
                
                <!-- The Angle Label -->
                <text x="${labelX}" y="${labelY + 0.3}" font-size="1.2" font-style="italic" font-weight="bold" fill="var(--diagram-foreground)" text-anchor="middle">${label}</text>
            `);
        } catch (e) {
            console.error('[DiagramService] renderAngleFromHint error:', e);
            return `[Angle Error: ${label}]`;
        }
    }

    /**
     * [v9.97] Draws a Bar Chart SVG from structured JSON data.
     * Accepts: { type: 'bar_chart', y_max, y_step, y_label?, bars: [{label, value}] }
     */
    private static drawBarChart(data: any): string {
        const bars: { label: string; value: number }[] = data.bars || [];
        if (bars.length === 0) return this.renderFallbackBox(data.description || 'Bar Chart (no data)');

        const yMax = parseFloat(data.y_max ?? 100);
        const yStep = parseFloat(data.y_step ?? 10);
        if (!Number.isFinite(yMax) || !Number.isFinite(yStep) || yMax <= 0) {
            return this.renderFallbackBox(data.description || 'Bar Chart (invalid bounds)');
        }

        const barW = 12;
        const gap = 5;
        const leftPad = 14;   // room for y-axis labels
        const bottomPad = 12; // room for x-axis labels
        const topPad = 4;
        const chartH = 60;    // height of bar area in SVG units
        const totalW = leftPad + bars.length * (barW + gap) - gap + 4;
        const totalH = chartH + topPad + bottomPad;

        const scaleY = (v: number) => chartH - (v / yMax) * chartH;

        let gridHtml = '';
        for (let y = 0; y <= yMax; y += yStep) {
            const svgY = topPad + scaleY(y);
            gridHtml += `<line x1="${leftPad}" y1="${svgY}" x2="${totalW}" y2="${svgY}" stroke="var(--diagram-grid)" stroke-width="0.4" vector-effect="non-scaling-stroke" />`;
            gridHtml += `<text x="${leftPad - 1}" y="${svgY + 0.5}" font-size="3" fill="var(--diagram-grid)" text-anchor="end">${y}</text>`;
        }

        // Axes
        gridHtml += `<line x1="${leftPad}" y1="${topPad}" x2="${leftPad}" y2="${topPad + chartH}" stroke="var(--diagram-foreground)" stroke-width="0.5" vector-effect="non-scaling-stroke" />`;
        gridHtml += `<line x1="${leftPad}" y1="${topPad + chartH}" x2="${totalW}" y2="${topPad + chartH}" stroke="var(--diagram-foreground)" stroke-width="0.5" vector-effect="non-scaling-stroke" />`;

        // Bars + labels
        let barsHtml = '';
        bars.forEach((bar, i) => {
            const x = leftPad + i * (barW + gap);
            const barH = Math.max(0, (bar.value / yMax) * chartH);
            const barY = topPad + chartH - barH;
            barsHtml += `<rect x="${x}" y="${barY}" width="${barW}" height="${barH}" fill="var(--diagram-foreground)" opacity="0.75" />`;
            barsHtml += `<text x="${x + barW / 2}" y="${barY - 1.5}" font-size="3" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${bar.value}</text>`;
            // Split label across two lines if multi-word
            const words = bar.label.split(' ');
            const mid = Math.ceil(words.length / 2);
            const line1 = words.slice(0, mid).join(' ');
            const line2 = words.slice(mid).join(' ');
            const labelY = topPad + chartH + 4;
            if (line2) {
                barsHtml += `<text x="${x + barW / 2}" y="${labelY}" font-size="2.8" fill="var(--diagram-foreground)" text-anchor="middle"><tspan x="${x + barW / 2}" dy="0">${line1}</tspan><tspan x="${x + barW / 2}" dy="3.5">${line2}</tspan></text>`;
            } else {
                barsHtml += `<text x="${x + barW / 2}" y="${labelY}" font-size="2.8" fill="var(--diagram-foreground)" text-anchor="middle">${bar.label}</text>`;
            }
        });

        const yLabel = data.y_label || '';
        const yLabelHtml = yLabel ? `<text x="2" y="${topPad + chartH / 2}" font-size="3" fill="var(--diagram-foreground)" text-anchor="middle" transform="rotate(-90 2 ${topPad + chartH / 2})">${yLabel}</text>` : '';

        return this.wrapSVG(0, 0, totalW, totalH, gridHtml + barsHtml + yLabelHtml);
    }

    /**
     * [v9.97] Safety Net: Parses a raw [Bar chart: ...] hint string into a drawBarChart() call.
     */
    private static renderBarChartFromHint(content: string): string {
        try {
            const data: any = { type: 'bar_chart', bars: [] };

            // y_max and y_step from "from 0 to 70 in intervals of 10"
            const yBoundsMatch = content.match(/from\s+(\d+)\s+to\s+(\d+)/i);
            const yStepMatch = content.match(/intervals?\s+of\s+(\d+)/i);
            data.y_max = yBoundsMatch ? parseFloat(yBoundsMatch[2]) : 100;
            data.y_step = yStepMatch ? parseFloat(yStepMatch[1]) : 10;

            // Bars: "Bar for Library is at 30" / "Bar for Home is roughly at 66"
            const barRegex = /[Bb]ar\s+for\s+([A-Za-z][A-Za-z\s]*?)\s+is\s+(?:roughly\s+)?at\s+(\d+(?:\.\d+)?)/gi;
            let m;
            while ((m = barRegex.exec(content)) !== null) {
                data.bars.push({ label: m[1].trim(), value: parseFloat(m[2]) });
            }

            // Fallback: x-axis categories + values extracted separately
            if (data.bars.length === 0) {
                const catMatch = content.match(/x-axis\s+categories?:\s*(.*?)(?:\.|$)/i);
                if (catMatch) {
                    const cats = catMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean);
                    const vals: number[] = [];
                    const atRegex = /at\s+(\d+(?:\.\d+)?)/gi;
                    let av;
                    while ((av = atRegex.exec(content)) !== null) vals.push(parseFloat(av[1]));
                    cats.forEach((cat: string, i: number) => data.bars.push({ label: cat, value: vals[i] ?? 0 }));
                }
            }

            if (data.bars.length === 0) return this.renderFallbackBox(`Bar Chart: ${content}`);
            return this.drawBarChart(data);
        } catch (e) {
            console.error('[DiagramService] renderBarChartFromHint error:', e);
            return this.renderFallbackBox(`Bar Chart: ${content}`);
        }
    }

    /**
     * [v9.97] Safety Net: Parses a [Diagram: Frequency tree ...] hint into a drawTreeDiagram() call.
     */
    private static renderFrequencyTreeFromHint(content: string): string {
        try {
            // Root: "starting with 'People 120'"
            const rootMatch = content.match(/starting with\s+'([^']+)'/i);
            const rootLabel = rootMatch ? rootMatch[1] : 'Start';

            // Extract Headers for the new visual generator
            const headers: string[] = [];
            const headerFromRoot = rootLabel.replace(/\d+/g, '').trim();
            if (headerFromRoot) headers.push(headerFromRoot);
            else headers.push("Start");

            const intoRegex = /into\s+'([^']+)'/gi;
            let im;
            while ((im = intoRegex.exec(content)) !== null) {
                headers.push(im[1].trim());
            }

            // Branch pairs: "with branches 'X' and 'Y'"
            const branchMatches: string[][] = [];
            const branchRegex = /with branches?\s+'([^']+)'\s+and\s+'([^']+)'/gi;
            let bm;
            while ((bm = branchRegex.exec(content)) !== null) {
                branchMatches.push([bm[1].trim(), bm[2].trim()]);
            }

            if (branchMatches.length === 0) return this.renderFallbackBox(`Frequency Tree: ${content}`);

            const branches: any[] = [];
            const level1 = branchMatches[0]; // e.g. ['Children', 'Adults']
            const level2 = branchMatches[1]; // e.g. ['Left', 'Right']


            // For Probability Trees
            level1.forEach(child => {
                branches.push({ from: rootLabel, to: child, prob: '' });
                if (level2) {
                    level2.forEach(grandchild => {
                        branches.push({ from: child, to: `${grandchild} (${child[0]})`, prob: '' });
                    });
                }
            });

            if (branches.length === 0) return this.renderFallbackBox(`Frequency Tree: ${content}`);
            return this.drawFrequencyTree({ branches, headers });
        } catch (e) {
            console.error('[DiagramService] renderFrequencyTreeFromHint error:', e);
            return this.renderFallbackBox(`Frequency Tree: ${content}`);
        }
    }

    /**
     * Renders a 2-set Venn Diagram inside a universal set box (ξ).
     */
    private static drawVennDiagram(data: any): string {
        const uLabel = data.universal_label || 'ξ';
        const setA = data.set_a_label || 'A';
        const setB = data.set_b_label || 'B';
        const aOnly = data.a_only ?? '';
        const inter = data.intersection ?? '';
        const bOnly = data.b_only ?? '';
        const outside = data.outside ?? '';

        const svg = `
            <rect x="4" y="4" width="92" height="58" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.6" rx="1.5" />
            <text x="8" y="12" font-size="5" fill="var(--diagram-foreground)" font-weight="bold" font-style="italic">${uLabel}</text>

            <circle cx="38" cy="34" r="19" fill="rgba(16, 185, 129, 0.08)" stroke="var(--diagram-foreground)" stroke-width="0.6" />
            <circle cx="62" cy="34" r="19" fill="rgba(59, 130, 246, 0.08)" stroke="var(--diagram-foreground)" stroke-width="0.6" />

            <text x="27" y="13" font-size="4.5" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="middle">${setA}</text>
            <text x="73" y="13" font-size="4.5" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="middle">${setB}</text>

            <text x="29" y="35.5" font-size="4.5" fill="#10b981" font-weight="bold" text-anchor="middle">${aOnly}</text>
            <text x="50" y="35.5" font-size="4.5" fill="#10b981" font-weight="bold" text-anchor="middle">${inter}</text>
            <text x="71" y="35.5" font-size="4.5" fill="#10b981" font-weight="bold" text-anchor="middle">${bOnly}</text>
            <text x="88" y="56" font-size="4.2" fill="#10b981" font-weight="bold" text-anchor="end">${outside}</text>
        `;
        return this.wrapSVG(0, 0, 100, 66, svg);
    }

    /**
     * Renders a horizontal Number Line with integer ticks, open/closed inequality circles, and directional rays or intervals.
     */
    private static drawNumberLine(data: any): string {
        const min = Number.isFinite(parseFloat(data.min)) ? parseFloat(data.min) : -5;
        const max = Number.isFinite(parseFloat(data.max)) ? parseFloat(data.max) : 5;
        const step = Number.isFinite(parseFloat(data.step)) && parseFloat(data.step) > 0 ? parseFloat(data.step) : 1;
        const span = Math.max(1, max - min);

        const leftX = 10;
        const rightX = 90;
        const lineY = 24;
        const elevatedY = 13;
        const toSvgX = (val: number) => leftX + ((val - min) / span) * (rightX - leftX);

        let svg = `
            <line x1="${leftX - 4}" y1="${lineY}" x2="${rightX + 4}" y2="${lineY}" stroke="var(--diagram-foreground)" stroke-width="0.6" />
            <polygon points="${leftX - 5.5},${lineY} ${leftX - 2.5},${lineY - 1.5} ${leftX - 2.5},${lineY + 1.5}" fill="var(--diagram-foreground)" />
            <polygon points="${rightX + 5.5},${lineY} ${rightX + 2.5},${lineY - 1.5} ${rightX + 2.5},${lineY + 1.5}" fill="var(--diagram-foreground)" />
        `;

        for (let v = min; v <= max + 1e-6; v += step) {
            const x = toSvgX(v);
            svg += `
                <line x1="${x}" y1="${lineY - 2}" x2="${x}" y2="${lineY + 2}" stroke="var(--diagram-foreground)" stroke-width="0.5" />
                <text x="${x}" y="${lineY + 7}" font-size="3.6" fill="var(--diagram-foreground)" text-anchor="middle">${Math.round(v * 100) / 100}</text>
            `;
        }

        const pts = Array.isArray(data.points) ? data.points : [];
        if (data.connect && pts.length >= 2) {
            const x1 = toSvgX(parseFloat(pts[0].x ?? 0));
            const x2 = toSvgX(parseFloat(pts[1].x ?? 0));
            svg += `<line x1="${x1}" y1="${elevatedY}" x2="${x2}" y2="${elevatedY}" stroke="#10b981" stroke-width="0.9" />`;
        }

        pts.forEach((pt: any) => {
            const vx = parseFloat(pt.x ?? 0);
            if (!Number.isFinite(vx)) return;
            const cx = toSvgX(vx);
            const isClosed = String(pt.style || '').toLowerCase() === 'closed' || String(pt.style || '').toLowerCase() === 'filled';

            if (pt.ray === 'right') {
                svg += `
                    <line x1="${cx}" y1="${elevatedY}" x2="${rightX + 2}" y2="${elevatedY}" stroke="#10b981" stroke-width="0.9" />
                    <polygon points="${rightX + 4},${elevatedY} ${rightX + 1},${elevatedY - 1.6} ${rightX + 1},${elevatedY + 1.6}" fill="#10b981" />
                `;
            } else if (pt.ray === 'left') {
                svg += `
                    <line x1="${cx}" y1="${elevatedY}" x2="${leftX - 2}" y2="${elevatedY}" stroke="#10b981" stroke-width="0.9" />
                    <polygon points="${leftX - 4},${elevatedY} ${leftX - 1},${elevatedY - 1.6} ${leftX - 1},${elevatedY + 1.6}" fill="#10b981" />
                `;
            }

            svg += `<circle cx="${cx}" cy="${elevatedY}" r="2" fill="${isClosed ? '#10b981' : 'var(--diagram-bg, #1e1e1e)'}" stroke="#10b981" stroke-width="0.8" />`;
            if (pt.label) {
                svg += `<text x="${cx}" y="${elevatedY - 4}" font-size="3.6" fill="#10b981" font-weight="bold" text-anchor="middle">${pt.label}</text>`;
            }
        });

        return this.wrapSVG(0, 0, 100, 38, svg);
    }

    /**
     * Renders a GCSE Pictogram with fractional circle icons (0.25, 0.5, 0.75, 1.0).
     */
    private static drawPictogram(data: any): string {
        const rows = Array.isArray(data.rows) ? data.rows : [];
        if (rows.length === 0) return this.renderFallbackBox(data.description || 'Pictogram');

        const rowH = 12;
        const topPad = data.key_text ? 12 : 4;
        const totalH = topPad + rows.length * rowH + 6;
        const labelColW = 28;
        const r = 3.8;
        const maxCount = rows.reduce((m: number, row: any) => Math.max(m, parseFloat(row.count ?? 0) || 0), 0);
        const maxIcons = Math.max(5, Math.ceil(maxCount));
        const iconColW = Math.max(64, maxIcons * 10 + 6);
        const totalW = 4 + labelColW + iconColW + 4;

        let svg = '';
        if (data.key_text) {
            svg += `<text x="6" y="8" font-size="3.6" fill="var(--diagram-foreground)" font-weight="bold">Key: ${data.key_text}</text>`;
        }

        const drawFractionalCircle = (cx: number, cy: number, frac: number, color: string): string => {
            if (frac >= 0.9) {
                return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(16, 185, 129, 0.2)" stroke="${color}" stroke-width="0.6" />`;
            }
            if (frac >= 0.7) {
                // 3/4 circle (top-right, bottom-right, bottom-left)
                const d = `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
                return `<path d="${d}" fill="rgba(16, 185, 129, 0.2)" stroke="${color}" stroke-width="0.6" />`;
            }
            if (frac >= 0.4) {
                // 1/2 circle (left half)
                const d = `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`;
                return `<path d="${d}" fill="rgba(16, 185, 129, 0.2)" stroke="${color}" stroke-width="0.6" />`;
            }
            // 1/4 circle (top-right quadrant)
            const d = `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;
            return `<path d="${d}" fill="rgba(16, 185, 129, 0.2)" stroke="${color}" stroke-width="0.6" />`;
        };

        rows.forEach((row: any, idx: number) => {
            const yTop = topPad + idx * rowH;
            const cy = yTop + rowH / 2;
            const count = Math.max(0, parseFloat(row.count ?? 0));
            const whole = Math.floor(count);
            const frac = +(count - whole).toFixed(2);
            const color = row.purpose === 'solution' ? '#10b981' : 'var(--diagram-foreground)';

            svg += `
                <rect x="4" y="${yTop}" width="${labelColW}" height="${rowH}" fill="none" stroke="var(--diagram-grid)" stroke-width="0.4" />
                <rect x="${4 + labelColW}" y="${yTop}" width="${iconColW}" height="${rowH}" fill="none" stroke="var(--diagram-grid)" stroke-width="0.4" />
                <text x="${4 + labelColW / 2}" y="${cy + 1.3}" font-size="3.6" fill="var(--diagram-foreground)" text-anchor="middle">${row.label || `Row ${idx + 1}`}</text>
            `;

            for (let i = 0; i < whole; i++) {
                const cx = 4 + labelColW + 7 + i * 10;
                svg += drawFractionalCircle(cx, cy, 1, color);
            }
            if (frac >= 0.15) {
                const cx = 4 + labelColW + 7 + whole * 10;
                svg += drawFractionalCircle(cx, cy, frac, color);
            }
        });

        return this.wrapSVG(0, 0, totalW, totalH, svg);
    }

    /**
     * Parses a fallback pictogram description (e.g. Question 3) into a structured drawPictogram() call.
     */
    private static renderPictogramFromHint(desc: string): string {
        const keyMatch = desc.match(/one circle represents\s+([^.]+)/i);
        const key_text = keyMatch ? `1 circle = ${keyMatch[1].trim()}` : '1 circle = 8';
        const rows: any[] = [];

        if (desc.toLowerCase().includes('2 whole circles and a quarter')) {
            rows.push({ label: 'Given row', count: 2.25 });
            return this.drawPictogram({ key_text, rows });
        }

        const wholeMatch = desc.match(/(\d+)\s+whole\s+circles?/i);
        if (wholeMatch) {
            let count = parseFloat(wholeMatch[1]);
            if (/three[- ]quarters?/i.test(desc)) count += 0.75;
            else if (/half/i.test(desc)) count += 0.5;
            else if (/quarter/i.test(desc)) count += 0.25;
            rows.push({ label: 'Pictogram', count });
            return this.drawPictogram({ key_text, rows });
        }

        return this.renderFallbackBox(desc);
    }

    /**
     * Parses a fallback straight-line angle description (e.g. Question 13) into a clean geometry SVG via drawCoordinateGrid().
     */
    private static renderStraightLineAngleFromHint(desc: string): string {
        const lineMatch = desc.match(/straight line\s+([A-Z]{2})/i);
        const [endL, endR] = lineMatch ? [lineMatch[1][0], lineMatch[1][1]] : ['M', 'N'];

        const quotedMatches = Array.from(desc.matchAll(/['"]([^'"]+)['"]/g)).map(m => m[1]);
        const leftAngle = quotedMatches[0] || '74°';
        const rightAngle = quotedMatches[1] || '2x';

        return this.drawCoordinateGrid({
            type: 'coordinate_grid',
            purpose: 'reference',
            show_axes: false,
            hide_grid: true,
            x_min: -5,
            x_max: 5,
            y_min: -1.5,
            y_max: 4,
            layers: [
                { shape_name: 'line', points: [[-4, 0], [4, 0]], purpose: 'reference' },
                { shape_name: 'line', points: [[0, 0], [-1.1, 3.2]], purpose: 'reference' },
                { shape_name: 'point', coords: [-4, 0], label: endL, purpose: 'reference' },
                { shape_name: 'point', coords: [4, 0], label: endR, purpose: 'reference' },
                { shape_name: 'point', coords: [-1.6, 0.9], label: leftAngle, purpose: 'reference' },
                { shape_name: 'point', coords: [1.3, 1.1], label: rightAngle, purpose: 'reference' }
            ]
        });
    }

    /**
     * Renders a horizontal GCSE Number Machine / Function Machine flowchart:
     * Input ──► [ op 1 ] ──► [ op 2 ] ──► Output
     */
    private static drawNumberMachine(data: any): string {
        const ops: string[] = Array.isArray(data.operations) && data.operations.length > 0
            ? data.operations.map((o: any) => String(o))
            : ['× 3', '− 8'];
        const inLabel = data.input_label || 'Input';
        const outLabel = data.output_label || 'Output';

        const boxW = 24;
        const boxH = 12;
        const arrowLen = 14;
        const startX = 22;
        const cy = 16;
        const totalW = startX + arrowLen + ops.length * boxW + (ops.length - 1) * arrowLen + arrowLen + 22;
        const totalH = 32;

        const drawArrow = (x1: number, x2: number, y: number): string => `
            <line x1="${x1}" y1="${y}" x2="${x2 - 1.5}" y2="${y}" stroke="var(--diagram-foreground)" stroke-width="0.6" />
            <polygon points="${x2},${y} ${x2 - 2.6},${y - 1.4} ${x2 - 2.6},${y + 1.4}" fill="var(--diagram-foreground)" />
        `;

        let svg = `<text x="${startX - 2}" y="${cy + 1.3}" font-size="3.8" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="end">${inLabel}</text>`;
        let curX = startX;
        svg += drawArrow(curX, curX + arrowLen, cy);
        curX += arrowLen;

        ops.forEach((op, idx) => {
            svg += `
                <rect x="${curX}" y="${cy - boxH / 2}" width="${boxW}" height="${boxH}" rx="1.8" fill="rgba(16, 185, 129, 0.08)" stroke="var(--diagram-foreground)" stroke-width="0.6" />
                <text x="${curX + boxW / 2}" y="${cy + 1.5}" font-size="4.2" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="middle">${op}</text>
            `;
            curX += boxW;
            svg += drawArrow(curX, curX + arrowLen, cy);
            curX += arrowLen;
        });

        svg += `<text x="${curX + 2}" y="${cy + 1.3}" font-size="3.8" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="start">${outLabel}</text>`;
        return this.wrapSVG(0, 0, totalW, totalH, svg);
    }

    /**
     * Parses a fallback number machine description (e.g. Question 13) into drawNumberMachine().
     */
    private static renderNumberMachineFromHint(desc: string): string {
        const boxMatches = Array.from(desc.matchAll(/box\s+labeled\s+['"]([^'"]+)['"]/gi)).map(m => m[1].trim());
        if (boxMatches.length > 0) {
            return this.drawNumberMachine({
                input_label: 'Input',
                output_label: 'Output',
                operations: boxMatches
            });
        }
        const quoted = Array.from(desc.matchAll(/['"]([^'"]+)['"]/g))
            .map(m => m[1].trim())
            .filter(s => !/^(input|output)$/i.test(s));
        if (quoted.length > 0) {
            return this.drawNumberMachine({
                input_label: 'Input',
                output_label: 'Output',
                operations: quoted
            });
        }
        return this.renderFallbackBox(desc);
    }

    /**
     * Renders 3D Geometric Solids (cylinder, cuboid, cone, sphere) with clean isometric/perspective SVG projections.
     */
    private static drawSolid3D(data: any): string {
        const shape = String(data.shape || data.shape_name || 'cylinder').toLowerCase();

        if (shape.includes('cuboid') || shape.includes('prism')) {
            const L = data.length || '';
            const W = data.width || data.depth || '';
            const H = data.height || '';
            const svg = `
                <!-- Hidden back edges (dashed) -->
                <line x1="34" y1="38" x2="78" y2="38" stroke="var(--diagram-foreground)" stroke-width="0.45" stroke-dasharray="2,2" opacity="0.55" />
                <line x1="34" y1="14" x2="34" y2="38" stroke="var(--diagram-foreground)" stroke-width="0.45" stroke-dasharray="2,2" opacity="0.55" />
                <line x1="20" y1="50" x2="34" y2="38" stroke="var(--diagram-foreground)" stroke-width="0.45" stroke-dasharray="2,2" opacity="0.55" />

                <!-- Front face -->
                <rect x="20" y="26" width="44" height="24" fill="rgba(128, 128, 128, 0.08)" stroke="var(--diagram-foreground)" stroke-width="0.65" />
                <!-- Top face -->
                <polygon points="20,26 34,14 78,14 64,26" fill="rgba(128, 128, 128, 0.14)" stroke="var(--diagram-foreground)" stroke-width="0.65" />
                <!-- Right face -->
                <polygon points="64,26 78,14 78,38 64,50" fill="rgba(128, 128, 128, 0.05)" stroke="var(--diagram-foreground)" stroke-width="0.65" />

                ${L ? `<text x="42" y="56" font-size="3.8" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="middle">${L}</text>` : ''}
                ${W ? `<text x="74" y="48" font-size="3.8" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="start">${W}</text>` : ''}
                ${H ? `<text x="16" y="39" font-size="3.8" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="end">${H}</text>` : ''}
            `;
            return this.wrapSVG(0, 0, 100, 62, svg);
        }

        if (shape.includes('cone')) {
            const svg = `
                <path d="M 28 48 A 22 6.5 0 0 1 72 48" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.7" />
                <path d="M 28 48 A 22 6.5 0 0 0 72 48" fill="rgba(128, 128, 128, 0.1)" stroke="var(--diagram-foreground)" stroke-width="0.65" />
                <line x1="50" y1="10" x2="28" y2="48" stroke="var(--diagram-foreground)" stroke-width="0.65" />
                <line x1="50" y1="10" x2="72" y2="48" stroke="var(--diagram-foreground)" stroke-width="0.65" />
            `;
            return this.wrapSVG(0, 0, 100, 60, svg);
        }

        if (shape.includes('sphere')) {
            const svg = `
                <circle cx="50" cy="30" r="22" fill="rgba(128, 128, 128, 0.08)" stroke="var(--diagram-foreground)" stroke-width="0.65" />
                <path d="M 28 30 A 22 6.5 0 0 1 72 30" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.45" stroke-dasharray="2,2" opacity="0.65" />
                <path d="M 28 30 A 22 6.5 0 0 0 72 30" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.55" />
            `;
            return this.wrapSVG(0, 0, 100, 60, svg);
        }

        // Default: Right Circular Cylinder (e.g. Question 8b)
        const svg = `
            <!-- Bottom circular base: dashed back arc + solid front arc -->
            <path d="M 28 48 A 22 6.5 0 0 1 72 48" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.5" stroke-dasharray="2.2,2.2" opacity="0.75" />
            <path d="M 28 48 A 22 6.5 0 0 0 72 48" fill="rgba(128, 128, 128, 0.08)" stroke="var(--diagram-foreground)" stroke-width="0.65" />

            <!-- Vertical lateral edges -->
            <line x1="28" y1="15" x2="28" y2="48" stroke="var(--diagram-foreground)" stroke-width="0.65" />
            <line x1="72" y1="15" x2="72" y2="48" stroke="var(--diagram-foreground)" stroke-width="0.65" />

            <!-- Top solid ellipse -->
            <ellipse cx="50" cy="15" rx="22" ry="6.5" fill="rgba(128, 128, 128, 0.14)" stroke="var(--diagram-foreground)" stroke-width="0.65" />
        `;
        return this.wrapSVG(0, 0, 100, 60, svg);
    }

    /**
     * Parses a fallback 3D solid description (e.g. Question 8b Cylinder or Question 21a Cuboid) into drawSolid3D().
     */
    private static renderSolid3DFromHint(desc: string): string {
        const lower = desc.toLowerCase();
        if (lower.includes('cylinder')) {
            return this.drawSolid3D({ shape: 'cylinder' });
        }
        if (lower.includes('cuboid')) {
            const lenM = desc.match(/length\s+(?:labeled\s+)?(\d+(?:\.\d+)?\s*cm)/i);
            const depM = desc.match(/(?:depth|width)\s+(?:labeled\s+)?(\d+(?:\.\d+)?\s*cm)/i);
            const hgtM = desc.match(/height\s+(?:labeled\s+)?(\d+(?:\.\d+)?\s*cm)/i);
            return this.drawSolid3D({
                shape: 'cuboid',
                length: lenM ? lenM[1] : '',
                width: depM ? depM[1] : '',
                height: hgtM ? hgtM[1] : ''
            });
        }
        if (lower.includes('cone')) {
            return this.drawSolid3D({ shape: 'cone' });
        }
        if (lower.includes('sphere')) {
            return this.drawSolid3D({ shape: 'sphere' });
        }
        return this.renderFallbackBox(desc);
    }
}
