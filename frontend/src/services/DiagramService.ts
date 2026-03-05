/**
 * DiagramService - Text-to-SVG post-processor for Mathematical Diagrams
 * Focused on GCSE Maths (Geometry, Coordinates, Statistics)
 */

export interface DiagramData {
    type: string;
    config: any;
    isValid: boolean;
}

export class DiagramService {
    /**
     * Main entry point: Scans text for [Diagram: ...] tokens and replaces them with SVG
     * Currently returns stringified HTML/SVG for post-processing injection
     */
    public static process(content: string): string {
        if (!content || typeof content !== 'string') return content;

        // Regex for any bracketed content [ ... ]
        const diagramRegex = /\[(.*?)\]/gi;

        return content.replace(diagramRegex, (match, description) => {
            try {
                const diagram = this.parseDiagramDescription(description);
                if (diagram && diagram.isValid) {
                    return this.renderSVG(diagram);
                }
                // Fallback to original text if parsing fails or invalid
                return match;
            } catch (e) {
                console.error('[DiagramService] Processing error:', e);
                return match;
            }
        });
    }

    /**
     * Parses the natural language description into structured geometric data
     * For the PoC, we use regex-based parsing for common patterns
     */
    private static parseDiagramDescription(desc: string): DiagramData | null {
        const d = desc.toLowerCase();

        // 1. Triangle Detection
        if (d.includes('triangle') || (d.includes('abc') && !d.includes('d'))) {
            return this.parseTriangle(d);
        }

        // 2. Coordinate Grid Detection
        if (d.includes('grid') || d.includes('graph') || d.includes('axis')) {
            return this.parseCoordinateGrid(d);
        }

        // 3. Parallelogram/Polygon Detection
        // Handle explicit keywords or implicit 4-point labels (e.g., ABCD)
        if (d.includes('parallelogram') || d.includes('quadrilateral') || d.includes('rectangle') ||
            d.includes('abcd') || (d.includes('angle') && d.includes('d'))) {
            return this.parsePolygon(d, 'parallelogram');
        }

        return null;
    }

    private static parseTriangle(desc: string): DiagramData {
        // Basic extraction for PoC: "triangle ABC with side BC=80, AC=120"
        // We scale by 10 for better SVG visibility
        const sideMatch = desc.match(/side\s+([a-z]{2})[=\s]*(\d+)/gi);
        const config: any = { sides: {} };

        if (sideMatch) {
            sideMatch.forEach(m => {
                const parts = m.match(/([a-z]{2})[=\s]*(\d+)/i);
                if (parts) {
                    config.sides[parts[1].toUpperCase()] = parseInt(parts[2]) * 5; // Scaling factor
                }
            });
        }

        // Default triangle if no specific sides found (Equilateral-ish)
        return {
            type: 'triangle',
            config: {
                points: { A: [50, 20], B: [150, 150], C: [20, 150] },
                labels: config.sides,
                ...config
            },
            isValid: true
        };
    }

    private static parseCoordinateGrid(desc: string): DiagramData {
        // grid with line y=2x+1
        const lineMatch = desc.match(/y\s*=\s*([-]?\d*)x\s*([+-]\s*\d+)?/i);
        const config: any = { line: null };

        if (lineMatch) {
            config.line = {
                m: parseInt(lineMatch[1]) || (lineMatch[1] === '-' ? -1 : 1),
                c: parseInt(lineMatch[2]?.replace(/\s+/g, '')) || 0
            };
        }

        return {
            type: 'grid',
            config,
            isValid: true
        };
    }

    private static parsePolygon(desc: string, type: string): DiagramData {
        return {
            type: type,
            config: {},
            isValid: true
        };
    }

    /**
     * Renders the structured data into a theme-aware static SVG string
     */
    private static renderSVG(diagram: DiagramData): string {
        const { type, config } = diagram;

        if (type === 'triangle') {
            const { points, labels } = config;
            return `
        <div class="svg-diagram-wrapper" style="margin: 20px 0; text-align: center;">
          <svg width="200" height="200" viewBox="0 0 200 200" style="background: transparent;">
            <polygon points="${points.A.join(',')}, ${points.B.join(',')}, ${points.C.join(',')}" 
                     fill="none" stroke="currentColor" stroke-width="2" />
            <text x="${points.A[0]}" y="${points.A[1] - 5}" text-anchor="middle" fill="currentColor">A</text>
            <text x="${points.B[0] + 5}" y="${points.B[1] + 5}" fill="currentColor">B</text>
            <text x="${points.C[0] - 10}" y="${points.C[1] + 5}" fill="currentColor">C</text>
            <!-- Mock labels for PoC -->
            <text x="100" y="170" text-anchor="middle" fill="currentColor">${labels['BC'] ? labels['BC'] + 'cm' : ''}</text>
            <text x="30" y="80" text-anchor="end" fill="currentColor">${labels['AC'] ? labels['AC'] + 'cm' : ''}</text>
          </svg>
        </div>
      `.trim();
        }

        if (type === 'grid') {
            return `
        <div class="svg-diagram-wrapper" style="margin: 20px 0; text-align: center;">
          <svg width="200" height="200" viewBox="0 0 200 200" style="background: transparent;">
            <!-- Axes -->
            <line x1="100" y1="10" x2="100" y2="190" stroke="currentColor" stroke-width="1" />
            <line x1="10" y1="100" x2="190" y2="100" stroke="currentColor" stroke-width="1" />
            <!-- Line y=mx+c simulation -->
            <line x1="50" y1="150" x2="150" y2="50" stroke="currentColor" stroke-width="2" stroke-dasharray="4" />
            <text x="155" y="45" font-size="12" fill="currentColor">y = ${config.line?.m}x + ${config.line?.c}</text>
          </svg>
        </div>
      `.trim();
        }

        if (type === 'parallelogram') {
            return `
        <div class="svg-diagram-wrapper" style="margin: 20px 0; text-align: center;">
          <svg width="240" height="160" viewBox="0 0 240 160" style="background: transparent;">
            <!-- Parallelogram ABCD -->
            <polygon points="60,30 220,30 180,130 20,130" 
                     fill="none" stroke="currentColor" stroke-width="2" />
            <text x="60" y="25" text-anchor="middle" fill="currentColor">A</text>
            <text x="220" y="25" text-anchor="middle" fill="currentColor">B</text>
            <text x="185" y="145" text-anchor="middle" fill="currentColor">C</text>
            <text x="15" y="145" text-anchor="middle" fill="currentColor">D</text>
            
            <!-- Diagonal AC if relevant -->
            <line x1="60" y1="30" x2="180" y2="130" stroke="currentColor" stroke-width="1" stroke-dasharray="2" />
          </svg>
        </div>
      `.trim();
        }

        return '';
    }
}
