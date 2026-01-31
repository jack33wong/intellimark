
import { MarkingPositioningService } from '../MarkingPositioningService.js';
import { MarkingTask } from '../../../types/index.js';
import { MarkingTaskFactory } from './MarkingTaskFactory.js';

export class ZoneArchitect {
    /**
     * Orchestrates the detection and refinement of semantic zones.
     * Migrated faithfully from the original MarkingExecutor.
     */
    static detectAndRefineZones(
        task: MarkingTask,
        pageHeightForZones: number
    ): Record<string, any[]> {
        // 1. Derive expected questions
        const classificationExpected = MarkingTaskFactory.deriveExpectedQuestionsFromClassification(task);
        const expectedQuestions = classificationExpected.map(c => ({ ...c, targetPageIndex: 0 }));

        const rawOcrBlocksForZones = task.mathBlocks.map((block) => ({
            text: block.mathpixLatex || (block as any).googleVisionText || '',
            coordinates: block.coordinates,
            pageIndex: (block as any).pageIndex ?? 0
        }));

        let nextQuestionText = task.nextQuestionText;

        // 2. Perform raw detection
        const semanticZones = MarkingPositioningService.detectSemanticZones(
            rawOcrBlocksForZones,
            pageHeightForZones,
            expectedQuestions,
            nextQuestionText
        );

        // 3. MERGE ZONES (Combine segments on same page)
        Object.keys(semanticZones).forEach(key => {
            const zones = semanticZones[key];
            const mergedZones: any[] = [];
            const byPage: Record<number, any[]> = {};
            zones.forEach(z => {
                if (!byPage[z.pageIndex]) byPage[z.pageIndex] = [];
                byPage[z.pageIndex].push(z);
            });
            Object.keys(byPage).forEach(pIdxStr => {
                const pIdx = Number(pIdxStr);
                const pageZones = byPage[pIdx];
                if (pageZones.length > 1) {
                    const startY = Math.min(...pageZones.map(z => z.startY));
                    const endY = Math.max(...pageZones.map(z => z.endY));
                    mergedZones.push({ ...pageZones[0], startY, endY });
                } else {
                    mergedZones.push(pageZones[0]);
                }
            });
            semanticZones[key] = mergedZones;
        });

        // 4. TIGHTEN OVERLAPS (Mutual Push-Pull)
        const allLabels = Object.keys(semanticZones);
        const zonesByPage: Record<number, any[]> = {};
        allLabels.forEach(lbl => {
            semanticZones[lbl].forEach(z => {
                if (!zonesByPage[z.pageIndex]) zonesByPage[z.pageIndex] = [];
                zonesByPage[z.pageIndex].push(z);
            });
        });

        Object.keys(zonesByPage).forEach(pIdxStr => {
            const pIdx = Number(pIdxStr);
            const pageList = zonesByPage[pIdx];
            pageList.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
            for (let i = 0; i < pageList.length - 1; i++) {
                const current = pageList[i];
                const next = pageList[i + 1];
                if (next.startY < current.endY) {
                    console.log(` ⚖️ [ZONE-TIGHTEN] Pulling Q${current.label} endY from ${current.endY} up to Q${next.label} startY (${next.startY})`);
                    current.endY = next.startY;
                }
            }
        });

        return semanticZones;
    }

    /**
     * Backfills zones for injected steps (e.g. DRAWING) if they were missed.
     */
    static backfillInjectedZones(
        semanticZones: Record<string, any[]>,
        stepsDataForMapping: any[],
        pageHeightForZones: number
    ): void {
        stepsDataForMapping.forEach(step => {
            if ((step as any).ocrSource === 'system-injection') {
                const qLabel = (step as any).subQuestionLabel;
                const pIdx = step.pageIndex;
                if (!semanticZones[qLabel] || semanticZones[qLabel].length === 0) {
                    let ceilingY = pageHeightForZones;
                    Object.values(semanticZones).flat().forEach(z => {
                        if (z.pageIndex === pIdx && z.startY < ceilingY && z.startY > 10 && z.label !== qLabel) {
                            ceilingY = z.startY;
                        }
                    });
                    if (!semanticZones[qLabel]) semanticZones[qLabel] = [];
                    semanticZones[qLabel].push({ label: qLabel, pageIndex: pIdx, startY: 0, endY: ceilingY, x: 0, width: 100 } as any);
                }
            }
        });
    }
}
