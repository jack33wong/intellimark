/**
 * Handwriting Quality Service
 * Computes deterministic handwriting clarity metrics directly from Marking LLM's
 * explicit `line_id` <-> `linked_ocr_id` pairs (zero coordinate matching, zero extra API calls).
 */

export type HandwritingRating = 'clear' | 'fair' | 'needs_care';

export interface HandwritingOcrLink {
  lineId: string;
  classificationText: string;
  linkedOcrId?: string | null;
  ocrText?: string | null;
  ocrMatchStatus: 'MATCHED' | 'UNMATCHED' | 'VISUAL';
  confidenceRate?: number;
  isPrinted?: boolean;
  isWrongStep?: boolean;
  subQuestion?: string;
  pageIndex?: number;
}

export interface HandwritingIssue {
  q: string;
  subQ?: string;
  pageIndex?: number;
  ocrText: string;
  intendedText?: string;
  note: string;
  confidenceRate?: number;
}

export interface HandwritingSummaryPayload {
  rating: HandwritingRating;
  label: 'Clear' | 'Fair' | 'Needs Care';
  confidenceRate: number; // 0-1 rounded to 3 decimals
  tip: string;
  issues: HandwritingIssue[];
  isTyped?: boolean;
}

export interface PerQuestionHandwritingStats {
  q: string;
  avgConfidenceRate: number;
  minConfidenceRate: number;
  matchedCount: number;
  unmatchedCount: number;
  isWrongAnswer: boolean;
  mismatches: Array<{
    ocrText: string;
    intendedText: string;
    confidenceRate: number;
    isWrongStep: boolean;
    subQ?: string;
    pageIndex?: number;
  }>;
  lowestLine?: {
    ocrText: string;
    intendedText?: string;
    confidenceRate: number;
    subQ?: string;
    pageIndex?: number;
  };
  unmatchedSample?: string;
  unmatchedSubQ?: string;
  unmatchedPageIndex?: number;
}

export interface HandwritingAnalysisResult {
  summary: HandwritingSummaryPayload;
  perQuestion: PerQuestionHandwritingStats[];
}

// Tunable thresholds (Mathpix confidence_rate skews high; mismatches & unmatched lines catch garbled handwriting)
export const HANDWRITING_THRESHOLDS = {
  CLEAR_AVG: 0.92,
  CLEAR_MIN_Q: 0.82,
  FAIR_AVG: 0.82,
  FAIR_MIN_Q: 0.70,
  LOW_LINE_CONF: 0.85,
  TYPED_CONF: 0.985,
  TYPED_PRINTED_RATIO: 0.9
} as const;

const cleanQNum = (raw: any): string =>
  String(raw ?? '').replace(/^Q/i, '').trim();

