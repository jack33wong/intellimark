/**
 * Subject Marking Result Service
 * Handles conversion and persistence of marking results to subjectMarkingResults collection
 */

import { FirestoreService } from './firestoreService.js';
import type { UnifiedSession, UnifiedMessage, DetectedQuestion } from '../types/index.js';

/**
 * Extract subject from detectedQuestion
 * Returns normalized subject name or null if not found
 */
export function extractSubjectFromDetectedQuestion(detectedQuestion: DetectedQuestion | null | undefined): string | null {
  if (!detectedQuestion || !detectedQuestion.found) {
    return null;
  }

  if (detectedQuestion.examPapers && detectedQuestion.examPapers.length > 0) {
    const subject = detectedQuestion.examPapers[0].subject;
    console.log(`🔍 [SUBJECT EXTRACTION] examPapers[0].subject = "${subject}"`); // DEBUG: Verify new code is running
    if (subject) {
      return normalizeSubjectName(subject);
    }
  }

  return null;
}

/**
 * Normalize subject name (e.g., "MATHEMATICS" -> "Mathematics")
 */
export function normalizeSubjectName(subject: string): string {
  if (!subject) return '';

  // Map common variations to standard names
  const subjectMap: { [key: string]: string } = {
    'mathematics': 'Mathematics',
    'maths': 'Mathematics',
    'math': 'Mathematics',
    'physics': 'Physics',
    'chemistry': 'Chemistry',
    'biology': 'Biology'
  };

  const lowerSubject = subject.toLowerCase().trim();

  // Check if it's a known subject variation
  if (subjectMap[lowerSubject]) {
    return subjectMap[lowerSubject];
  }

  // Convert to title case
  return subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
}

/**
 * Convert UnifiedSession marking result to subjectMarkingResults format
 */
export function convertMarkingResultToSubjectFormat(
  session: UnifiedSession,
  markingMessage: UnifiedMessage
): any | null {
  try {
    const detectedQuestion = markingMessage.detectedQuestion || session.detectedQuestion;

    if (!detectedQuestion || !detectedQuestion.found) {
      return null;
    }

    const subject = extractSubjectFromDetectedQuestion(detectedQuestion);
    if (!subject) {
      return null; // Skip if no subject
    }

    if (!markingMessage.studentScore) {
      return null; // Skip if no student score
    }

    // Extract exam metadata from first exam paper
    const firstExamPaper = detectedQuestion.examPapers?.[0];
    if (!firstExamPaper) {
      return null;
    }

    // Build question results from detailed Marking Results (Truth Source)
    // Avoids re-estimating from stale schema defaults (e.g. 20/40 issue)
    const questionResults: any[] = [];

    // 1. Try markingContext (New Truth Source) - Most robust for persisted data
    // 2. Fallback to allQuestionResults (Legacy/In-Memory)
    const markingContext = (markingMessage as any).markingContext;
    const sourceResults = markingContext?.questionResults || (markingMessage as any).allQuestionResults || (session as any).allQuestionResults;

    if (sourceResults && Array.isArray(sourceResults) && sourceResults.length > 0) {
      sourceResults.forEach((qr: any) => {
        // Handle both MarkingContextQuestionResult and old QuestionResult formats
        const qNum = qr.number || qr.questionNumber || '';
        const awarded = qr.earnedMarks ?? qr.score?.awardedMarks ?? 0;
        const total = qr.totalMarks ?? qr.score?.totalMarks ?? 0;
        const text = qr.score?.scoreText || `${awarded}/${total}`;

        questionResults.push({
          questionNumber: qNum,
          score: {
            awardedMarks: awarded,
            totalMarks: total,
            scoreText: text
          }
        });
      });
    } else if (detectedQuestion.examPapers) {
      // Fallback: Estimate from Exam Paper Schema (if granular results missing)
      detectedQuestion.examPapers.forEach((examPaper: any) => {
        if (examPaper.questions && Array.isArray(examPaper.questions)) {
          examPaper.questions.forEach((q: any) => {
            // Calculate question score from overall percentage
            const overallPercentage = markingMessage.studentScore!.totalMarks > 0
              ? markingMessage.studentScore!.awardedMarks / markingMessage.studentScore!.totalMarks
              : 0;

            const estimatedAwardedMarks = Math.round((q.marks || 0) * overallPercentage);

            questionResults.push({
              questionNumber: q.questionNumber || '',
              score: {
                awardedMarks: estimatedAwardedMarks,
                totalMarks: q.marks || 0
              }
            });
          });
        }
      });
    }

    // Build marking result object
    const markingResult = {
      sessionId: session.id,
      timestamp: markingMessage.timestamp || session.updatedAt || session.createdAt,
      examMetadata: {
        examBoard: firstExamPaper.examBoard || '',
        examCode: firstExamPaper.examCode || '',
        examSeries: firstExamPaper.examSeries || '',
        qualification: 'GCSE', // Unified to GCSE
        tier: firstExamPaper.tier || ''
      },
      questionResults,
      overallScore: {
        awardedMarks: markingMessage.studentScore.awardedMarks,
        totalMarks: markingMessage.studentScore.totalMarks
      },
      grade: (markingMessage as any).grade || undefined,
      gradeBoundaries: (markingMessage as any).gradeBoundaries ? {
        boundaries: (markingMessage as any).gradeBoundaries,
        boundaryType: (markingMessage as any).gradeBoundaryType || undefined
      } : undefined,
      modelUsed: markingMessage.processingStats?.modelUsed || session.sessionStats?.lastModelUsed || 'auto'
    };

    return {
      subject,
      markingResult
    };
  } catch (error) {
    console.error('❌ [SUBJECT MARKING RESULT] Error converting marking result:', error);
    return null;
  }
}

/**
 * Persist marking result to subjectMarkingResults (called in background)
 */
export async function persistMarkingResultToSubject(
  session: UnifiedSession,
  markingMessage: UnifiedMessage
): Promise<void> {
  try {
    const converted = convertMarkingResultToSubjectFormat(session, markingMessage);

    if (!converted || !converted.subject || !converted.markingResult) {
      return; // Skip if conversion failed or no subject
    }

    // Get userId from session
    const userId = session.userId;
    if (!userId) {
      console.warn('❌ [SUBJECT MARKING RESULT] No userId in session, skipping persistence');
      return;
    }

    // Persist to Firestore (in background, don't wait)
    await FirestoreService.addMarkingResultToSubject(
      userId,
      converted.subject,
      converted.markingResult
    );

    console.log(`✅ [SUBJECT MARKING RESULT] Persisted marking result for subject: ${converted.subject}, session: ${session.id}`);
  } catch (error) {
    console.error('❌ [SUBJECT MARKING RESULT] Error persisting marking result:', error);
    // Don't throw - this is background operation, shouldn't affect marking pipeline
  }
}

