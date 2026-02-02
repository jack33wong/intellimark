
import { MarkingZoneService } from '../MarkingZoneService.js';
import { MarkingTask } from '../../../types/index.js';
import { MarkingTaskFactory } from './MarkingTaskFactory.js';

export class ZoneArchitect {
    /**
     * Orchestrates the detection and refinement of semantic zones.
     * Migrated faithfully from the original MarkingExecutor.
     */
    static detectAndRefineZones(
        task: MarkingTask,
        pageDimensionsMap: Map<number, { width: number; height: number }>
    ): Record<string, any[]> {
        // 1. Derive expected questions
        const classificationExpected = MarkingTaskFactory.deriveExpectedQuestionsFromClassification(task);
        const taskFirstPage = (task.sourcePages && task.sourcePages.length > 0) ? task.sourcePages[0] : 0;
        const expectedQuestions = classificationExpected.map(c => ({ ...c, targetPage: taskFirstPage }));

        const rawOcrBlocksForZones = (task.mathBlocks || []).map((block) => {
            // [FIX]: Preserve the original object reference so that _isInstruction tag persists.
            // Also ensure .text is present as MarkingZoneService relies on it for fuzzy matching.
            if (!(block as any).text) {
                (block as any).text = block.mathpixLatex || (block as any).googleVisionText || '';
            }
            return block;
        });

        let nextQuestionText = task.nextQuestionText;
        let semanticZones: Record<string, any[]>;

        // 2. Perform raw detection (Priority: Global injected zones -> local detection)
        if (task.semanticZones && Object.keys(task.semanticZones).length > 0) {
            console.log(` 🌐 [ZONE-ARCHITECT] Using Global Pre-calculated Zones (Count: ${Object.keys(task.semanticZones).length})`);
            // Clone to avoid mutating the source
            semanticZones = JSON.parse(JSON.stringify(task.semanticZones));
        } else {
            semanticZones = MarkingZoneService.detectSemanticZones(
                rawOcrBlocksForZones,
                pageDimensionsMap,
                expectedQuestions,
                nextQuestionText
            );
        }

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

}