const normalizeText = (s: string): string =>
  String(s || '')
    .toLowerCase()
    .replace(/\\(?:text|mathrm|mathbf|mathbb|operatorname|left|right|quad|qquad|therefore|Rightarrow|rightarrow|,|;|!)\b/g, ' ')
    .replace(/[\${}\[\]()\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const truncateSnippet = (s: string, maxLen = 90): string => {
  const cleaned = String(s || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1).trimEnd() + '…';
};

/**
 * Dice bigram similarity (0-1) for comparing Mathpix literal OCR vs Classification text
 */
function textSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeText(aRaw);
  const b = normalizeText(bRaw);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      intersection++;
      bigramsA.set(bg, count - 1);
    }
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

function isSkippableWorkText(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return true;
  // Skip non-handwritten visual/MCQ selections (e.g. "[circled] C. 3.0 x 10^6 cm/s", "[DRAWING]", "[scribbled over]")
  if (/^\[(DRAWING|shaded\b|BLANK|DIAGRAM|crossed\s*out|circled\b|ticked\b|underlined\b|selected\b|scribbled\b)/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Normalizes away harmless formatting/spacing differences (e.g. "X - rays" vs "x-rays",
 * "3.0 × 10^5" vs "3.0 x 10^5") to prevent false-positive handwriting mismatches.
 */
function compactSemanticCore(s: string): string {
  return normalizeText(s)
    .replace(/\s*([-+=×x*/])\s*/g, '$1')
    .replace(/\s+/g, '');
}

/**
 * Returns true when a difference between Mathpix OCR and Classification text is NOT a
 * handwriting legibility problem (e.g., printed/typed block, punctuation/spacing difference
 * like "X - rays" vs "x-rays", or an OCR block split where the number matched cleanly and
 * the trailing unit sat in an adjacent block like "340" vs "340 /s").
 */
function isNonHandwritingDifference(ocrRaw: string, clsRaw: string, isPrinted?: boolean): boolean {
  if (isPrinted === true) return true;

  const coreOcr = compactSemanticCore(ocrRaw);
  const coreCls = compactSemanticCore(clsRaw);
  if (!coreOcr || !coreCls || coreOcr === coreCls) return true;

  // Pure hyphen/punctuation/whitespace difference (e.g. "X - rays" vs "x-rays")
  const alphaOcr = coreOcr.replace(/[^a-z0-9]/g, '');
  const alphaCls = coreCls.replace(/[^a-z0-9]/g, '');
  if (alphaOcr.length >= 2 && alphaOcr === alphaCls) return true;

  // Adjacent-block unit split: OCR block cleanly read the numeric value ("340", "20.5")
  // while classification merged the trailing unit ("340 /s", "340 m/s", "20.5 cm")
  if (/^-?\d+(?:\.\d+)?$/.test(coreOcr) && coreCls.startsWith(coreOcr)) {
    const trailing = coreCls.slice(coreOcr.length);
    if (/^[a-z/%°²³^0-9-]+$/i.test(trailing) && trailing.length <= 6 && !/^\d/.test(trailing)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if `shorter` is an ordered subsequence of `longer` (i.e. only pure insertions/deletions).
 */
function isOrderedSubsequence(shorter: string, longer: string): boolean {
  let i = 0;
  for (let j = 0; j < longer.length && i < shorter.length; j++) {
    if (shorter[i] === longer[j]) i++;
  }
  return i === shorter.length;
}

/**
 * Filters out tiny 1-2 char Mathpix OCR artifacts (such as a stray `^2` picked up from a nearby
 * crossed-out squiggle on `= \frac{0.28}{1-0.54}` -> `=\frac{0.28^{2}}{1-0.54}`) when confidence
 * is otherwise high and the step wasn't marked wrong.
 */
function isMinorOcrArtifact(ocrRaw: string, clsRaw: string, confRate: number, isWrongStep: boolean): boolean {
  if (isWrongStep || confRate < HANDWRITING_THRESHOLDS.LOW_LINE_CONF) return false;

  const compactOcr = normalizeText(ocrRaw).replace(/\s+/g, '');
  const compactCls = normalizeText(clsRaw).replace(/\s+/g, '');
  if (compactOcr === compactCls) return true;

  // Strip stray single superscripts (^2, ^1, ^') and compare
  const stripStraySup = (s: string) => s.replace(/\^[0-9a-z']/g, '');
  if (stripStraySup(compactOcr) === stripStraySup(compactCls)) {
    return true;
  }

  // Pure 1-2 char insertion/deletion on a high-confidence line (e.g. stray punctuation or digit)
  const lenDiff = Math.abs(compactOcr.length - compactCls.length);
  if (lenDiff > 0 && lenDiff <= 2) {
    const [shorter, longer] = compactOcr.length < compactCls.length
      ? [compactOcr, compactCls]
      : [compactCls, compactOcr];
    if (shorter.length >= 6 && isOrderedSubsequence(shorter, longer)) {
      return true;
    }
  }

  return false;
}

/**
 * Helper used inside MarkingExecutor to build ID-linked Mathpix <-> Classification pairs
 * directly from the Marking LLM's `line_id` and `linked_ocr_id` annotations (zero spatial matching).
 */
export function buildHandwritingOcrLinks(
  rawAnnotations: any[],
  ocrTextForPrompt: string,
  rawOcrBlocks: any[]
): HandwritingOcrLink[] {
  if (!Array.isArray(rawAnnotations) || rawAnnotations.length === 0) return [];

  // 1. Parse [ID: p0_q1_line_3] <text> lines from ocrTextForPrompt
  const lineTextById = new Map<string, string>();
  const lineTextBySuffix = new Map<string, string>();
  for (const rawLine of String(ocrTextForPrompt || '').split('\n')) {
    const m = rawLine.match(/^\s*\[ID:\s*([^\]]+)\]\s*(.+)$/);
    if (!m) continue;
    const id = m[1].trim();
    const text = m[2].trim();
    lineTextById.set(id, text);
    const suffix = id.replace(/^p\d+_/, '');
    if (!lineTextBySuffix.has(suffix)) {
      lineTextBySuffix.set(suffix, text);
    }
  }

  // 2. Index Mathpix rawOcrBlocks by exact id and p-stripped suffix
  const ocrById = new Map<string, any>();
  const ocrBySuffix = new Map<string, any>();
  for (const b of Array.isArray(rawOcrBlocks) ? rawOcrBlocks : []) {
    if (!b || !b.id) continue;
    const id = String(b.id).trim();
    ocrById.set(id, b);
    const suffix = id.replace(/^p\d+_/, '');
    if (!ocrBySuffix.has(suffix)) {
      ocrBySuffix.set(suffix, b);
    }
  }

  const seenLineKeys = new Set<string>();
  const links: HandwritingOcrLink[] = [];

  for (const anno of rawAnnotations) {
    if (!anno || anno.action === 'not_attempted' || anno.isUnattempted) continue;
    const statusRaw = String(anno.ocr_match_status || '').toUpperCase();
    if (statusRaw === 'VISUAL') continue;

    const lineId = String(anno.line_id || '').trim();
    if (!lineId || /visual_drawing/i.test(lineId)) continue;

    const dedupeKey = `${lineId}::${anno.linked_ocr_id || ''}`;
    if (seenLineKeys.has(dedupeKey)) continue;
    seenLineKeys.add(dedupeKey);

    const lineSuffix = lineId.replace(/^p\d+_/, '');
    const classificationText = lineTextById.get(lineId) || lineTextBySuffix.get(lineSuffix) || '';
    if (isSkippableWorkText(classificationText)) continue;

    const linkedOcrId = anno.linked_ocr_id ? String(anno.linked_ocr_id).trim() : null;
    const ocrBlock = linkedOcrId
      ? (ocrById.get(linkedOcrId) || ocrBySuffix.get(linkedOcrId.replace(/^p\d+_/, '')))
      : undefined;

    const ocrText = ocrBlock
      ? String(ocrBlock.text || ocrBlock.mathpixLatex || ocrBlock.googleVisionText || '').trim()
      : null;

    if (ocrText && /\[PRINTED_INSTRUCTION/i.test(ocrText)) continue;

    const confRate =
      typeof ocrBlock?.mathpixConfidenceRate === 'number'
        ? ocrBlock.mathpixConfidenceRate
        : (typeof ocrBlock?.mathpixConfidence === 'number'
            ? ocrBlock.mathpixConfidence
            : (typeof ocrBlock?.confidence === 'number' ? ocrBlock.confidence : undefined));

    const ocrMatchStatus: 'MATCHED' | 'UNMATCHED' | 'VISUAL' =
      linkedOcrId && ocrBlock ? 'MATCHED' : 'UNMATCHED';

    const resolvedPageIndex =
      typeof anno.pageIndex === 'number' && anno.pageIndex >= 0
        ? anno.pageIndex
        : (typeof ocrBlock?.pageIndex === 'number' && ocrBlock.pageIndex >= 0 ? ocrBlock.pageIndex : undefined);

    links.push({
      lineId,
      classificationText,
      linkedOcrId,
      ocrText,
      ocrMatchStatus,
      ...(typeof confRate === 'number' ? { confidenceRate: confRate } : {}),
      ...(typeof ocrBlock?.isPrinted === 'boolean' ? { isPrinted: ocrBlock.isPrinted } : {}),
      isWrongStep: anno.action === 'cross',
      ...(anno.subQuestion ? { subQuestion: String(anno.subQuestion).replace(/^Q/i, '').trim() } : {}),
      ...(typeof resolvedPageIndex === 'number' ? { pageIndex: resolvedPageIndex } : {})
    });
  }

  return links;
}

export class HandwritingQualityService {
  /**
   * Analyze handwriting clarity across all attempted questions using the Marking LLM's
   * explicit `line_id` <-> `linked_ocr_id` links attached to each question result.
   */
  public static analyze(allQuestionResults: any[]): HandwritingAnalysisResult | null {
    if (!Array.isArray(allQuestionResults) || allQuestionResults.length === 0) {
      return null;
    }

    const perQuestion: PerQuestionHandwritingStats[] = [];
    const allMatchedConfidences: number[] = [];
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalPrinted = 0;
    let totalWrongStepMismatches = 0;

    for (const qr of allQuestionResults) {
      const qNum = cleanQNum(qr?.questionNumber ?? qr?.number ?? qr?.q);
      if (!qNum) continue;

      const links: HandwritingOcrLink[] = Array.isArray(qr?.handwritingOcrLinks)
        ? qr.handwritingOcrLinks
        : [];
      if (links.length === 0) continue;

      const awarded = Number(qr?.score?.awardedMarks ?? qr?.marks ?? 0);
      const total = Number(qr?.score?.totalMarks ?? qr?.totalMarks ?? 0);
      const isWrongAnswer = total > 0 && awarded < total;

      const qConfidences: number[] = [];
      const qMismatches: Array<{
        ocrText: string;
        intendedText: string;
        confidenceRate: number;
        isWrongStep: boolean;
        subQ?: string;
        pageIndex?: number;
      }> = [];
      let qMatched = 0;
      let qUnmatched = 0;
      let lowestLine: { ocrText: string; intendedText?: string; confidenceRate: number; subQ?: string; pageIndex?: number } | undefined;
      let unmatchedSample: string | undefined;
      let unmatchedSubQ: string | undefined;
      let unmatchedPageIndex: number | undefined;

      for (const link of links) {
        if (link.ocrMatchStatus === 'MATCHED' && link.ocrText) {
          qMatched++;
          totalMatched++;
          if (link.isPrinted === true) totalPrinted++;

          const conf = typeof link.confidenceRate === 'number' ? link.confidenceRate : 0.95;
          qConfidences.push(conf);
          allMatchedConfidences.push(conf);

          if (!lowestLine || conf < lowestLine.confidenceRate) {
            lowestLine = {
              ocrText: truncateSnippet(link.ocrText),
              intendedText: truncateSnippet(link.classificationText),
              confidenceRate: Number(conf.toFixed(3)),
              ...(link.subQuestion ? { subQ: link.subQuestion } : {}),
              ...(typeof link.pageIndex === 'number' ? { pageIndex: link.pageIndex } : {})
            };
          }

          // Compare Mathpix literal OCR vs Classification text on the exact LLM-linked pair
          const normOcr = normalizeText(link.ocrText);
          const normCls = normalizeText(link.classificationText);
          const sim = textSimilarity(link.ocrText, link.classificationText);
          const simThreshold = link.isWrongStep || conf < HANDWRITING_THRESHOLDS.LOW_LINE_CONF ? 0.78 : 0.68;

          if (
            normOcr.length >= 3 &&
            normCls.length >= 3 &&
            normOcr !== normCls &&
            sim <= simThreshold &&
            !isNonHandwritingDifference(link.ocrText, link.classificationText, link.isPrinted) &&
            !isMinorOcrArtifact(link.ocrText, link.classificationText, conf, Boolean(link.isWrongStep))
          ) {
            qMismatches.push({
              ocrText: truncateSnippet(link.ocrText),
              intendedText: truncateSnippet(link.classificationText),
              confidenceRate: Number(conf.toFixed(3)),
              isWrongStep: Boolean(link.isWrongStep),
              ...(link.subQuestion ? { subQ: link.subQuestion } : {}),
              ...(typeof link.pageIndex === 'number' ? { pageIndex: link.pageIndex } : {})
            });
            if (link.isWrongStep || isWrongAnswer) {
              totalWrongStepMismatches++;
            }
          }
        } else if (link.ocrMatchStatus === 'UNMATCHED') {
          qUnmatched++;
          totalUnmatched++;
          if (!unmatchedSample && link.classificationText) {
            unmatchedSample = truncateSnippet(link.classificationText);
            unmatchedSubQ = link.subQuestion;
            unmatchedPageIndex = link.pageIndex;
          }
        }
      }

      if (qMatched === 0 && qUnmatched === 0) continue;

      const avg = qConfidences.length > 0
        ? qConfidences.reduce((s, c) => s + c, 0) / qConfidences.length
        : 0.75; // All lines unmatched by Mathpix -> treat as low clarity
      const min = qConfidences.length > 0 ? Math.min(...qConfidences) : 0.70;

      // Prioritize wrong-step mismatches then lowest confidence
      qMismatches.sort((a, b) => {
        if (a.isWrongStep !== b.isWrongStep) return a.isWrongStep ? -1 : 1;
        return a.confidenceRate - b.confidenceRate;
      });

      perQuestion.push({
        q: qNum,
        avgConfidenceRate: Number(avg.toFixed(3)),
        minConfidenceRate: Number(min.toFixed(3)),
        matchedCount: qMatched,
        unmatchedCount: qUnmatched,
        isWrongAnswer,
        mismatches: qMismatches.slice(0, 2),
        lowestLine,
        unmatchedSample,
        ...(unmatchedSubQ ? { unmatchedSubQ } : {}),
        ...(typeof unmatchedPageIndex === 'number' ? { unmatchedPageIndex } : {})
      });
    }

    if (perQuestion.length === 0 || (totalMatched === 0 && totalUnmatched === 0)) {
      return null;
    }

    const totalLines = totalMatched + totalUnmatched;
    const unmatchedRatio = totalLines > 0 ? totalUnmatched / totalLines : 0;
    const overallAvg = allMatchedConfidences.length > 0
      ? allMatchedConfidences.reduce((s, c) => s + c, 0) / allMatchedConfidences.length
      : 0.75;
    const worstQuestionAvg = Math.min(...perQuestion.map(q => q.avgConfidenceRate));
    const printedRatio = totalMatched > 0 ? totalPrinted / totalMatched : 0;
    const totalMismatches = perQuestion.reduce((s, q) => s + q.mismatches.length, 0);
    const mismatchRatio = totalMatched > 0 ? totalMismatches / totalMatched : 0;

    const isTyped =
      totalMatched > 0 &&
      printedRatio >= HANDWRITING_THRESHOLDS.TYPED_PRINTED_RATIO &&
      overallAvg >= HANDWRITING_THRESHOLDS.TYPED_CONF &&
      totalMismatches === 0 &&
      unmatchedRatio < 0.1;

    // Deterministic rating (Option 2: Mathpix confidence_rate + LLM-linked mismatches + unmatched rate)
    let rating: HandwritingRating = 'clear';
    if (
      overallAvg < HANDWRITING_THRESHOLDS.FAIR_AVG ||
      worstQuestionAvg < HANDWRITING_THRESHOLDS.FAIR_MIN_Q ||
      (totalMismatches >= 3 && mismatchRatio >= 0.35) ||
      (totalUnmatched >= 4 && unmatchedRatio >= 0.5)
    ) {
      rating = 'needs_care';
    } else if (
      overallAvg < HANDWRITING_THRESHOLDS.CLEAR_AVG ||
      worstQuestionAvg < HANDWRITING_THRESHOLDS.CLEAR_MIN_Q ||
      totalWrongStepMismatches >= 1 ||
      totalMismatches >= 2 ||
      (totalUnmatched >= 3 && unmatchedRatio >= 0.3)
    ) {
      rating = 'fair';
    }

    const label: 'Clear' | 'Fair' | 'Needs Care' =
      rating === 'clear' ? 'Clear' : rating === 'fair' ? 'Fair' : 'Needs Care';

    // Build deterministic fallback issues (max 3), prioritizing wrong-answer mismatches -> other mismatches -> unmatched/low-conf
    const candidateIssues: Array<HandwritingIssue & { _priority: number }> = [];
    for (const pq of perQuestion) {
      if (pq.mismatches.length > 0) {
        const top = pq.mismatches[0];
        candidateIssues.push({
          q: pq.q,
          ...(top.subQ ? { subQ: top.subQ } : {}),
          ...(typeof top.pageIndex === 'number' ? { pageIndex: top.pageIndex } : {}),
          ocrText: top.ocrText,
          intendedText: top.intendedText,
          confidenceRate: top.confidenceRate,
          note: top.isWrongStep || pq.isWrongAnswer
            ? 'Unclear letters/symbols here — write key terms & digits distinctly so examiners read them accurately.'
            : 'Slightly ambiguous strokes — form letters and digits clearly so examiners never misread them.',
          _priority: (top.isWrongStep ? 120 : pq.isWrongAnswer ? 100 : 70) + (1 - top.confidenceRate) * 40
        });
      } else if (
        pq.unmatchedCount >= 2 &&
        pq.unmatchedCount / Math.max(1, pq.matchedCount + pq.unmatchedCount) >= 0.4
      ) {
        candidateIssues.push({
          q: pq.q,
          ...(pq.unmatchedSubQ ? { subQ: pq.unmatchedSubQ } : {}),
          ...(typeof pq.unmatchedPageIndex === 'number' ? { pageIndex: pq.unmatchedPageIndex } : {}),
          ocrText: pq.unmatchedSample || 'Hard-to-read handwritten working',
          note: 'Several steps were hard for OCR to pick up — write darker and leave clearer spacing between lines.',
          _priority: (pq.isWrongAnswer ? 65 : 40) + pq.unmatchedCount * 5
        });
      } else if (
        pq.avgConfidenceRate < HANDWRITING_THRESHOLDS.CLEAR_MIN_Q ||
        pq.minConfidenceRate < HANDWRITING_THRESHOLDS.FAIR_MIN_Q
      ) {
        candidateIssues.push({
          q: pq.q,
          ...(pq.lowestLine?.subQ ? { subQ: pq.lowestLine.subQ } : {}),
          ...(typeof pq.lowestLine?.pageIndex === 'number' ? { pageIndex: pq.lowestLine.pageIndex } : {}),
          ocrText: pq.lowestLine?.ocrText || 'Low-clarity handwritten working',
          ...(pq.lowestLine?.intendedText && pq.lowestLine.intendedText !== pq.lowestLine.ocrText
            ? { intendedText: pq.lowestLine.intendedText }
            : {}),
          confidenceRate: pq.lowestLine?.confidenceRate ?? pq.minConfidenceRate,
          note: 'Faint or cramped handwriting — write darker and leave space between steps.',
          _priority: (pq.isWrongAnswer ? 55 : 30) + (1 - pq.minConfidenceRate) * 40
        });
      }
    }

    candidateIssues.sort((a, b) => b._priority - a._priority);
    const issues: HandwritingIssue[] = rating === 'clear'
      ? []
      : candidateIssues.slice(0, 3).map(({ _priority, ...rest }) => rest);

    const flaggedQLabels = issues.map(i => `Q${i.subQ || i.q}`);
    const tip =
      rating === 'clear'
        ? 'Clean, legible working that is easy for examiners to follow.'
        : flaggedQLabels.length > 0
          ? `Write symbols and key terms more clearly in ${flaggedQLabels.slice(0, 2).join(' & ')}.`
          : 'Write darker and leave a little more space between steps.';

    return {
      summary: {
        rating,
        label,
        confidenceRate: Number(overallAvg.toFixed(3)),
        tip,
        issues,
        ...(isTyped ? { isTyped: true } : {})
      },
      perQuestion
    };
  }

  /**
   * Formats compact handwriting signals to append to the existing masterSummary LLM prompt.
   */
  public static formatForSummaryPrompt(analysis: HandwritingAnalysisResult | null): string {
    if (!analysis || analysis.summary.isTyped) return '';
    const { summary, perQuestion } = analysis;

    const lines: string[] = [
      `HANDWRITING OCR SIGNALS (Deterministic rating: ${summary.label}, avg confidence_rate: ${summary.confidenceRate}):`
    ];

    const notable = perQuestion
      .filter(
        pq =>
          pq.mismatches.length > 0 ||
          pq.unmatchedCount >= 2 ||
          pq.avgConfidenceRate < HANDWRITING_THRESHOLDS.LOW_LINE_CONF ||
          pq.minConfidenceRate < HANDWRITING_THRESHOLDS.FAIR_MIN_Q
      )
      .sort((a, b) => (b.mismatches.length - a.mismatches.length) || (a.avgConfidenceRate - b.avgConfidenceRate))
      .slice(0, 4);

    if (notable.length === 0) {
      lines.push('- All attempted questions had high OCR confidence with no major stroke ambiguity.');
    } else {
      for (const pq of notable) {
        const status = pq.isWrongAnswer ? 'lost marks' : 'full marks';
        if (pq.mismatches.length > 0) {
          const m = pq.mismatches[0];
          const label = m.subQ ? `Q${m.subQ}` : `Q${pq.q}`;
          lines.push(
            `- ${label} (${status}, conf ${pq.avgConfidenceRate}): Mathpix literally read "${m.ocrText}" vs student line "${m.intendedText}"`
          );
        } else if (pq.unmatchedCount >= 2) {
          const label = pq.unmatchedSubQ ? `Q${pq.unmatchedSubQ}` : `Q${pq.q}`;
          lines.push(
            `- ${label} (${status}): ${pq.unmatchedCount}/${pq.matchedCount + pq.unmatchedCount} handwritten steps could not be read cleanly by OCR (e.g. "${pq.unmatchedSample || ''}")`
          );
        } else {
          const label = pq.lowestLine?.subQ ? `Q${pq.lowestLine.subQ}` : `Q${pq.q}`;
          lines.push(
            `- ${label} (${status}, avg conf ${pq.avgConfidenceRate}, min ${pq.minConfidenceRate}): low-clarity line "${pq.lowestLine?.ocrText || ''}"`
          );
        }
      }
    }

    return lines.join('\n') + '\n\n';
  }
}
