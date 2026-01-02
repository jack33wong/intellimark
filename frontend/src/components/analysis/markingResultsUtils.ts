/**
 * Utility functions for grouping and processing marking results
 */

export interface MarkingResult {
  sessionId: string;
  timestamp: string;
  examMetadata: {
    examBoard: string;
    examCode: string;
    examSeries: string;
    qualification: string;
    tier?: string;
  };
  overallScore: {
    awardedMarks: number;
    totalMarks: number;
  };
  grade?: string;
  modelUsed: string;
}

export interface ExamCodeGroup {
  examCode: string;
  records: MarkingResult[];
}

export interface GroupedMarkingResult {
  paperCodeSet: string[];
  paperCodeSetKey: string; // e.g., "1H_2H_3H"
  tier?: string;
  examSeries: string;
  examCodeGroups: ExamCodeGroup[];
}

/**
 * Extract paper code from examCode (e.g., "1MA1/1H" -> "1H")
 */
export function extractPaperCode(examCode: string): string | null {
  if (!examCode || !examCode.includes('/')) return null;
  const parts = examCode.split('/');
  return parts.length > 1 ? parts[parts.length - 1].trim() : null;
}

/**
 * Normalize exam board name for comparison (handles variations like "Pearson Edexcel" vs "Edexcel")
 */
export function normalizeExamBoard(board: string): string {
  if (!board) return '';
  const normalized = board.toLowerCase().trim();
  // Map common variations
  if (normalized.includes('edexcel')) return 'Pearson Edexcel';
  if (normalized.includes('aqa')) return 'AQA';
  if (normalized.includes('ocr')) return 'OCR';
  if (normalized.includes('wjec')) return 'WJEC';
  if (normalized.includes('eduqas')) return 'Eduqas';
  return board; // Return original if no match
}

/**
 * Normalize exam series mapping (e.g., "May 2024" to "June 2024" for Edexcel)
 */
export function normalizeExamSeries(series: string, board?: string): string {
  if (!series) return '';
  const normalizedSeries = series.trim();
  const normalizedBoard = board ? normalizeExamBoard(board) : '';

  // Pearson Edexcel: map "May [Year]" to "June [Year]"
  if (normalizedBoard === 'Pearson Edexcel' || !normalizedBoard) {
    if (/^May\s+\d{4}$/i.test(normalizedSeries)) {
      return normalizedSeries.replace(/^May/i, 'June');
    }
  }

  return normalizedSeries;
}

/**
 * Group marking results by paper code set, exam series, and exam code
 */
