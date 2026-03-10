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

                    switch (data.type) {
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
                        case 'coordinate_grid':
                            replacement = this.drawCoordinateGrid(data); break;
                        case 'tree_diagram':
                            replacement = this.drawTreeDiagram(data); break;
                        case 'composite_2d':
                            replacement = this.drawComposite2D(data); break;
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

        // Legacy hints... (Cleanup Pass)
        const legacyRegex = /\[(Type:|Diagram:|Answer Diagram:)(.*?)\]/gi;
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
        const angB = data.angle_B ? `${data.angle_B}°` : (displayLA || ""); // fallback for old JSON
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

        return this.wrapSVG(adjMinX, minY, maxX - adjMinX, maxY - minY, `
            <polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" 
                     fill="none" stroke="var(--diagram-foreground)" stroke-width="0.25" vector-effect="non-scaling-stroke" />
            ${tickMarks}

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
     * Draws Coordinate Grids and Shape Layers
     */
    private static drawCoordinateGrid(data: any): string {
        // [v9.83] Scale up tiny symmetry shapes internally so they occupy more squares on the grid
        if (data._isSymmetry) {
            const getPointsTemp = (item: any): any[] => {
                let pts: any[] = [];
                if (item.points) pts.push(...item.points);
                if (item.vertices) pts.push(...item.vertices);
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

                // If it's a 2x2 shape or smaller, scale its vertices by 3x!
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

        // [v9.59] Auto-bounds calculation
        const getRawPoints = (item: any): any[] => {
            let pts: any[] = [];
            if (item.points) pts.push(...item.points);
            if (item.vertices) pts.push(...item.vertices);
            if (item.shapes) item.shapes.forEach((s: any) => pts.push(...getRawPoints(s)));
            if (item.layers) item.layers.forEach((l: any) => pts.push(...getRawPoints(l)));
            return pts;
        };
        const allPossiblePoints = getRawPoints(data);

        let xMin = parseFloat(data.x_min);
        let xMax = parseFloat(data.x_max);
        let yMin = parseFloat(data.y_min);
        let yMax = parseFloat(data.y_max);

        // Always calculate actual geometric bounds for auto-zooming or fallback
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        if (allPossiblePoints.length > 0) {
            allPossiblePoints.forEach((p: any) => {
                const px = parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0));
                const py = parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0));
                if (Number.isFinite(px)) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); }
                if (Number.isFinite(py)) { minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
            });
        }

        if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) {
            if (allPossiblePoints.length > 0) {
                xMin = Number.isFinite(xMin) ? xMin : minX - 2;
                xMax = Number.isFinite(xMax) ? xMax : maxX + 2;
                yMin = Number.isFinite(yMin) ? yMin : minY - 2;
                yMax = Number.isFinite(yMax) ? yMax : maxY + 2;
            } else {
                xMin = -10; xMax = 10; yMin = -10; yMax = 10;
            }
        }

        // [v9.58] Support both nested layers/shapes AND root-level points (common in composite_2d components)
        let layers = data.layers || data.shapes || [];
        if (layers.length === 0 && allPossiblePoints.length > 0) {
            layers = [data]; // Treat root object as a single layer
        }

        // [v9.85] Landscape Ratio Enforcement (Q14)
        // If the graph is extremely tall and narrow (e.g. y=4x-1 from x=-2 to 2), it warps the SVG.
        // We enforce a minimum width-to-height ratio to keep grids visually balanced.
        let width = xMax - xMin;
        let height = yMax - yMin;

        const minWidthAllowed = height / 1.5;
        if (width < minWidthAllowed && Number.isFinite(width) && Number.isFinite(height)) {
            const widthDiff = minWidthAllowed - width;
            // Expand the X-axis symmetrically to fill out the grid
            xMin -= widthDiff / 2;
            xMax += widthDiff / 2;
            width = xMax - xMin;
        }

        // [v9.73] Smarter Axis Drawing - Draw axes even if origin (0,0) is out of bounds
        const xAxisY = (yMin <= 0 && yMax >= 0) ? 0 : (yMin > 0 ? -yMin : -yMax);
        const yAxisX = (xMin <= 0 && xMax >= 0) ? 0 : (xMin > 0 ? xMin : xMax);

        // [v9.87] Grid Density Fix (Q11) - Ensure at least ~10 grid subdivisions regardless of coordinates
        let gridHtml = "";
        const xStep = Math.max(1, Math.ceil((width || 10) / 10));
        const yStep = Math.max(1, Math.ceil((height || 10) / 10));

        // Outer border for the grid if it represents a clean diagram
        gridHtml += `<rect x="${xMin}" y="${-yMax}" width="${width}" height="${height}" fill="none" stroke="var(--diagram-grid)" stroke-width="0.3" opacity="1" vector-effect="non-scaling-stroke" />`;

        for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
            gridHtml += `<line x1="${x}" y1="${-yMax}" x2="${x}" y2="${-yMin}" stroke="var(--diagram-grid)" stroke-width="0.15" opacity="1" vector-effect="non-scaling-stroke" />`;
        }
        for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
            gridHtml += `<line x1="${xMin}" y1="${-y}" x2="${xMax}" y2="${-y}" stroke="var(--diagram-grid)" stroke-width="0.15" opacity="1" vector-effect="non-scaling-stroke" />`;
        }

        let layersHtml = gridHtml;

        if (data.show_axes !== false) {
            layersHtml += `
                <line x1="${xMin}" y1="${xAxisY}" x2="${xMax}" y2="${xAxisY}" stroke="var(--diagram-grid)" stroke-width="0.15" vector-effect="non-scaling-stroke" />
                <line x1="${yAxisX}" y1="${-yMax}" x2="${yAxisX}" y2="${-yMin}" stroke="var(--diagram-grid)" stroke-width="0.15" vector-effect="non-scaling-stroke" />
                <text x="${xMax}" y="${xAxisY - 0.5}" font-size="0.6" fill="var(--diagram-grid)" text-anchor="end">x</text>
                <text x="${yAxisX + 0.5}" y="${-yMax + 0.8}" font-size="0.6" fill="var(--diagram-grid)" text-anchor="start">y</text>
            `;
        }

        if (data.label_origin) {
            layersHtml += `<circle cx="0" cy="0" r="0.1" fill="var(--diagram-foreground)" />`;
            layersHtml += `<text x="0.2" y="-0.2" font-size="0.45" fill="var(--diagram-foreground)" font-weight="bold">${data.label_origin}</text>`;
        }

        // [v9.87] Axis Scrubbing (Q11) - Strip layers that merely duplicate the X or Y axis as a line
        layers = layers.filter((layer: any) => {
            const pts = layer.points || layer.vertices;
            if (pts && pts.length === 2) {
                const px1 = parseFloat(Array.isArray(pts[0]) ? pts[0][0] : pts[0].x);
                const py1 = parseFloat(Array.isArray(pts[0]) ? pts[0][1] : pts[0].y);
                const px2 = parseFloat(Array.isArray(pts[1]) ? pts[1][0] : pts[1].x);
                const py2 = parseFloat(Array.isArray(pts[1]) ? pts[1][1] : pts[1].y);
                // If it's a straight line touching axis extremes, it's an AI hallucinated axis. Remove it.
                if (px1 === 0 && px2 === 0 && py1 < -5 && py2 > 5) return false; // Y axis duplicate
                if (py1 === 0 && py2 === 0 && px1 < -5 && px2 > 5) return false; // X axis duplicate
            }
            return true;
        });

        // [Simple & Robust v9.18] Global label collision tracking
        let hasDrawnSomething = false;

        layers.forEach((layer: any) => {
            const rawPoints = layer.points || layer.vertices || [];

            // [v9.87] Triangle Differentiation (Q11): solution vs reference
            const purpose = layer.purpose || data.purpose || "solution";
            const isReference = purpose === 'reference';
            const strokeColor = isReference ? 'var(--diagram-grid)' : 'var(--diagram-foreground)';
            const fillColor = isReference ? 'none' : 'rgba(128, 128, 128, 0.15)'; // Slightly shade solution shapes

            // [FIX] Support for specific shape types like parabola (even without points)
            if (layer.shape_name === 'parabola' || layer.type === 'parabola') {
                const pathXMin = parseFloat(layer.x_min ?? xMin);
                const pathXMax = parseFloat(layer.x_max ?? xMax);
                const steps = 50;
                let d = "";
                for (let i = 0; i <= steps; i++) {
                    const px = pathXMin + (pathXMax - pathXMin) * (i / steps);
                    // Standard parabola: y = a(x-h)(x-k) or y = a(x-h)^2 + k
                    // Q21b is y = (x+3)(x-5) = x^2 - 2x - 15. Vertex at x=1, y=-16.
                    // Since AI might not provide 'a', we use a generic curve that fits the box.
                    const mid = (pathXMin + pathXMax) / 2;
                    const peak = parseFloat(layer.y_max || 10);
                    const base = parseFloat(layer.y_min || -15);
                    // Simple parabola sketch: py = (4*(base-peak)/((xmax-xmin)^2)) * (px-mid)^2 + peak
                    const py = (4 * (base - peak) / Math.pow(pathXMax - pathXMin, 2)) * Math.pow(px - mid, 2) + peak;
                    if (Number.isFinite(py)) {
                        d += `${d === "" ? 'M' : 'L'} ${px} ${-py} `;
                    }
                }
                layersHtml += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="0.3" vector-effect="non-scaling-stroke" />`;
                hasDrawnSomething = true;
            }

            if (rawPoints.length > 0) {
                const ptsArr = rawPoints.map((p: any) => {
                    const x = parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0));
                    const y = parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0));
                    return `${x},${-y}`;
                });

                // Skip if any point is NaN
                if (ptsArr.some((pt: string) => pt.includes('NaN'))) return;

                const pts = ptsArr.join(' ');

                // [v9.73] Support for Open Paths (Frequency Polygons)
                const isOpen = layer.is_open || layer.type === 'polyline' || layer.shape_name === 'polyline' || layer.shape_name === 'line_path' || layer.shape_name === 'line';
                const tag = isOpen ? 'polyline' : 'polygon';

                const dashedStyle = layer.dashed || isReference ? 'stroke-dasharray="2,3"' : '';
                const baseWidth = isReference ? 0.2 : 0.3;

                layersHtml += `<${tag} points="${pts}" fill="${isOpen ? 'none' : fillColor}" stroke="${strokeColor}" 
                                stroke-width="${baseWidth}" ${dashedStyle} 
                                vector-effect="non-scaling-stroke" />`;

                // [v9.62] Edge Label Resilience (Q23 Recovery)
                // If the shape is a triangle (3 points) and has description labels, draw them at midpoints
                if (rawPoints.length === 3) {
                    const extracted = this.extractLabelsFromDescription(layer.description || data.description || "");
                    const ptsParsed = rawPoints.map((p: any) => [
                        parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0)),
                        parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0))
                    ]);

                    // Try to map extracted labels like "AC: 26" to edges
                    // Side 1 (Pt0 to Pt1), Side 2 (Pt1 to Pt2), Side 3 (Pt2 to Pt0)
                    const edgeLabels = [
                        extracted['AB'] || extracted['AC'] || layer.side1 || "",
                        extracted['BC'] || extracted['BD'] || layer.side2 || "",
                        extracted['AC'] || extracted['DC'] || layer.side3 || ""
                    ];

                    ptsParsed.forEach((p1: number[], i: number) => {
                        const p2 = ptsParsed[(i + 1) % 3];
                        const label = edgeLabels[i] || (layer.side_labels ? layer.side_labels[i] : "");
                        if (label) {
                            const mx = (p1[0] + p2[0]) / 2;
                            const my = (p1[1] + p2[1]) / 2;
                            // Offset label slightly from the edge (v9.63: increased offset for visibility)
                            layersHtml += `<text x="${mx}" y="${-my - 1.2}" font-size="0.8" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${label}</text>`;
                        }
                    });

                    // [v9.72] Vertex Label Support (Q23) - Check both root and layer
                    const vLabels = [
                        layer.label_A || data.label_A || layer.A || data.A || "",
                        layer.label_B || data.label_B || layer.B || data.B || "",
                        layer.label_C || data.label_C || layer.C || data.C || ""
                    ];
                    ptsParsed.forEach((p: number[], i: number) => {
                        if (vLabels[i]) {
                            layersHtml += `<text x="${p[0]}" y="${-p[1] + 1.2}" font-size="1.0" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${vLabels[i]}</text>`;
                        }
                    });
                }

                // Render Vertex Labels - Global collision check v9.18
                let hasLocalVertexLabels = false;
                rawPoints.forEach((p: any) => {
                    const vLabel = Array.isArray(p) ? p[2] : p.label;
                    if (vLabel) {
                        const vx = parseFloat(Array.isArray(p) ? p[0] : (p.x ?? 0));
                        const vy = parseFloat(Array.isArray(p) ? p[1] : (p.y ?? 0));

                        if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;

                        const coordKey = `${Math.round(vx * 2) / 2},${Math.round(vy * 2) / 2}`; // 0.5 unit tolerance

                        if (!DiagramService.renderedGlobalLabels.has(coordKey)) {
                            layersHtml += `<text x="${vx}" y="${-vy - 0.7}" font-size="0.4" fill="var(--diagram-foreground)" text-anchor="middle" font-weight="bold">${vLabel}</text>`;
                            DiagramService.renderedGlobalLabels.add(coordKey);
                            hasLocalVertexLabels = true;
                        }
                    }
                });

                // Only show overall layer label if no specific vertices in this layer OR nearby coordinates were labeled
                const firstPtRaw = Array.isArray(rawPoints[0]) ? rawPoints[0] : [rawPoints[0].x, rawPoints[0].y];
                const firstPt = [parseFloat(firstPtRaw[0]), parseFloat(firstPtRaw[1])];

                if (Number.isFinite(firstPt[0]) && Number.isFinite(firstPt[1])) {
                    const firstPtKey = `${Math.round(firstPt[0] * 2) / 2},${Math.round(firstPt[1] * 2) / 2}`;
                    if (layer.label && !hasLocalVertexLabels && !DiagramService.renderedGlobalLabels.has(firstPtKey)) {
                        layersHtml += `<text x="${firstPt[0]}" y="${-firstPt[1] - 0.7}" font-size="0.5" fill="var(--diagram-foreground)" font-weight="bold" text-anchor="middle">${layer.label}</text>`;
                        DiagramService.renderedGlobalLabels.add(firstPtKey);
                    }
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
        let initialBranches = data.branches || data.children || [];

        // [v9.54] Support for nested tree structure (Frequency Trees)
        const flattenTree = (node: any, fromLabel: string = "Start"): any[] => {
            const children = node.children || node.branches || [];
            if (!Array.isArray(children) || children.length === 0) return [];
            return children.flatMap((child: any) => {
                const flatBranch = {
                    from: fromLabel,
                    to: child.label || child.text || child.split || "End",
                    prob: child.prob || child.value || ""
                };
                return [flatBranch, ...flattenTree(child, flatBranch.to)];
            });
        };

        // If the first branch looks like a root node (has children/branches), flatten it
        let branches = initialBranches;
        if (branches.length === 1 && (branches[0].children || branches[0].branches)) {
            branches = flattenTree(branches[0], branches[0].label || "Start");
        } else if (branches.length > 0 && (branches[0].children || branches[0].branches)) {
            // Root-less list of branches with nested children
            branches = branches.flatMap((b: any) => [
                { from: "Start", to: b.split || b.label || "End", prob: b.value || b.prob || "" },
                ...flattenTree(b, b.split || b.label || "End")
            ]);
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
            html += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="var(--diagram-foreground)" stroke-width="0.5" />`;
            html += `<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 2}" font-size="1.8" text-anchor="middle" fill="var(--diagram-foreground)">${b.prob}</text>`;
            html += `<text x="${p2.x + 2}" y="${p2.y + 1}" font-size="1.8" fill="var(--diagram-foreground)">${to}</text>`;
        });

        // If no branches rendered, fallback
        if (!html) return this.renderFallbackBox(data.description || "Tree Diagram");

        return this.wrapSVG(-5, -30, 80, 60, html);
    }

    /**
     * Draws Function Graphs (Algebraic Curves) - Simple & Robust v9.26
     */
    private static drawFunctionGraph(data: any): string {
        let xMin = parseFloat(data.x_min ?? -5);
        let xMax = parseFloat(data.x_max ?? 5);
        const yMin = parseFloat(data.y_min ?? -5);
        const yMax = parseFloat(data.y_max ?? 10);

        // [FIX] Defensive Validation
        if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) {
            return this.renderFallbackBox(data.description || "Function Graph (Invalid bounds)");
        }

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
                } else if (norm.includes('x^2') || norm.includes('x**2') || norm.includes('x^{2}')) {
                    // [v9.61] Generic Parabola Support for Q21b
                    // Patterns: x^2, (x+3)(x-5)
                    if (norm.includes('(x+3)(x-5)')) {
                        y = (x + 3) * (x - 5);
                    } else if (norm.includes('(x-3)(x+5)')) {
                        y = (x - 3) * (x + 5);
                    } else {
                        y = x * x; // Default x^2
                    }
                } else {
                    y = Math.pow(1.5, x);
                }

                if (isReflected) y = -y;
                y = (y * scaleY) + verticalShift;

                const plotY = -y;
                if (!Number.isFinite(plotY)) continue;
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
        const mainPd = generatePath(mainEqn, parseFloat(data.scale || 1), parseFloat(data.shift || 0), data.reflect || false);
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

            const pD = generatePath(layerEqn || data.equation_label || "5^{x}", parseFloat(layer.scale || 1), parseFloat(layer.shift || 0), layer.reflect || false);
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
        return `
        <div class="model_diagram_composite" style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">
            ${renderedComponents.join('')}
        </div>
        `;
    }

    private static wrapSVG(x: number, y: number, w: number, h: number, body: string): string {
        // [FIX] Defensive Validation for viewBox
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
            return `<div class="diagram-error">Diagram render error: NaN in viewBox</div>`;
        }

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
            <strong>📐 Diagram Reference:</strong>
            ${description}
        </div>`;
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

            return `
            <table class="model_table" style="margin: 10px 0;">
                <thead>
                    <tr><th>Class / Interval</th><th>Frequency</th></tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>`;
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

            return `
            <div class="diagram-list-wrapper">
                ${itemsHtml}
            </div>`;
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
}
