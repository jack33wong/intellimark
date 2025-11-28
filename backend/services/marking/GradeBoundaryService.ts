/**
 * GradeBoundaryService
 * Calculates student grades based on grade boundaries and exam data
 */

import { getFirestore } from '../../config/firebase.js';
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



      // Find matching tier
      const normalizedTier = this.normalizeTier(tier);
      const availableTiers = matchingSubject.tiers.map(t => t.tier_level);
      const normalizedAvailableTiers = matchingSubject.tiers.map(t => this.normalizeTier(t.tier_level));



      const matchingTier = matchingSubject.tiers.find(t =>
        this.normalizeTier(t.tier_level) === normalizedTier
      );

      if (!matchingTier) {

        return {
          grade: null,
          boundaryType: null,
          matchedBoundary: boundaryEntry,
          error: `Tier not found in grade boundary. Looking for: "${tier}", Available: ${availableTiers.join(', ')}`
        };
      }



      // Smart boundary type selection:
      // - Use Paper-Specific for single paper scores (< 100 total marks)
      // - Use Overall-Total for combined scores (>= 100 total marks)
      // - Prefer Paper-Specific if both are available and score < 100
      const hasPaperSpecific = matchingTier.papers && matchingTier.papers.length > 0;
      const hasOverallTotal = !!matchingTier.overall_total_boundaries;
      const isSinglePaper = totalMarks < 100;

      // Determine boundary type and calculate grade
      if (matchingTier.boundaries_type === 'Paper-Specific' || (hasPaperSpecific && isSinglePaper)) {

        const result = this.calculatePaperSpecificGrade(
          matchingTier,
          examCode,
          studentScore,
          boundaryEntry
        );
        if (result.error) {
        } else if (result.grade) {
        }
        return result;
      } else if (matchingTier.boundaries_type === 'Overall-Total' || (hasOverallTotal && !isSinglePaper)) {

        // Check if this looks like a single paper score (totalMarks < 100 suggests single paper)
        // Overall-total boundaries are typically for much higher totals (e.g., 240 marks for 3 papers)
        // But if we have Paper-Specific available, try that first for single papers
        if (totalMarks < 100 && hasPaperSpecific) {
          // Fall back to Paper-Specific if available
          const result = this.calculatePaperSpecificGrade(
            matchingTier,
            examCode,
            studentScore,
            boundaryEntry
          );
          if (result.error) {
          } else if (result.grade) {
          }
          return result;
        } else if (totalMarks < 100) {
          return {
            grade: null,
            boundaryType: 'Overall-Total',
            matchedBoundary: boundaryEntry,
            error: 'Overall-Total boundaries require combined scores from all papers. Single paper scores should use Paper-Specific boundaries.'
          };
        }

        const result = this.calculateOverallTotalGrade(
          matchingTier,
          studentScore,
          boundaryEntry
        );
        if (result.error) {
        } else if (result.grade) {
        }
        return result;
      } else {
        return {
          grade: null,
          boundaryType: null,
          matchedBoundary: boundaryEntry,
          error: 'Unknown boundary type'
        };
      }
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

      // Query grade boundaries collection
      const snapshot = await db.collection('gradeBoundaries')
        .where('exam_board', '==', examBoard)
        .where('exam_series', '==', examSeries)
        .get();

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

    // Extract paper code from examCode (e.g., "1MA1/2H" -> "2H")
    const paperCode = this.extractPaperCodeFromExamCode(examCode);
    if (!paperCode) {
      return {
        grade: null,
        boundaryType: 'Paper-Specific',
        matchedBoundary: boundaryEntry,
        error: 'Could not extract paper code from examCode'
      };
    }

    // Find matching paper
    const availablePaperCodes = tier.papers?.map(p => p.code) || [];
    const matchingPaper = tier.papers?.find(p => p.code === paperCode);
    if (!matchingPaper) {
      return {
        grade: null,
        boundaryType: 'Paper-Specific',
        matchedBoundary: boundaryEntry,
        error: `Paper code ${paperCode} not found in boundaries`
      };
    }


    // Calculate grade from boundaries
    const grade = this.findGradeFromBoundaries(studentScore, matchingPaper.boundaries);

    return {
      grade,
      boundaryType: 'Paper-Specific',
      matchedBoundary: boundaryEntry,
      boundaries: matchingPaper.boundaries // Store boundaries for persistence
    };
  }

  /**
   * Calculate grade for Overall-Total boundaries
   */
  private static calculateOverallTotalGrade(
    tier: GradeBoundaryEntry['subjects'][0]['tiers'][0],
    studentScore: number,
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

    return {
      grade,
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
   * Infer subject from exam code (e.g., "1MA1" -> "MATHEMATICS")
   */
  static inferSubjectFromExamCode(examCode: string): string {
    if (examCode.includes('1MA1') || examCode.includes('MA1')) {
      return 'MATHEMATICS';
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

    const firstScheme = Array.from(markingSchemesMap.values())[0];
    const firstDetection = firstScheme?.questionDetection;

    if (firstDetection && firstDetection.found && firstDetection.match) {
      const match = firstDetection.match;
      // Get subject from marking scheme if available, otherwise try to infer from exam code
      let subject = '';
      if (firstDetection.markingScheme?.examDetails?.subject) {
        subject = firstDetection.markingScheme.examDetails.subject;
      } else {
        // Infer subject from exam code (e.g., "1MA1" -> "MATHEMATICS")
        const examCode = match.paperCode || '';
        subject = this.inferSubjectFromExamCode(examCode);
        if (!subject) {
          // Fallback: use qualification (but this is wrong, should be subject)
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
  ): Promise<{ grade: string | null; boundaryType: 'Paper-Specific' | 'Overall-Total' | null; boundaries?: { [grade: string]: number } }> {
    let calculatedGrade: string | null = null;
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

        if (gradeResult.grade) {
          calculatedGrade = gradeResult.grade;
          gradeBoundaryType = gradeResult.boundaryType;
          gradeBoundaries = gradeResult.boundaries; // Store boundaries for persistence
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
      boundaryType: gradeBoundaryType,
      boundaries: gradeBoundaries
    };
  }
}

