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
    unifiedLookupTable?: Record<string, { bbox: number[]; cleanedText: string }>;
    // Legacy parameters for backward compatibility
    stepMapping?: Array<{ unified_step_id: string; original_text: string; cleaned_text: string; bbox: number[] }>;
    stepAssignment?: Array<{ unified_step_id: string; text: string; bbox: number[] }>;
  }): Promise<{ annotations: Annotation[] }> {
    const { ocrText, boundingBoxes, rawAnnotations, imageDimensions, unifiedLookupTable, stepMapping, stepAssignment } = params;
    const parsed = await this.parseAnnotations(rawAnnotations.annotations);
    const placed = this.placeAnnotations(ocrText, boundingBoxes, parsed, imageDimensions, unifiedLookupTable, stepMapping, stepAssignment);
    return { annotations: placed };
  }

  static async parseAnnotations(raw: string): Promise<Array<any>> {
    const { JsonUtils } = await import('./JsonUtils');
    try {
      const parsed = JsonUtils.cleanAndValidateJSON(raw, 'annotations');
      return parsed.annotations || [];
    } catch (error) {
      console.error('[AnnotationMapper] Failed to parse annotations:', error);
      console.log('[AnnotationMapper] Raw annotation data:', raw.substring(0, 500) + '...');
      return [];
    }
  }

  static placeAnnotations(
    _ocrText: string,
    _boundingBoxes: Array<{ x: number; y: number; width: number; height: number; text?: string }>,
    annotations: Array<any>,
    imageDimensions?: { width: number; height: number },
    unifiedLookupTable?: Record<string, { bbox: number[]; cleanedText: string }>,
    stepMapping?: Array<{ unified_step_id: string; original_text: string; cleaned_text: string; bbox: number[] }>,
    stepAssignment?: Array<{ unified_step_id: string; text: string; bbox: number[] }>
  ): Annotation[] {
    const results: Annotation[] = [];
    const widthLimit = imageDimensions?.width ?? Number.MAX_SAFE_INTEGER;
    const heightLimit = imageDimensions?.height ?? Number.MAX_SAFE_INTEGER;

    // Use pre-built unified lookup table if provided, otherwise build it (legacy support)
    let unifiedStepLookup: Record<string, { bbox: number[]; cleanedText: string }> = {};
    
    if (unifiedLookupTable) {
      // Use the pre-built lookup table from OCR cleanup
      unifiedStepLookup = unifiedLookupTable;
      //console.log('✅ Using pre-built unified lookup table from OCR cleanup');
    } else {
      // Build unified step lookup table from separate inputs
      
      // Start with original step assignments (from OCR processing)
      if (stepAssignment && stepAssignment.length > 0) {
        for (const s of stepAssignment) {
          if (s.unified_step_id && s.bbox && Array.isArray(s.bbox) && s.bbox.length === 4) {
            unifiedStepLookup[s.unified_step_id] = {
              bbox: s.bbox,
              cleanedText: s.text || ''
            };
          }
        }
      }

      // Update lookup table with cleaned text from step mapping
      if (stepMapping && stepMapping.length > 0) {
        for (const s of stepMapping) {
          if (s.unified_step_id && s.bbox && Array.isArray(s.bbox) && s.bbox.length === 4) {
            // Update existing entry or create new one
            unifiedStepLookup[s.unified_step_id] = {
              bbox: s.bbox,
              cleanedText: s.cleaned_text || ''
            };
          }
        }
      }
    }

    // Initial unified step lookup table log removed for cleaner output

    // Helper to compute union bbox from multiple bbox arrays
    const unionFromBboxes = (bboxes: number[][]) => {
      if (bboxes.length === 0) return undefined;
      const validBboxes = bboxes.filter(b => b && b.length >= 4 && b.every(n => typeof n === 'number' && !isNaN(n)));
      if (validBboxes.length === 0) return undefined;
      const minX = Math.min(...validBboxes.map(b => b[0]!));
      const minY = Math.min(...validBboxes.map(b => b[1]!));
      const maxX = Math.max(...validBboxes.map(b => b[0]! + b[2]!));
      const maxY = Math.max(...validBboxes.map(b => b[1]! + b[3]!));
      return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    };

    // We no longer support text-based fallback matching. All mapping must use step_id.

    // Compute unified step metadata for a given step reference (can be merged like "step_2+3")
    const computeUnifiedStep = (stepRef?: string): { unifiedId?: string; unifiedText?: string; unifiedBox?: { x: number; y: number; width: number; height: number } } => {
      if (!stepRef) return {};
      
      // First check if this step reference already exists in the lookup (e.g., "step_2.5" from OCR cleanup)
      if (unifiedStepLookup[stepRef]) {
        const stepData = unifiedStepLookup[stepRef];
        if (stepData.bbox && stepData.bbox.length >= 4) {
          const [x, y, w, h] = stepData.bbox;
          if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') {
            return {
              unifiedId: stepRef,
              unifiedText: stepData.cleanedText,
              unifiedBox: { x, y, width: w, height: h }
            };
          }
        }
      }

      // If not found, try to parse as merged steps (e.g., "step_2+step_3")
      const parts = stepRef.split('+').map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) return {};

      // Collect bboxes and texts from unified step lookup
      const bboxes: number[][] = [];
      const cleanedTexts: string[] = [];
      const nums: number[] = [];
      
      for (const p of parts) {
        const stepData = unifiedStepLookup[p];
        if (stepData && stepData.bbox && stepData.bbox.length >= 4) {
          bboxes.push(stepData.bbox);
          cleanedTexts.push(stepData.cleanedText || '');
        }
        const m = p.match(/step_(\d+(?:\.\d+)?)/);
        if (m && m[1]) nums.push(parseFloat(m[1]));
      }

      let unifiedBox: { x: number; y: number; width: number; height: number } | undefined = undefined;
      if (bboxes.length === 1) {
        const bbox = bboxes[0];
        if (bbox && bbox.length >= 4) {
          const [x, y, w, h] = bbox;
          if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') {
            unifiedBox = { x, y, width: w, height: h };
          }
        }
      } else if (bboxes.length > 1) {
        unifiedBox = unionFromBboxes(bboxes);
      }

      const unifiedCleanedText = cleanedTexts.length > 0 ? cleanedTexts.join(' ') : undefined;
      
      let unifiedId: string | undefined = undefined;
      if (nums.length > 1) {
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        unifiedId = `step_${avg}`;
      } else if (parts.length === 1) {
        unifiedId = parts[0];
      }

      // Add the computed unified step to the lookup table for future reference
      if (unifiedId && unifiedBox && !unifiedStepLookup[unifiedId]) {
        unifiedStepLookup[unifiedId] = {
          bbox: [unifiedBox.x, unifiedBox.y, unifiedBox.width, unifiedBox.height],
          cleanedText: unifiedCleanedText || ''
        };
        console.log(`[AnnotationMapper] Added computed unified step to lookup: ${unifiedId} -> bbox=[${unifiedBox.x},${unifiedBox.y},${unifiedBox.width},${unifiedBox.height}] text="${unifiedCleanedText}"`);
      }

      return { 
        unifiedId, 
        unifiedText: unifiedCleanedText, 
        unifiedBox 
      } as any;
    };

    const lineUsage: Record<string, number> = {}; const sigSet = new Set<string>();
    let unmatched = 0;
    for (const a of annotations) {
      const action = (a.action || 'comment') as Annotation['action'];
      const textMatch = a.textMatch as string | undefined; const commentText = a.text as string | undefined;
      const reasoning = a.reasoning as string | undefined; const stepId = a.step_id as string | undefined;
      const idSig = `${action}|${textMatch}|${commentText}|${stepId}`;
      if (sigSet.has(idSig)) continue; sigSet.add(idSig);

      // Require step_id for mapping. If missing, log and skip.
      if (!stepId) {
        console.error('[AnnotationMapper] annotation missing step_id; skipping placement');
        unmatched++;
        continue;
      }

      // Determine unified step metadata first
      const { unifiedId, unifiedText, unifiedBox } = computeUnifiedStep(stepId);

      // Rely solely on unified bbox derived from step_id (including merged steps)
      const line = unifiedBox;
      if (!line) { unmatched++; continue; }

      const usage = `${line.x},${line.y},${line.width},${line.height}`; lineUsage[usage] = (lineUsage[usage] || 0) + 1;
      const x = Math.min(Math.max(0, line.x), widthLimit);
      const y = Math.min(Math.max(0, line.y), heightLimit);
      const w = Math.min(Math.max(0, line.width), Math.max(0, widthLimit - x));
      const h = Math.min(Math.max(0, line.height), Math.max(0, heightLimit - y));

      // Log unified step mapping
      console.log(`[AnnotationMapper] matched step_id=${stepId || 'n/a'} unified_step_id=${unifiedId || 'n/a'} textMatch=${JSON.stringify(textMatch)} -> bbox=[${x},${y},${w},${h}]`);

      results.push({
        bbox: [x + (usage.endsWith('#2') ? 6 : 0), y, Math.max(1, w), Math.max(1, h)],
        action,
        text: commentText,
        reasoning,
        // Non-typed extra fields for downstream visibility/logging
        step_id: stepId,
        unified_step_id: unifiedId,
        unified_source_text: unifiedText,
        textMatch
      } as any);
    }

    if (unmatched > 0) {
      console.log(`[AnnotationMapper] ${unmatched} annotation(s) could not be matched to any bbox`);
    }

    // Print the final unified step lookup table (after any dynamic additions)
    console.log('📋 Final Unified Step Lookup Table:');
    console.log('=' .repeat(80));
    for (const [stepId, data] of Object.entries(unifiedStepLookup)) {
      console.log(`${stepId}: bbox=[${data.bbox.join(',')}] text="${data.cleanedText}"`);
    }
    console.log('=' .repeat(80));

    return results;
  }
}


