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
  }): Promise<{ annotations: Annotation[] }> {
    const { ocrText, boundingBoxes, rawAnnotations, imageDimensions } = params;
    const parsed = await this.parseAnnotations(rawAnnotations.annotations);
    const placed = this.placeAnnotations(ocrText, boundingBoxes, parsed, imageDimensions);
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
    imageDimensions?: { width: number; height: number }
  ): Annotation[] {
    const results: Annotation[] = [];
    const widthLimit = imageDimensions?.width ?? Number.MAX_SAFE_INTEGER;
    const heightLimit = imageDimensions?.height ?? Number.MAX_SAFE_INTEGER;

    const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const lcsLength = (a: string, b: string) => {
      const m = a.length, n = b.length; const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
      for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      return dp[m][n];
    };
    const windowTightness = (needle: string, hay: string) => {
      let first = -1, last = -1, pos = -1, matched = 0;
      for (const ch of needle) { const idx = hay.indexOf(ch, pos + 1); if (idx === -1) { return 0; } if (first === -1) first = idx; last = idx; pos = idx; matched++; }
      const windowLen = (last - first + 1) || needle.length; return Math.min(1, needle.length / windowLen);
    };
    const scoreMatch = (needleRaw: string, hayRaw: string) => {
      const needle = normalize(needleRaw); const hay = normalize(hayRaw);
      if (!needle || !hay) return 0; if (hay.includes(needle)) return 1.0;
      const lcs = lcsLength(needle, hay) / needle.length; const tight = windowTightness(needle, hay);
      return Math.min(lcs, tight);
    };
    const findBestBox = (needle: string | undefined) => {
      if (!needle) return undefined as any; let best = undefined as any; let bestScore = -1;
      for (const b of boundingBoxes) { const s = scoreMatch(needle, (b.text || '') as string); if (s > bestScore) { bestScore = s; best = b as any; } else if (s === bestScore && best && b && (b.y as any) < (best as any).y) { best = b as any; } }
      if (bestScore >= 0.9) return best; return undefined as any;
    };

    const lineUsage: Record<string, number> = {}; const sigSet = new Set<string>();
    for (const a of annotations) {
      const action = (a.action || 'comment') as Annotation['action'];
      const textMatch = a.textMatch as string | undefined; const commentText = a.text as string | undefined;
      const line: any = findBestBox(textMatch || (commentText || '').toString()); if (!line) continue;
      const lineX = Math.max(0, (line.x as number) || 0), lineY = Math.max(0, (line.y as number) || 0);
      const lineW = Math.max(1, (line.width as number) || 0), lineH = Math.max(8, (line.height as number) || 0);
      const baseSize = Math.max(18, Math.floor(lineH * 0.9)); let annW = baseSize, annH = baseSize;
      if (action === 'underline') { annW = Math.max(24, Math.floor(lineW * 0.8)); annH = Math.max(6, Math.floor(lineH * 0.18)); }
      else if (action === 'comment') { const len = (commentText || '').length; annW = Math.max(80, len * 8); annH = Math.max(18, Math.floor(lineH * 0.8)); }
      const lineKey = `${Math.round(lineY / 10)}`; const idx = lineUsage[lineKey] || 0; lineUsage[lineKey] = idx + 1; const gap = 10;
      let x = lineX + lineW + 12 + idx * (annW + gap); let y = lineY + Math.max(0, Math.floor((lineH - annH) / 2));
      if (imageDimensions) { if (x + annW > widthLimit) x = Math.max(0, widthLimit - annW - 1); if (y + annH > heightLimit) y = Math.max(0, heightLimit - annH - 1); }
      const bbox: [number, number, number, number] = [x, y, annW, annH]; const sig = `${Math.round(x)}-${Math.round(y)}-${Math.round(annW)}-${Math.round(annH)}-${action}-${commentText || ''}`;
      if (sigSet.has(sig)) continue; sigSet.add(sig);
      results.push({ action, bbox, ...(action === 'comment' && commentText ? { text: commentText } : {}), ...(a.reasoning && typeof a.reasoning === 'string' ? { reasoning: a.reasoning } : {}) });
    }
    return results;
  }
}