export function groupMarkingResults(
  results: MarkingResult[],
  paperCodeSet: string[]
): GroupedMarkingResult[] {
  if (!paperCodeSet || paperCodeSet.length === 0) {
    return [];
  }

  // If no results at all, return empty group for the first exam series (we'll use a placeholder)
  if (!results || results.length === 0) {
    // Return an empty group structure so the paper code set still appears
    const examCodeGroups: ExamCodeGroup[] = paperCodeSet.map(paperCode => ({
      examCode: paperCode, // Use paper code as exam code when no results
      records: []
    }));

    return [{
      paperCodeSet,
      paperCodeSetKey: paperCodeSet.join('_'),
      tier: undefined,
      examSeries: 'No Results', // Placeholder
      examCodeGroups
    }];
  }

  // Create a map: examSeries -> examCode -> records
  // We use normalized exam series for grouping
  const seriesMap = new Map<string, Map<string, MarkingResult[]>>();

  // Filter results that match the paper code set
  const filteredResults = results.filter(result => {
    const paperCode = extractPaperCode(result.examMetadata.examCode);
    return paperCode && paperCodeSet.includes(paperCode);
  });

  // Get all unique exam series from all results (not just filtered ones)
  // Normalizing to ensure "May" and "June" results are in the same set
  const allExamSeries = new Set<string>();
  results.forEach(result => {
    const normalizedSeries = normalizeExamSeries(
      result.examMetadata.examSeries,
      result.examMetadata.examBoard
    );
    allExamSeries.add(normalizedSeries);
  });

  // If no exam series found at all, use a placeholder
  if (allExamSeries.size === 0) {
    allExamSeries.add('No Results');
  }

  // Group by exam series and exam code
  filteredResults.forEach(result => {
    // Normalize exam series for grouping
    const originalSeries = result.examMetadata.examSeries;
    const examBoard = result.examMetadata.examBoard;
    const examSeries = normalizeExamSeries(originalSeries, examBoard);
    const examCode = result.examMetadata.examCode;

    if (!seriesMap.has(examSeries)) {
      seriesMap.set(examSeries, new Map());
    }

    const examCodeMap = seriesMap.get(examSeries)!;
    if (!examCodeMap.has(examCode)) {
      examCodeMap.set(examCode, []);
    }

    examCodeMap.get(examCode)!.push(result);
  });

  // Convert to GroupedMarkingResult array
  const grouped: GroupedMarkingResult[] = [];

  // Get a sample exam code from all results to construct exam codes for empty paper codes
  // This is used when a paper code set has no records but we still want to show it
  let globalSampleExamCode: string | null = null;
  const seriesMapValues = Array.from(seriesMap.values());
  for (let i = 0; i < seriesMapValues.length; i++) {
    const examCodeMap = seriesMapValues[i];
    if (examCodeMap.size > 0) {
      const examCodes = Array.from(examCodeMap.keys());
      if (examCodes.length > 0) {
        globalSampleExamCode = examCodes[0] as string;
        break;
      }
    }
  }
  // If still no sample, try to get from all results
  if (!globalSampleExamCode && results.length > 0) {
    globalSampleExamCode = results[0].examMetadata.examCode;
  }

  // Process all exam series (including those with no records for this paper code set)
  allExamSeries.forEach(examSeries => {
    const examCodeMap = seriesMap.get(examSeries) || new Map();

    // Use global sample exam code for constructing empty exam codes
    const sampleExamCode = globalSampleExamCode;

    // Sort exam codes to match paper code set order
    const examCodeGroups: ExamCodeGroup[] = paperCodeSet
      .map(paperCode => {
        // Find exam code that matches this paper code
        const matchingExamCode = Array.from(examCodeMap.keys()).find(examCode => {
          const pc = extractPaperCode(examCode);
          return pc === paperCode;
        });

        if (matchingExamCode) {
          const records = examCodeMap.get(matchingExamCode)!;
          // Sort records by timestamp (newest first)
          records.sort((a: MarkingResult, b: MarkingResult) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          return {
            examCode: matchingExamCode,
            records
          };
        } else {
          // No records for this paper code - construct exam code from paper code
          if (sampleExamCode) {
            const parts = sampleExamCode.split('/');
            if (parts.length >= 2) {
              const constructedExamCode = `${parts[0]}/${paperCode}`;
              return {
                examCode: constructedExamCode,
                records: []
              };
            }
          }
          // Fallback: just use paper code
          return {
            examCode: paperCode,
            records: []
          };
        }
      })
      .filter(group => group.examCode !== '');

    // Always add groups, even if they have no records
    // This ensures all paper code sets from grade boundaries are shown
    grouped.push({
      paperCodeSet,
      paperCodeSetKey: paperCodeSet.join('_'),
      tier: filteredResults[0]?.examMetadata.tier,
      examSeries,
      examCodeGroups
    });
  });

  // Sort by exam series (chronologically - newest first)
  grouped.sort((a, b) => {
    // Try to parse dates from exam series (e.g., "June 2024")
    const dateA = parseExamSeriesDate(a.examSeries);
    const dateB = parseExamSeriesDate(b.examSeries);
    return dateB.getTime() - dateA.getTime();
  });

  return grouped;
}

/**
 * Parse exam series string to Date (e.g., "June 2024" -> Date)
 */
export function parseExamSeriesDate(examSeries: string): Date {
  const months: { [key: string]: number } = {
    'january': 0, 'february': 1, 'march': 2, 'april': 3,
    'may': 4, 'june': 5, 'july': 6, 'august': 7,
    'september': 8, 'october': 9, 'november': 10, 'december': 11
  };

  const parts = examSeries.toLowerCase().split(' ');
  if (parts.length >= 2) {
    const month = months[parts[0]];
    const year = parseInt(parts[1], 10);
    if (month !== undefined && !isNaN(year)) {
      return new Date(year, month, 1);
    }
  }

  // Fallback: return current date if parsing fails
  return new Date();
}

/**
 * Get indicator color for a paper code set + exam series group
 */
export function getGroupIndicator(group: GroupedMarkingResult): 'green' | 'yellow' | 'red' {
  const examCodeGroups = group.examCodeGroups;
  const groupsWithResults = examCodeGroups.filter(eg => eg.records.length > 0);
  const totalExpected = group.paperCodeSet.length;

  if (groupsWithResults.length === 0) {
    return 'red'; // No results
  } else if (groupsWithResults.length === totalExpected) {
    return 'green'; // All exam codes have results
  } else {
    return 'yellow'; // Partial: some have results, some don't
  }
}

/**
 * Get indicator color for an exam code group
 */
export function getExamCodeIndicator(examCodeGroup: ExamCodeGroup): 'green' | 'red' {
  return examCodeGroup.records.length > 0 ? 'green' : 'red';
}
