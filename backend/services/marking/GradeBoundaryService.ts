/**
 * GradeBoundaryService
 * Calculates student grades based on grade boundaries and exam data
 */

import { getFirestore } from '../../config/firebase.js';
import { NormalizationService } from './NormalizationService.js';
import type { UnifiedSession } from '../../types/index.js';

export interface GradeBoundaryEntry {
  id: string;
  exam_board: string;
  qualification: string;
  exam_series: string;
  subjects: Array<{
    name: string;
    code: string;
    max_mark: number;
    tiers: Array<{
      tier_level: string;
      paper_codes: string[];
      boundaries_type: 'Paper-Specific' | 'Overall-Total';
      papers?: Array<{
        code: string;
        max_mark: number;
        boundaries: { [grade: string]: number };
      }>;
      overall_total_boundaries?: { [grade: string]: number };
    }>;
  }>;
}

export interface GradeResult {
  grade: string | null;
  predictedGrade?: string | null;
  boundaryType: 'Paper-Specific' | 'Overall-Total' | null;
  matchedBoundary: GradeBoundaryEntry | null;
  boundaries?: { [grade: string]: number }; // Store the actual boundaries used for calculation
  error?: string;
}

export class GradeBoundaryService {
  /**
   * Calculate grade for a specific exam paper
   */
  static async calculateGradeForExamPaper(
    examBoard: string,
    examSeries: string,
    subject: string,
    examCode: string,
    tier: string,
    studentScore: number,
    totalMarks: number
  ): Promise<GradeResult> {
    try {
      // Find matching grade boundary entry
      const boundaryEntry = await this.findMatchingGradeBoundary(
        examBoard,
        examSeries,
        subject,
        examCode,
        tier
      );

      if (!boundaryEntry) {
        return {
          grade: null,
          boundaryType: null,
          matchedBoundary: null,
          error: 'No matching grade boundary found'
        };
      }

      // Find matching subject
      const matchingSubject = boundaryEntry.subjects.find(s =>
        this.normalizeSubjectName(s.name) === this.normalizeSubjectName(subject) ||
        this.extractSubjectCodeFromExamCode(examCode) === s.code
      );

      if (!matchingSubject) {

        return {
          grade: null,
          boundaryType: null,
          matchedBoundary: boundaryEntry,
          error: 'Subject not found in grade boundary'
        };
      }



      // Find matching tier (with fallback for untiered subjects like GCSE English 8700/8702 or A-Level)
      const isUntieredValue = (val?: string | null): boolean => {
        if (!val) return true;
        const n = this.normalizeTier(val);
        return (
          n === '' ||
          n === 'n/a' ||
          n === 'na' ||
          n === 'none' ||
          n === 'unknown' ||
          n === 'single' ||
          n === 'untiered' ||
          n === 'all' ||
          n === 'not applicable'
        );
      };

      const normalizedTier = this.normalizeTier(tier);
      const availableTiers = matchingSubject.tiers.map(t => t.tier_level || 'Untiered');

      let matchingTier = matchingSubject.tiers.find(t =>
        this.normalizeTier(t.tier_level) === normalizedTier
      );

      // Fallback 1: Both requested tier and DB tier represent untiered (e.g., paper has "N/A" and DB has "" / undefined / "Unknown")
      if (!matchingTier && isUntieredValue(tier)) {
        matchingTier = matchingSubject.tiers.find(t => isUntieredValue(t.tier_level));
      }

      // Fallback 2: Subject only has 1 tier entry in the database (untiered qualification)
      if (!matchingTier && matchingSubject.tiers.length === 1) {
        matchingTier = matchingSubject.tiers[0];
      }

      if (!matchingTier) {
        return {
          grade: null,
          boundaryType: null,
          matchedBoundary: boundaryEntry,
          error: `Tier not found in grade boundary. Looking for: "${tier}", Available: ${availableTiers.join(', ')}`
        };
      }

      // Resolve overall total boundaries across schema variants
      const overallTotalBoundaries: { [grade: string]: number } | undefined =
        matchingTier.overall_total_boundaries ||
        (matchingTier as any).papers_combined_boundaries?.total_raw_mark_required ||
        (matchingTier as any).boundaries;

      // Smart boundary type selection:
      // - Prefer Paper-Specific if available for single paper scores (< 100 total marks)
      // - Fall back to Overall-Total (scaled to single paper max marks if totalMarks < subject.max_mark)
      const hasPaperSpecific = Boolean(matchingTier.papers && matchingTier.papers.length > 0);
      const hasOverallTotal = Boolean(overallTotalBoundaries && Object.keys(overallTotalBoundaries).length > 0);
      const isSinglePaper = totalMarks <= 100;

      if (hasPaperSpecific && (matchingTier.boundaries_type === 'Paper-Specific' || isSinglePaper || !hasOverallTotal)) {
        const paperSpecificResult = this.calculatePaperSpecificGrade(
          matchingTier,
          examCode,
          studentScore,
          totalMarks,
          boundaryEntry
        );
        if (paperSpecificResult.boundaries && Object.keys(paperSpecificResult.boundaries).length > 0) {
          return paperSpecificResult;
        }
        // If Paper-Specific lookup failed (e.g. paper array lacks boundaries) and Overall-Total is available, fall through to Overall-Total
        if (!hasOverallTotal) {
          return paperSpecificResult;
        }
      }

      if (hasOverallTotal && overallTotalBoundaries) {
        // Normalize onto matchingTier so calculateOverallTotalGrade has direct access
        matchingTier.overall_total_boundaries = overallTotalBoundaries;

        // If this is a single paper upload (e.g. 80 marks out of 160 total for English 8700, or 80 out of 240 for Maths)
        // and only combined Overall-Total boundaries exist in DB, proportionally scale the boundaries to this paper's max mark
        const subjectMaxMark = Number(matchingSubject.max_mark) || 0;
        if (totalMarks > 0 && subjectMaxMark > 0 && totalMarks < subjectMaxMark * 0.9) {
          const scaleRatio = totalMarks / subjectMaxMark;
          const scaledBoundaries: { [grade: string]: number } = {};
          for (const [g, mark] of Object.entries(overallTotalBoundaries)) {
            scaledBoundaries[g] = Math.round(Number(mark) * scaleRatio);
          }
          const grade = this.findGradeFromBoundaries(studentScore, scaledBoundaries);
          return {
            grade,
            predictedGrade: grade,
            boundaryType: 'Paper-Specific',
            matchedBoundary: boundaryEntry,
            boundaries: scaledBoundaries
          };
        }

        const result = this.calculateOverallTotalGrade(
          matchingTier,
          matchingSubject,
          studentScore,
          totalMarks,
          boundaryEntry
        );
        return result;
      }

      return {
        grade: null,
        boundaryType: null,
        matchedBoundary: boundaryEntry,
        error: 'Unknown boundary type'
      };
    } catch (error) {
      return {
        grade: null,
        boundaryType: null,
        matchedBoundary: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find matching grade boundary entry from Firestore
   * Public method for use by AnalysisService
   */
  static async findMatchingGradeBoundary(
    examBoard: string,
    examSeries: string,
    subject: string,
    examCode: string,
    tier: string
  ): Promise<GradeBoundaryEntry | null> {
    try {
      const db = getFirestore();
      if (!db) {
        return null;
      }

      // Query grade boundaries collection using variations to catch "June", "May", or "Summer"
      const seriesVariations = NormalizationService.getExamSeriesVariations(examSeries, examBoard);

      let snapshot;
      if (seriesVariations.length > 0) {
        snapshot = await db.collection('gradeBoundaries')
          .where('exam_board', '==', examBoard)
          .where('exam_series', 'in', seriesVariations)
          .get();
      } else {
        snapshot = await db.collection('gradeBoundaries')
          .where('exam_board', '==', examBoard)
          .where('exam_series', '==', examSeries)
          .get();
      }

      if (snapshot.empty) {
        return null;
      }

      // Find the best matching entry (should be only one, but handle multiple)
      for (const doc of snapshot.docs) {
        const entry = { id: doc.id, ...doc.data() } as GradeBoundaryEntry;

        // Check if subject matches
        const hasMatchingSubject = entry.subjects.some(s =>
          this.normalizeSubjectName(s.name) === this.normalizeSubjectName(subject) ||
          this.extractSubjectCodeFromExamCode(examCode) === s.code
        );

        if (hasMatchingSubject) {
          return entry;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Calculate grade for Paper-Specific boundaries
   */
  private static calculatePaperSpecificGrade(
    tier: GradeBoundaryEntry['subjects'][0]['tiers'][0],
    examCode: string,
    studentScore: number,
    currentPossibleScore: number,
    boundaryEntry: GradeBoundaryEntry
  ): GradeResult {
    if (!tier.papers || tier.papers.length === 0) {
      return {
        grade: null,
        boundaryType: 'Paper-Specific',
        matchedBoundary: boundaryEntry,
        error: 'No paper-specific boundaries found'
      };
    }

    // Extract paper code from examCode (e.g., "1MA1/2H" -> "2H", "8700/2" -> "2")
    const paperCode = this.extractPaperCodeFromExamCode(examCode);
    const fullExamCodeNorm = String(examCode || '').trim().toLowerCase();
    const shortPaperCodeNorm = String(paperCode || '').trim().toLowerCase();

    // Find matching paper (supports both short code like "2H" / "2" AND full code like "8700/2")
    const matchingPaper = tier.papers?.find(p => {
      const pCodeNorm = String(p.code || '').trim().toLowerCase();
      const pShortNorm = String(this.extractPaperCodeFromExamCode(p.code) || '').trim().toLowerCase();
      return (
        (shortPaperCodeNorm && pCodeNorm === shortPaperCodeNorm) ||
        (fullExamCodeNorm && pCodeNorm === fullExamCodeNorm) ||
        (shortPaperCodeNorm && pShortNorm && pShortNorm === shortPaperCodeNorm)
      );
    });
    if (!matchingPaper) {
      return {
        grade: null,
        boundaryType: 'Paper-Specific',
        matchedBoundary: boundaryEntry,
        error: `Paper code ${paperCode || examCode} not found in boundaries`
      };
    }

    const paperBoundaries =
      matchingPaper.boundaries ||
      (matchingPaper as any).raw_mark_boundaries ||
      (matchingPaper as any).grade_boundaries;

    if (!paperBoundaries || Object.keys(paperBoundaries).length === 0) {
      return {
        grade: null,
        boundaryType: 'Paper-Specific',
        matchedBoundary: boundaryEntry,
        error: `No boundaries defined for paper ${matchingPaper.code}`
      };
    }

    // Calculate grade from boundaries
    const grade = this.findGradeFromBoundaries(studentScore, paperBoundaries);

    let predictedGrade = grade;

    return {
      grade,
      predictedGrade,
      boundaryType: 'Paper-Specific',
      matchedBoundary: boundaryEntry,
      boundaries: paperBoundaries // Store boundaries for persistence
    };
  }

  /**
   * Calculate grade for Overall-Total boundaries
   */
  private static calculateOverallTotalGrade(
    tier: GradeBoundaryEntry['subjects'][0]['tiers'][0],
    subject: GradeBoundaryEntry['subjects'][0],
    studentScore: number,
    currentPossibleScore: number,
    boundaryEntry: GradeBoundaryEntry
  ): GradeResult {
    if (!tier.overall_total_boundaries) {
      return {
        grade: null,
        boundaryType: 'Overall-Total',
        matchedBoundary: boundaryEntry,
        error: 'No overall-total boundaries found'
      };
    }

    // Calculate grade from boundaries
    const grade = this.findGradeFromBoundaries(studentScore, tier.overall_total_boundaries);

    let predictedGrade = grade;

    return {
      grade,
      predictedGrade,
      boundaryType: 'Overall-Total',
      matchedBoundary: boundaryEntry,
      boundaries: tier.overall_total_boundaries // Store boundaries for persistence
    };
  }

  /**
   * Find grade from boundaries object
   * Returns the highest grade where studentScore >= boundary
   */
  private static findGradeFromBoundaries(
    studentScore: number,
    boundaries: { [grade: string]: number }
  ): string | null {
    // Convert boundaries to array and sort by grade (descending: 9, 8, 7, ...)
    const gradeEntries = Object.entries(boundaries)
      .map(([grade, boundary]) => ({ grade, boundary: Number(boundary) }))
      .sort((a, b) => {
        // Sort by grade number (9 > 8 > 7 > ... > 1)
        const gradeA = parseInt(a.grade) || 0;
        const gradeB = parseInt(b.grade) || 0;
        return gradeB - gradeA;
      });

    // Find highest grade where student score >= boundary
    for (const entry of gradeEntries) {
      if (studentScore >= entry.boundary) {
        return entry.grade;
      }
    }

    // If score is below all boundaries, return null (unclassified)
    return null;
  }

  /**
   * Extract paper code from examCode
   * Examples: "1MA1/2H" -> "2H", "8300/1H" -> "1H"
   */
  private static extractPaperCodeFromExamCode(examCode: string): string | null {
    if (!examCode || !examCode.includes('/')) {
      return null;
    }

    const parts = examCode.split('/');
    if (parts.length < 2) {
      return null;
    }

    return parts[parts.length - 1].trim();
  }

  /**
   * Extract subject code from examCode
   * Examples: "1MA1/2H" -> "1MA1", "8300/1H" -> "8300"
   */
  private static extractSubjectCodeFromExamCode(examCode: string): string | null {
    if (!examCode || !examCode.includes('/')) {
      return null;
    }

    const parts = examCode.split('/');
    if (parts.length < 2) {
      return null;
    }

    return parts[0].trim();
  }

  /**
   * Normalize subject name for matching
   */
  private static normalizeSubjectName(subject: string): string {
    return subject.toLowerCase()
      .replace(/\b(gcse|a-level|alevel|as-level|a2-level|igcse|international|advanced)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize tier for matching
   * Handles variations like "Higher Tier", "Higher", "higher", "Foundation Tier", etc.
   */
  private static normalizeTier(tier: string): string {
    if (!tier) return '';

    const normalized = tier.toLowerCase().trim();

    // Remove "tier" suffix if present (e.g., "higher tier" -> "higher")
    if (normalized.endsWith(' tier')) {
      return normalized.slice(0, -5).trim();
    }

    return normalized;
  }

  /**
   * Infer subject from exam code (e.g., "1MA1" -> "MATHEMATICS", "8700" -> "ENGLISH LANGUAGE")
   */
  static inferSubjectFromExamCode(examCode: string): string {
    if (examCode.includes('1MA1') || examCode.includes('MA1') || examCode.includes('8300') || examCode.includes('J560')) {
      return 'MATHEMATICS';
    } else if (examCode.includes('8700') || examCode.includes('1EN0')) {
      return 'ENGLISH LANGUAGE';
    } else if (examCode.includes('8702') || examCode.includes('1ET0')) {
      return 'ENGLISH LITERATURE';
    } else if (examCode.includes('1PH0') || examCode.includes('PH0')) {
      return 'PHYSICS';
    } else if (examCode.includes('1CH0') || examCode.includes('CH0')) {
      return 'CHEMISTRY';
    }
    return '';
  }

  /**
   * Extract exam data from marking schemes map (for marking mode)
   */
  static extractExamDataFromMarkingSchemes(
    markingSchemesMap: Map<string, any>
  ): any | null {
    if (!markingSchemesMap || markingSchemesMap.size === 0) {
      return null;
    }

    const allSchemes = Array.from(markingSchemesMap.values());
    const firstScheme =
      allSchemes.find(s => !s?.isGeneric && s?.questionDetection?.found && s?.questionDetection?.match) ||
      allSchemes[0];
    const firstDetection = firstScheme?.questionDetection;

    if (firstDetection && firstDetection.found && firstDetection.match) {
      const match = firstDetection.match;
      // Get subject from match or marking scheme if available, otherwise infer from exam code
      let subject = '';
      if (match.subject && match.subject !== 'General') {
        subject = match.subject;
      } else if (match.markingScheme?.examDetails?.subject) {
        subject = match.markingScheme.examDetails.subject;
      } else if (firstDetection.markingScheme?.examDetails?.subject) {
        subject = firstDetection.markingScheme.examDetails.subject;
      } else {
        const examCode = match.paperCode || '';
        subject = this.inferSubjectFromExamCode(examCode);
        if (!subject) {
          subject = match.qualification || '';
        }
      }

      return {
        found: true,
        examPapers: [{
          examBoard: match.board || '',
          examCode: match.paperCode || '',
          examSeries: match.examSeries || (match as any).year || '',
          tier: match.tier || '',
          subject: subject
        }]
      };
    }

    return null;
  }

  /**
   * Calculate grade with orchestration (handles both question mode and marking mode)
   * Tries questionDetection first, then falls back to markingSchemesMap
   */
  static async calculateGradeWithOrchestration(
    overallScore: number,
    totalPossibleScore: number,
    questionDetection?: any,
    markingSchemesMap?: Map<string, any>
  ): Promise<{ grade: string | null; predictedGrade: string | null; boundaryType: 'Paper-Specific' | 'Overall-Total' | null; boundaries?: { [grade: string]: number } }> {
    let calculatedGrade: string | null = null;
    let predictedGrade: string | null = null;
    let gradeBoundaryType: 'Paper-Specific' | 'Overall-Total' | null = null;
    let gradeBoundaries: { [grade: string]: number } | undefined = undefined;

    // Try to get exam data from questionDetection (question mode) or markingSchemesMap (marking mode)
    let examDataForGrade: any = null;

    // First, try questionDetection (available in question mode)
    if (questionDetection && questionDetection.found && questionDetection.examPapers && questionDetection.examPapers.length > 0) {
      examDataForGrade = questionDetection;
    } else if (markingSchemesMap) {
      // Fallback: extract exam data from markingSchemesMap (marking mode)
      examDataForGrade = this.extractExamDataFromMarkingSchemes(markingSchemesMap);
    }

    // Only attempt grade calculation if we have exam data and scores
    if (examDataForGrade && examDataForGrade.found && examDataForGrade.examPapers && examDataForGrade.examPapers.length > 0) {
      try {
        const firstExamPaper = examDataForGrade.examPapers[0];

        const gradeResult = await this.calculateGradeForExamPaper(
          firstExamPaper.examBoard,
          firstExamPaper.examSeries || (firstExamPaper as any).year, // Migration support
          firstExamPaper.subject,
          firstExamPaper.examCode,
          firstExamPaper.tier,
          overallScore,
          totalPossibleScore
        );

        // Always store boundaries if available
        if (gradeResult.boundaries) {
          gradeBoundaryType = gradeResult.boundaryType;
          gradeBoundaries = gradeResult.boundaries;
        }
        if (gradeResult.grade) {
          calculatedGrade = gradeResult.grade;
        }
        if (gradeResult.predictedGrade) {
          predictedGrade = gradeResult.predictedGrade;
        } else if (gradeResult.error) {
        }
      } catch (gradeError) {
        // Don't fail the marking pipeline if grade calculation fails
      }
    } else {
      // Log why grade calculation is skipped
      if (!examDataForGrade) {
      } else if (!examDataForGrade.found) {
      } else if (!examDataForGrade.examPapers || examDataForGrade.examPapers.length === 0) {
      }
    }

    return {
      grade: calculatedGrade,
      predictedGrade: predictedGrade,
      boundaryType: gradeBoundaryType,
      boundaries: gradeBoundaries
    };
  }
}

