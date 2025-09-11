import type { Annotation } from '../../types/index';

/**
 * AnnotationMapper
 * Thin wrapper that will host bbox alignment logic.
 * Initially, delegates to AIMarkingService.calculateAnnotationCoordinatesProgrammatically
 * to avoid any behavior change.
 */
export class AnnotationMapper {
  static async mapAnnotations(params: {
    ocrText: string;
    boundingBoxes: Array<{ x: number; y: number; width: number; height: number; text: string; confidence?: number }>;
    rawAnnotations: { annotations: string };
    imageDimensions: { width: number; height: number };
    stepMapping?: Array<{ step_id: string; text: string }>;
    stepAssignment?: Array<{ step_id: string; text: string; bbox_index?: number }>;
  }): Promise<{ annotations: Annotation[] }> {
    const { ocrText, boundingBoxes, rawAnnotations, imageDimensions, stepMapping, stepAssignment } = params;
    const parsed = await this.parseAnnotations(rawAnnotations.annotations);
    const placed = this.placeAnnotations(ocrText, boundingBoxes, parsed, imageDimensions, stepMapping, stepAssignment);
    return { annotations: placed };
  }

  static async parseAnnotations(raw: string): Promise<Array<any>> {
    const { JsonUtils } = await import('./JsonUtils');
    try {
      const parsed = JsonUtils.cleanAndValidateJSON(raw, 'annotations');
      return parsed.annotations || [];
    } catch {
      return [];
    }
  }

  static placeAnnotations(
    ocrText: string,
    boundingBoxes: Array<{ x: number; y: number; width: number; height: number; text?: string }>,
    annotations: Array<any>,
    imageDimensions?: { width: number; height: number },
    stepMapping?: Array<{ step_id: string; text: string }>,
    stepAssignment?: Array<{ step_id: string; text: string; bbox_index?: number }>
  ): Annotation[] {
    const results: Annotation[] = [];
    const widthLimit = imageDimensions?.width ?? Number.MAX_SAFE_INTEGER;
    const heightLimit = imageDimensions?.height ?? Number.MAX_SAFE_INTEGER;

    // Build quick lookup from step_id -> bbox_index
    const stepIdToBboxIndex: Record<string, number> = {};
    if (stepAssignment && stepAssignment.length > 0) {
      for (const s of stepAssignment) {
        if (s.step_id && typeof s.bbox_index === 'number') {
          stepIdToBboxIndex[s.step_id] = s.bbox_index as number;
        }
      }
    }

    // Helper to compute union bbox from a list of indices
    const unionFromIndices = (indices: number[]) => {
      const boxes = indices
        .map(i => boundingBoxes[i])
        .filter(b => b && typeof b.x === 'number' && typeof b.y === 'number');
      if (boxes.length === 0) return undefined as any;
      const minX = Math.min(...boxes.map(b => b.x));
      const minY = Math.min(...boxes.map(b => b.y));
      const maxX = Math.max(...boxes.map(b => b.x + b.width));
      const maxY = Math.max(...boxes.map(b => b.y + b.height));
      return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) } as any;
    };

    // Fallback: if we still don't have mapping but we do have cleaned steps and bboxes,
    // derive mapping by positional order (step_1 -> bbox[0], step_2 -> bbox[1], ...)
    if ((!stepAssignment || stepAssignment.length === 0) && stepMapping && stepMapping.length > 0 && boundingBoxes.length > 0) {
      const limit = Math.min(stepMapping.length, boundingBoxes.length);
      for (let i = 0; i < limit; i++) {
        const sid = stepMapping[i]?.step_id;
        if (sid && stepIdToBboxIndex[sid] === undefined) {
          stepIdToBboxIndex[sid] = i;
        }
      }
    }

    const findBestBox = (needle: string | undefined, stepId?: string) => {
      // 0) If step_id present on the annotation, use it directly (support merged like "step_2+3")
      if (stepId) {
        const parts = stepId.split('+').map(s => s.trim()).filter(Boolean);
        const indices = parts
          .map(p => stepIdToBboxIndex[p])
          .filter(i => typeof i === 'number') as number[];
        if (indices.length > 0) {
          // Single index -> direct box; multi -> union
          if (indices.length === 1) {
            const bbox = boundingBoxes[indices[0]];
            if (bbox) return bbox as any;
          } else {
            const union = unionFromIndices(indices);
            if (union) return union as any;
          }
        }
      }

      if (!needle) return undefined as any;

      // 1) Prefer linking via step_id by matching cleaned steps text
      if (stepMapping && stepMapping.length > 0) {
        const matchedStep = stepMapping.find(step =>
          step.text.includes(needle) || needle.includes(step.text)
        );
        if (matchedStep && matchedStep.step_id) {
          const parts = matchedStep.step_id.split('+').map(s => s.trim()).filter(Boolean);
          const indices = parts
            .map(p => stepIdToBboxIndex[p])
            .filter(i => typeof i === 'number') as number[];
          if (indices.length === 1) {
            const bbox = boundingBoxes[indices[0]];
            if (bbox) return bbox as any;
          } else if (indices.length > 1) {
            const union = unionFromIndices(indices);
            if (union) return union as any;
          }
        }
      }

      // 2) Fallback: try direct text include against OCR bounding boxes
      for (const b of boundingBoxes) {
        const t = (b.text || '') as string;
        if (t && (t.includes(needle) || needle.includes(t))) return b as any;
      }

      // 3) No match
      return undefined as any;
    };

    const lineUsage: Record<string, number> = {}; const sigSet = new Set<string>();
    let unmatched = 0;
    for (const a of annotations) {
      const action = (a.action || 'comment') as Annotation['action'];
      const textMatch = a.textMatch as string | undefined; const commentText = a.text as string | undefined;
      const reasoning = a.reasoning as string | undefined; const stepId = a.step_id as string | undefined;
      const idSig = `${action}|${textMatch}|${commentText}|${stepId}`;
      if (sigSet.has(idSig)) continue; sigSet.add(idSig);

      const line = findBestBox(textMatch, stepId);
      if (!line) { unmatched++; continue; }

      const usage = `${line.x},${line.y},${line.width},${line.height}`; lineUsage[usage] = (lineUsage[usage] || 0) + 1;
      const x = Math.min(Math.max(0, line.x), widthLimit);
      const y = Math.min(Math.max(0, line.y), heightLimit);
      const w = Math.min(Math.max(0, line.width), Math.max(0, widthLimit - x));
      const h = Math.min(Math.max(0, line.height), Math.max(0, heightLimit - y));

      // Determine bbox index for logging
      let bboxIndex = -1;
      if (stepId && stepIdToBboxIndex[stepId] !== undefined) {
        bboxIndex = stepIdToBboxIndex[stepId];
      } else {
        bboxIndex = boundingBoxes.findIndex(b => b.x === line.x && b.y === line.y && b.width === line.width && b.height === line.height);
      }
      console.log(`[AnnotationMapper] matched step_id=${stepId || 'n/a'} textMatch=${JSON.stringify(textMatch)} -> bbox_index=${bboxIndex} [${x},${y},${w},${h}]`);

      results.push({
        bbox: [x + (usage.endsWith('#2') ? 6 : 0), y, Math.max(1, w), Math.max(1, h)],
        action,
        text: commentText,
        reasoning,
        // Non-typed extra fields for downstream visibility/logging
        step_id: stepId,
        textMatch
      } as any);
    }

    if (unmatched > 0) {
      console.log(`[AnnotationMapper] ${unmatched} annotation(s) could not be matched to any bbox`);
    }

    return results;
  }
}


