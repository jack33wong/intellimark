import { MarkingInputs } from '../../../types/marking.js';

/**
 * MarkingPromptAdapter
 * 
 * A common adapter service that handles the transformation between 
 * Physical IDs/Indices and task-relative Prompt IDs/Indices.
 * 
 * Design Principles:
 * 1. Physical-First Backend: All internal logic uses Absolute Physical IDs (p15_...).
 * 2. Clean Relative Prompt: AI sees only relative IDs (p0_, p1_...) within a single task.
 * 3. Bidirectional Mapping: Handled via the task's sourceImageIndices mapping.
 */
export class MarkingPromptAdapter {
    /**
     * Prepares inputs for the AI prompt by converting everything to a task-relative state.
     * 
     * @param inputs - Raw marking inputs from the orchestrator
     * @returns Mapped relative IDs and filtered constraints
     */
    static prepareRelativePrompt(inputs: MarkingInputs) {
        const { sourceImageIndices, subQuestionPageMap, questionNumber, processedImage } = inputs;
        const baseQNum = String(questionNumber);

        // Map Physical Page Index -> Task-Relative Index (0, 1, 2...)
        const physicalToRelative: Record<number, number> = {};
        sourceImageIndices?.forEach((abs, rel) => {
            physicalToRelative[abs] = rel;
        });

        // 1. Filter and Map Sub-Question Constraints
        // We only include sub-questions relevant to the current task (e.g. Q12a, Q12b)
        const filteredSubQuestionPageMap: Record<string, number | number[]> = {};
        if (subQuestionPageMap && sourceImageIndices) {
            Object.entries(subQuestionPageMap).forEach(([label, absPages]) => {
                const isRelevant = label.startsWith(baseQNum) || label === baseQNum;
                if (isRelevant) {
                    const absArray = Array.isArray(absPages) ? absPages : [absPages];
                    const relPages = absArray.map(abs => physicalToRelative[abs] ?? 0).sort((a, b) => a - b);
                    filteredSubQuestionPageMap[label] = relPages.length === 1 ? relPages[0] : relPages;
                }
            });
        }

        // 2. Map OCR Block IDs to Relative
        // (p15_ocr_1 -> p0_ocr_1)
        const promptBlocks = ((processedImage as any)?.rawOcrBlocks || []).map((b: any) => ({
            ...b,
            id: b.id.replace(/^p\d+_/, `p${physicalToRelative[b.pageIndex] ?? 0}_`)
        }));

        // 3. Map Student Work IDs to Relative
        // (p15_q15_line_1 -> p0_q15_line_1)
        const promptStudentWork = (processedImage as any)?.classificationStudentWork ?
            (processedImage as any).classificationStudentWork.replace(/p(\d+)_/g, (match: string, pIdxStr: string) => {
                const pIdx = parseInt(pIdxStr, 10);
                const relIdx = physicalToRelative[pIdx] ?? 0;
                return `p${relIdx}_`;
            }) : (processedImage as any)?.classificationStudentWork;

        return {
            filteredSubQuestionPageMap,
            promptBlocks,
            promptStudentWork
        };
    }

    /**
     * Maps task-relative response IDs and pageIndices back to physical absolute values.
     * 
     * @param annotations - Raw annotations from AI response
     * @param sourceImageIndices - Mapping array from relative to physical indices
     */
    static restorePhysicalTruth(annotations: any[], sourceImageIndices: number[]) {
        if (!annotations || !sourceImageIndices) return;

        annotations.forEach((anno: any) => {
            // Priority 1: Extract relative index from the ID itself (e.g. p0_...)
            const probeIds = [anno.line_id, (anno as any).id, (anno as any).linked_ocr_id, (anno as any).linkedOcrId, (anno as any).step_id];
            let relIdx = -1;

            for (const id of probeIds) {
                if (typeof id === 'string' && id.match(/^p(\d+)_/)) {
                    const match = id.match(/^p(\d+)_/);
                    if (match) {
                        relIdx = parseInt(match[1], 10);
                        break;
                    }
                }
            }

            // Fallback: Use the pageIndex field itself if present
            if (relIdx === -1 && anno.pageIndex !== undefined) {
                relIdx = anno.pageIndex;
            }

            // If we found a relative index, map it back to physical truth
            if (relIdx !== -1) {
                const physicalIdx = sourceImageIndices[relIdx] ?? sourceImageIndices[0];

                // Rewrite ALL ID-like fields to reflect physical truth
                const idFields = ['line_id', 'id', 'step_id', 'linked_ocr_id', 'linkedOcrId', 'lineId'];
                idFields.forEach(field => {
                    if (anno[field] && typeof anno[field] === 'string') {
                        anno[field] = anno[field].replace(/^p\d+_/, `p${physicalIdx}_`);
                    }
                });

                // Update the pageIndex to the absolute physical index
                anno.pageIndex = physicalIdx;
                // Explicitly flag as physical to prevent redundant mapping downstream
                anno.isPhysicalPage = true;
            }
        });
    }
}
