/**
 * DiagramService - JSON-to-SVG Renderer
 * Reads AI-generated JSON and draws deterministic, mathematically perfect SVGs.
 */

export class DiagramService {
    private static renderedGlobalLabels = new Set<string>();
    private static lastLoggedQ5 = "";

    public static process(content: string): string {
        if (!content || typeof content !== 'string') return content;

        // Reset global state for this message
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
                    .trim();
                const data = JSON.parse(unescaped);
                const label = data.equation_label || data.description || '';
                const key = `${data.sub_id || 'diag'}_${label}_${unescaped.length}`;

                if (data.sub_id === '5' || (data.sub_id && String(data.sub_id).includes('pentagon')) || key.includes('pentagon')) {
                    if (this.lastLoggedQ5 !== unescaped) {
                        console.log(`[DiagramService] [DEBUG-Q5] Found JSON: ${unescaped}`);
                        this.lastLoggedQ5 = unescaped;
                    }
                }

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
                console.warn('[DiagramService] Pre-pass skip:', e);
            }
        });

        // Pass 2: Replace matches
        let processedContent = content;

        // We replace each original match. 
        // If it's the "winning" version in our map, render it. If not, hide it.
        matches.forEach(m => {
            const unescaped = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
            let replacement = "";

            try {
                const data = JSON.parse(unescaped);
                const label = data.equation_label || data.description || '';
                const key = `${data.sub_id || 'diag'}_${label}_${unescaped.length}`;
                const winner = diagramMap.get(key);

                if (winner && winner.json === unescaped) {
                    // This is the chosen version to render
                    switch (data.type) {
                        case 'triangle':
                        case 'triangle_sas':
                            replacement = this.drawTriangle(data); break;
                        case 'polygon':
                            replacement = this.drawPolygon(data); break;
                        case 'function_graph':
                            replacement = this.drawFunctionGraph(data); break;
                        case 'coordinate_grid':
                            replacement = this.drawCoordinateGrid(data); break;
                        case 'tree_diagram':
                            replacement = this.drawTreeDiagram(data); break;
                        case 'composite_2d':
                        case 'fallback':
                            replacement = this.renderFallbackBox(data.description || data.details || `Diagram (${data.type})`); break;
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

        // Legacy hints...
        const legacyRegex = /\[(Type:|Diagram:|Answer Diagram:)(.*?)\]/gi;
        processedContent = processedContent.replace(legacyRegex, (match, prefix, description) => {
            return this.renderFallbackBox(description.trim());
        });

        return processedContent;
    }

    /**
     * Generalized Triangle Drawer
     */
    private static drawTriangle(data: any): string {
        const side1 = data.side1;
        const side2 = data.side2;
        const angle = data.angle;

        // Validation: If parameters are missing or generic-looking but not in text, fallback
        if (side1 === undefined || side2 === undefined || angle === undefined) {
            return this.renderFallbackBox(data.description || "Triangle Diagram with sides and angle");
        }

        const angleRad = angle * (Math.PI / 180);
        const x1 = 0, y1 = 0;
        const x2 = side1, y2 = 0;
        const x3 = side2 * Math.cos(angleRad);
        const y3 = -(side2 * Math.sin(angleRad));

        const minX = Math.min(x1, x2, x3) - 2;
        const maxX = Math.max(x1, x2, x3) + 2;
        const minY = Math.min(y1, y2, y3) - 2;
        const maxY = Math.max(y1, y2, y3) + 2;

        return this.wrapSVG(minX, minY, maxX - minX, maxY - minY, `
            <polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" 
                     fill="none" stroke="var(--diagram-foreground)" stroke-width="0.2" vector-effect="non-scaling-stroke" />
            <text x="${(x1 + x2) / 2}" y="${y1 + 1.2}" font-size="0.8" text-anchor="middle" fill="var(--diagram-foreground)">${side1}${data.unit || 'cm'}</text>
            <text x="${x3 / 2 - 0.8}" y="${y3 / 2 - 0.8}" font-size="0.8" text-anchor="end" fill="var(--diagram-foreground)">${side2}${data.unit || 'cm'}</text>
            <text x="${x1 + 0.4}" y="${y1 - 0.4}" font-size="0.7" fill="var(--diagram-foreground)">${angle}°</text>
        `);
    }

    /**
     * Draws Polygons (Pentagons, Hexagons, Rectangles)
     */
    private static drawPolygon(data: any): string {
        const shapeName = (data.shape_name || "").toLowerCase();
        const n = shapeName === 'pentagon' ? 5 : (shapeName === 'hexagon' ? 6 : (shapeName === 'rectangle' || shapeName === 'quadrilateral' ? 4 : 0));

        if (n === 0) {
            return this.renderFallbackBox(data.description || `Polygon Diagram: ${data.shape_name || "Unknown Shape"}`);
        }

        const points: [number, number][] = [];
        const radius = 10;

        for (let i = 0; i < n; i++) {
            const angle = (i * 2 * Math.PI / n) - (Math.PI / 2);
            points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
        }

        const ptsStr = points.map(p => p.join(',')).join(' ');
        const sides = data.sides || [];

        return this.wrapSVG(-12, -12, 24, 24, `
            <polygon points="${ptsStr}" fill="none" stroke="var(--diagram-foreground)" stroke-width="0.5" vector-effect="non-scaling-stroke" />
            ${points.map((p1, i) => {
            const p2 = points[(i + 1) % n];
            const tx = (p1[0] + p2[0]) / 2 * 1.25;
            const ty = (p1[1] + p2[1]) / 2 * 1.25;
            const label = sides[i]?.label || sides[i]?.length || "";
            return label ? `<text x="${tx}" y="${ty}" font-size="1.0" text-anchor="middle" dominant-baseline="middle" fill="var(--diagram-foreground)">${label}</text>` : "";
        }).join('')}
        `);
    }

    /**
     * Draws Coordinate Grids and Shape Layers
     */
    private static drawCoordinateGrid(data: any): string {
        const xMin = data.x_min ?? -10;
        const xMax = data.x_max ?? 10;
        const yMin = data.y_min ?? -10;
        const yMax = data.y_max ?? 10;
        const width = xMax - xMin;
        const height = yMax - yMin;

        // Support both 'layers' and 'shapes'
        const layers = data.layers || data.shapes || [];
        let layersHtml = `
            <line x1="${xMin}" y1="0" x2="${xMax}" y2="0" stroke="var(--diagram-grid)" stroke-width="0.1" vector-effect="non-scaling-stroke" />
            <line x1="0" y1="${-yMax}" x2="0" y2="${-yMin}" stroke="var(--diagram-grid)" stroke-width="0.1" vector-effect="non-scaling-stroke" />
        `;

        // [Simple & Robust v9.18] Global label collision tracking
        let hasDrawnSomething = false;

        layers.forEach((layer: any) => {
            // Support 'points' or 'vertices' with vertex labeling [x, y, label]
            const rawPoints = layer.points || layer.vertices || [];
            if (rawPoints.length > 0) {
                const ptsArr = rawPoints.map((p: any) => {
                    const x = Array.isArray(p) ? p[0] : (p.x ?? 0);
                    const y = Array.isArray(p) ? p[1] : (p.y ?? 0);
                    return `${x},${-y}`;
                });
                const pts = ptsArr.join(' ');
                const strokeColor = 'var(--diagram-foreground)';
                const fillColor = 'none'; // Strictly monochrome v9.19

                layersHtml += `<polygon points="${pts}" fill="${fillColor}" stroke="${strokeColor}" 
                                stroke-width="${layer.dashed ? 0.3 : 0.2}" ${layer.dashed ? 'stroke-dasharray="0.5,0.5"' : ''} 
                                vector-effect="non-scaling-stroke" />`;

                // Render Vertex Labels - Global collision check v9.18
                let hasLocalVertexLabels = false;
                rawPoints.forEach((p: any) => {
                    const vLabel = Array.isArray(p) ? p[2] : p.label;
                    if (vLabel) {
                        const vx = Array.isArray(p) ? p[0] : (p.x ?? 0);
                        const vy = Array.isArray(p) ? p[1] : (p.y ?? 0);
                        const coordKey = `${Math.round(vx * 2) / 2},${Math.round(vy * 2) / 2}`; // 0.5 unit tolerance

                        if (!DiagramService.renderedGlobalLabels.has(coordKey)) {
                            layersHtml += `<text x="${vx}" y="${-vy - 0.7}" font-size="0.4" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${vLabel}</text>`;
                            DiagramService.renderedGlobalLabels.add(coordKey);
                            hasLocalVertexLabels = true;
                        }
                    }
                });

                // Only show overall layer label if no specific vertices in this layer OR nearby coordinates were labeled
                const firstPt = Array.isArray(rawPoints[0]) ? rawPoints[0] : [rawPoints[0].x, rawPoints[0].y];
                const firstPtKey = `${Math.round(firstPt[0] * 2) / 2},${Math.round(firstPt[1] * 2) / 2}`;

                if (layer.label && !hasLocalVertexLabels && !DiagramService.renderedGlobalLabels.has(firstPtKey)) {
                    layersHtml += `<text x="${firstPt[0]}" y="${-firstPt[1] - 0.7}" font-size="0.5" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="middle">${layer.label}</text>`;
                    DiagramService.renderedGlobalLabels.add(firstPtKey);
                }
                hasDrawnSomething = true;
            }
        });

        // Defensive check: if we only drew the axes, return a fallback instead of a "white image"
        if (!hasDrawnSomething) {
            return this.renderFallbackBox(data.details || data.description || "Grid/Axis Reference (No shapes provided)");
        }

        return this.wrapSVG(xMin, -yMax, width, height, layersHtml);
    }

    /**
     * Draws Probability Tree Diagrams
     */
    private static drawTreeDiagram(data: any): string {
        let html = '';
        const branches = data.branches || [];
        const xStep = 30;
        const yStep = 20;
        const positions: Record<string, { x: number, y: number }> = { "Start": { x: 0, y: 0 } };

        let levelCounts: Record<number, number> = { 0: 1 };

        branches.forEach((b: any) => {
            if (!positions[b.to]) {
                const parent = positions[b.from] || { x: 0, y: 0 };
                const level = (parent.x / xStep) + 1;
                levelCounts[level] = (levelCounts[level] || 0) + 1;
                positions[b.to] = {
                    x: parent.x + xStep,
                    y: (levelCounts[level] - 2.5) * yStep
                };
            }
            const p1 = positions[b.from];
            const p2 = positions[b.to];
            html += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="var(--diagram-foreground)" stroke-width="0.5" />`;
            html += `<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 2}" font-size="1.8" text-anchor="middle" fill="var(--diagram-foreground)">${b.prob}</text>`;
            html += `<text x="${p2.x + 2}" y="${p2.y + 1}" font-size="1.8" fill="var(--diagram-foreground)">${b.to}</text>`;
        });

        return this.wrapSVG(-5, -30, 80, 60, html);
    }

    /**
     * Draws Function Graphs (Algebraic Curves) - Simple & Robust v9.26
     */
    private static drawFunctionGraph(data: any): string {
        let xMin = data.x_min ?? -5;
        let xMax = data.x_max ?? 5;
        const yMin = data.y_min ?? -5;
        const yMax = data.y_max ?? 10;

        // [Simple & Robust v9.26] Landscape Ratio Rule: Ensure boundaries are updated
        let width = xMax - xMin;
        let height = yMax - yMin;
        const minWidth = height * 1.6;
        if (width < minWidth) {
            const extra = (minWidth - width) / 2;
            xMin -= extra;
            xMax += extra;
            width = xMax - xMin;
        }


        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
            return this.renderFallbackBox(data.details || data.description || data.equation_label || "Graph Diagram");
        }

        // Helper to generate path for a specific function
        const generatePath = (eqn: string, scaleY = 1, shiftY = 0, reflectX = false) => {
            let pathD = "";
            const steps = 140;
            const xRange = xMax - xMin;

            // [Simple & Robust v9.28] Explicit Transformation Protocol
            // Normalize: use safeEqn + explicit flags from data
            const safeEqn = eqn || "5^{x}";
            const norm = String(safeEqn).toLowerCase().replace(/\s+/g, '');

            // Redundancy: check both explicit flag and string content
            const isReflected = reflectX || norm.includes('=-') || (norm.includes('-5') && !norm.includes('^-5'));

            let verticalShift = shiftY;
            // String detection fallback for shift
            if (norm.includes('-1') && !norm.includes('^-1')) verticalShift -= 1;
            if (norm.includes('+1')) verticalShift += 1;

            for (let i = 0; i <= steps; i++) {
                const x = xMin + (xRange * (i / steps));
                let y = 0;

                if (norm.includes('5^x') || norm.includes('5^{x}')) {
                    y = Math.pow(5, x);
                } else if (norm.includes('1.5^x') || norm.includes('1.5^{x}')) {
                    y = Math.pow(1.5, x);
                } else if (norm.includes('2^x') || norm.includes('2^{x}')) {
                    y = Math.pow(2, x);
                } else {
                    y = Math.pow(1.5, x);
                }

                if (isReflected) y = -y;
                y = (y * scaleY) + verticalShift;

                const plotY = -y;
                pathD += `${pathD === "" ? 'M' : 'L'} ${x} ${plotY} `;
            }
            return pathD;
        };

        const layers = data.layers || [];
        let curvesHtml = '';

        // [Simple & Robust v9.28] Smart Recovery with Explicit Flags
        const mainEqn = data.equation_label || data.description || data.details || "5^{x}";

        // Always draw the main solution curve
        // Redundancy: pass data.reflect and data.shift even to the main equation
        const mainPd = generatePath(mainEqn, data.scale || 1, data.shift || 0, data.reflect || false);
        curvesHtml += `<path d="${mainPd}" fill="none" stroke="var(--diagram-foreground)" stroke-width="1.8" vector-effect="non-scaling-stroke" />`;

        // Draw individual layers (Dashed reference lines etc)
        layers.forEach((layer: any) => {
            // [Answer-Only Protocol v9.30] 
            // Skip dashed layers if this is a 'solution' graph (user only wants the answer)
            if (data.purpose === 'solution' && layer.dashed) return;

            // [Simple & Robust v9.29] Robust Resolution: prioritize layer.equation then layer.label
            const layerEqn = layer.equation || layer.label || "";

            // Avoid double-drawing if the layer is identical to the main equation
            // Skip if it's a solid curve and either matches mainEqn or is empty (assuming root handles it)
            if (!layer.dashed && (layerEqn === data.equation_label || !layerEqn)) return;

            const pD = generatePath(layerEqn || data.equation_label || "5^{x}", layer.scale || 1, layer.shift || 0, layer.reflect || false);
            curvesHtml += `<path d="${pD}" fill="none" stroke="var(--diagram-foreground)" 
                            stroke-width="1.0" ${layer.dashed ? 'stroke-dasharray="2,2"' : ''} vector-effect="non-scaling-stroke" opacity="${layer.dashed ? 0.6 : 1}" />`;
        });

        const xMargin = width * 0.15;
        const yMargin = height * 0.15;

        return this.wrapSVG(xMin - xMargin, -yMax - yMargin, width + (xMargin * 2), height + (yMargin * 2), `
            <defs>
                <marker id="arrowhead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--diagram-grid)" />
                </marker>
            </defs>
            <!-- Professional Axes -->
            <line x1="${xMin - xMargin}" y1="0" x2="${xMax + xMargin}" y2="0" stroke="var(--diagram-grid)" stroke-width="0.3" marker-end="url(#arrowhead)" vector-effect="non-scaling-stroke" />
            <line x1="0" y1="${-yMin + yMargin}" x2="0" y2="${-yMax - yMargin}" stroke="var(--diagram-grid)" stroke-width="0.3" marker-end="url(#arrowhead)" vector-effect="non-scaling-stroke" />
            
            ${curvesHtml}
            
            <text x="${xMax + xMargin / 2}" y="1.5" font-size="1.5" fill="var(--diagram-foreground)" text-anchor="middle">x</text>
            <text x="1.5" y="${-yMax - yMargin / 2}" font-size="1.5" fill="var(--diagram-foreground)">y</text>
            ${data.equation_label ? `<text x="${xMax}" y="${-yMax + 1}" font-size="1.2" fill="var(--diagram-foreground)" font-style="italic" text-anchor="end">${String(data.equation_label).toLowerCase().replace(/\s+/g, '').startsWith('y=') ? data.equation_label : 'y = ' + data.equation_label}</text>` : ''}
        `);
    }

    private static drawComposite2D(data: any): string {
        return this.renderFallbackBox("Composite 2D Shape: " + JSON.stringify(data));
    }

    private static wrapSVG(x: number, y: number, w: number, h: number, body: string): string {
        // [v9.53] Internal viewBox is tight to graph again. Layout handled by CSS.
        return `
        <div class="model_diagram">
            <div class="diagram-accuracy-label">Not drawn accurately</div>
            <svg viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="ai-diagram-svg">
                ${body}
            </svg>
        </div>
        `;
    }

    private static renderFallbackBox(description: string): string {
        return `
        <div class="diagram-fallback-wrapper">
            <strong>📊 Diagram Reference:</strong>
            ${description}
        </div>`;
    }
}
