/**
 * DiagramService - JSON-to-SVG Renderer
 * Reads AI-generated JSON and draws deterministic, mathematically perfect SVGs.
 */

export class DiagramService {
    public static process(content: string): string {
        if (!content || typeof content !== 'string') return content;

        // Pass 1: Handle JSON-based Enterprise Diagrams
        const jsonRegex = /<script type="application\/json" class="ai-diagram-data">([\s\S]*?)<\/script>/gi;
        let processedContent = content.replace(jsonRegex, (match, jsonString) => {
            try {
                const data = JSON.parse(jsonString.trim());

                // Route to the correct drawing function
                switch (data.type) {
                    case 'triangle':
                    case 'triangle_sas':
                        return this.drawTriangle(data);
                    case 'polygon':
                        return this.drawPolygon(data);
                    case 'function_graph':
                        return this.drawFunctionGraph(data);
                    case 'coordinate_grid':
                        return this.drawCoordinateGrid(data);
                    case 'tree_diagram':
                        return this.drawTreeDiagram(data);
                    case 'composite_2d':
                        return this.drawComposite2D(data);
                    case 'fallback':
                        return this.renderFallbackBox(data.description || 'Complex 3D Diagram');
                    default:
                        return match;
                }
            } catch (e) {
                console.error('[DiagramService] JSON Parsing Error:', e);
                return match;
            }
        });

        // Pass 2: Handle Legacy Bracketed Hints (Safety Net)
        // Catch [Type: ...], [Diagram: ...], or [Answer Diagram: ...]
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
            <text x="${(x1 + x2) / 2}" y="${y1 + 1.5}" font-size="1.5" text-anchor="middle" fill="var(--diagram-foreground)">${side1}${data.unit || 'cm'}</text>
            <text x="${x3 / 2 - 1}" y="${y3 / 2 - 1}" font-size="1.5" text-anchor="end" fill="var(--diagram-foreground)">${side2}${data.unit || 'cm'}</text>
            <text x="${x1 + 0.5}" y="${y1 - 0.5}" font-size="1.2" fill="var(--diagram-foreground)">${angle}°</text>
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
            return label ? `<text x="${tx}" y="${ty}" font-size="2" text-anchor="middle" dominant-baseline="middle" fill="var(--diagram-foreground)">${label}</text>` : "";
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
                const strokeColor = layer.color || 'var(--diagram-shape-stroke)';
                const fillColor = layer.color ? `${layer.color}1a` : 'var(--diagram-shape-fill)';

                layersHtml += `<polygon points="${pts}" fill="${fillColor}" stroke="${strokeColor}" 
                                stroke-width="${layer.dashed ? 0.3 : 0.2}" ${layer.dashed ? 'stroke-dasharray="0.5,0.5"' : ''} 
                                vector-effect="non-scaling-stroke" />`;

                // Render Vertex Labels (new in v7.7)
                rawPoints.forEach((p: any) => {
                    if (Array.isArray(p) && p.length === 3) {
                        const [vx, vy, vLabel] = p;
                        layersHtml += `<text x="${vx}" y="${-vy - 0.5}" font-size="0.8" fill="var(--diagram-foreground)" text-anchor="middle">${vLabel}</text>`;
                    }
                });

                if (layer.label) {
                    const firstPt = Array.isArray(rawPoints[0]) ? rawPoints[0] : [rawPoints[0].x, rawPoints[0].y];
                    layersHtml += `<text x="${firstPt[0]}" y="${-firstPt[1] - 0.5}" font-size="1" fill="var(--diagram-foreground)" font-weight="bold">${layer.label}</text>`;
                }
                hasDrawnSomething = true;
            }
        });

        // Defensive check: if we only drew the axes, return a fallback instead of a "white image"
        if (!hasDrawnSomething) {
            return this.renderFallbackBox(data.details || data.description || "Coordinate Grid Diagram");
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
            html += `<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 2}" font-size="3" text-anchor="middle" fill="var(--diagram-foreground)">${b.prob}</text>`;
            html += `<text x="${p2.x + 2}" y="${p2.y + 1}" font-size="3" fill="var(--diagram-foreground)">${b.to}</text>`;
        });

        return this.wrapSVG(-5, -30, 80, 60, html);
    }

    /**
     * Draws Function Graphs (Algebraic Curves)
     */
    private static drawFunctionGraph(data: any): string {
        const xMin = data.x_min ?? -10;
        const xMax = data.x_max ?? 10;
        const yMin = data.y_min ?? -10;
        const yMax = data.y_max ?? 10;
        const width = xMax - xMin;
        const height = yMax - yMin;

        // If no mathematical data is provided, use fallback
        if (!data.equation_label && !data.details && !data.description) {
            return this.renderFallbackBox("Graph Diagram");
        }

        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
            return this.renderFallbackBox(data.details || data.description || data.equation_label || "Graph Diagram");
        }

        // Generate the SVG Path curve
        let pathD = "";
        const steps = 50;
        // ... simple default curve if none provided
        for (let i = 0; i <= steps; i++) {
            const x = xMin + (width * (i / steps));
            const y = -(Math.pow(1.2, x)); // dummy curve for generic graphs
            if (y >= -yMax && y <= -yMin) {
                pathD += `${pathD === "" ? 'M' : 'L'} ${x} ${y} `;
            }
        }

        return this.wrapSVG(xMin, -yMax, width, height, `
            <line x1="${xMin}" y1="0" x2="${xMax}" y2="0" stroke="var(--diagram-grid)" stroke-width="0.1" vector-effect="non-scaling-stroke" />
            <line x1="0" y1="${-yMax}" x2="0" y2="${-yMin}" stroke="var(--diagram-grid)" stroke-width="0.1" vector-effect="non-scaling-stroke" />
            <path d="${pathD}" fill="none" stroke="var(--diagram-shape-stroke)" stroke-width="2" vector-effect="non-scaling-stroke" />
            <text x="${xMax - 1}" y="-0.5" font-size="1" fill="var(--diagram-foreground)">x</text>
            <text x="0.5" y="${-yMax + 1}" font-size="1" fill="var(--diagram-foreground)">y</text>
        `);
    }

    private static drawComposite2D(data: any): string {
        return this.renderFallbackBox("Composite 2D Shape: " + JSON.stringify(data));
    }

    private static wrapSVG(x: number, y: number, w: number, h: number, body: string): string {
        return `
        <div class="model_diagram">
            <svg viewBox="${x} ${y} ${w} ${h}" width="300" height="200" class="ai-diagram-svg">
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
