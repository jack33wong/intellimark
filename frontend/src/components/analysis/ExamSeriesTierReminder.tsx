import React, { useMemo } from 'react';
import {
  normalizeExamBoard,
  parseExamSeriesDate,
  extractPaperCode
} from './markingResultsUtils';
import './ExamSeriesTierReminder.css';

interface MarkingResult {
  timestamp: string;
  examMetadata: {
    examBoard: string;
    examCode: string;
    examSeries: string;
    qualification: string;
    tier?: string;
  };
}

interface GradeBoundary {
  exam_board: string;
  exam_series: string;
  subjects: Array<{
    tiers: Array<{
      tier_level: string;
      paper_codes: string[];
    }>;
  }>;
}

interface PaperCodeSet {
  tier: string;
  paperCodes: string[];
}

interface ExamSeriesTierReminderProps {
  markingResults: MarkingResult[];
  gradeBoundaries: GradeBoundary[];
  availablePaperCodeSets: PaperCodeSet[];
  selectedExamBoard: string;
  selectedQualification: string;
  selectedSubject: string;
}

const ExamSeriesTierReminder: React.FC<ExamSeriesTierReminderProps> = ({
  markingResults,
  gradeBoundaries,
  availablePaperCodeSets,
  selectedExamBoard,
  selectedQualification,
  selectedSubject
}) => {
  const missingInfo = useMemo(() => {
    if (!selectedExamBoard || !selectedQualification || !selectedSubject) {
      return { incompleteSets: [], missingSeries: [] };
    }

    // Get current date and 5 years ago
    const now = new Date();
    const fiveYearsAgo = new Date(now.getFullYear() - 5, 0, 1);

    // Filter grade boundaries for selected exam board
    const relevantBoundaries = gradeBoundaries.filter(gb => {
      return normalizeExamBoard(gb.exam_board) === normalizeExamBoard(selectedExamBoard);
    });

    // Get attempted results (last 5 years, filtered by board and qualification)
    const relevantResults = markingResults.filter(mr => {
      const matchesBoard = normalizeExamBoard(mr.examMetadata.examBoard) === normalizeExamBoard(selectedExamBoard);
      const matchesQualification = mr.examMetadata.qualification === selectedQualification;
      const resultDate = new Date(mr.timestamp);
      const isWithin5Years = resultDate >= fiveYearsAgo;
      return matchesBoard && matchesQualification && isWithin5Years;
    });

    // Build a map: examSeries -> paperCodeSet -> attempted paper codes
    const attemptedMap = new Map<string, Map<string, Set<string>>>();

    relevantResults.forEach(mr => {
      const series = mr.examMetadata.examSeries;
      const paperCode = extractPaperCode(mr.examMetadata.examCode);
      if (!series || !paperCode) return;

      // Find which paper code set this paper code belongs to
      const paperCodeSet = availablePaperCodeSets.find(set =>
        set.paperCodes.includes(paperCode)
      );
      if (!paperCodeSet) return;

      const tierKey = paperCodeSet.tier.toLowerCase();
      if (!attemptedMap.has(series)) {
        attemptedMap.set(series, new Map());
      }
      const tierMap = attemptedMap.get(series)!;
      if (!tierMap.has(tierKey)) {
        tierMap.set(tierKey, new Set());
      }
      tierMap.get(tierKey)!.add(paperCode);
    });

    // Find incomplete paper code sets per exam series
    const incompleteSets: string[] = [];
    const allSeries = new Set<string>();
    const attemptedSeries = new Set<string>();

    relevantBoundaries.forEach(gb => {
      const seriesDate = parseExamSeriesDate(gb.exam_series);
      if (seriesDate < fiveYearsAgo) return;

      const series = gb.exam_series;
      allSeries.add(series);

      // Check if this series has been attempted
      const hasAttempts = attemptedMap.has(series);
      if (hasAttempts) {
        attemptedSeries.add(series);
      }

      // Check each tier/paper code set for this series
      gb.subjects.forEach(subject => {
        subject.tiers.forEach(tier => {
          const tierKey = tier.tier_level.toLowerCase();
          const paperCodeSet = availablePaperCodeSets.find(set =>
            set.tier.toLowerCase() === tierKey
          );
          if (!paperCodeSet) return;

          const attemptedForTier = attemptedMap.get(series)?.get(tierKey) || new Set();
          const missingCodes = paperCodeSet.paperCodes.filter(pc => !attemptedForTier.has(pc));

          if (missingCodes.length > 0 && attemptedForTier.size > 0) {
            // Incomplete set: some paper codes attempted but not all
            incompleteSets.push(`${missingCodes.join(', ')} ${series}`);
          }
        });
      });
    });

    // Find missing exam series (not attempted at all)
    const missingSeries = Array.from(allSeries).filter(series => !attemptedSeries.has(series));
    missingSeries.sort((a, b) => {
      const dateA = parseExamSeriesDate(a);
      const dateB = parseExamSeriesDate(b);
      return dateB.getTime() - dateA.getTime();
    });

    return { incompleteSets, missingSeries };
  }, [markingResults, gradeBoundaries, availablePaperCodeSets, selectedExamBoard, selectedQualification, selectedSubject]);

  if (missingInfo.incompleteSets.length === 0 && missingInfo.missingSeries.length === 0) {
    return null;
  }

  // Build one-line message
  const parts: string[] = [];

  if (missingInfo.incompleteSets.length > 0) {
    parts.push(`Missing paper codes: ${missingInfo.incompleteSets.join('; ')}`);
  }

  if (missingInfo.missingSeries.length > 0) {
    parts.push(`Missing exam series: ${missingInfo.missingSeries.join(', ')}`);
  }

  return (
    <div className="exam-series-tier-reminder">
      <div className="reminder-icon">⚠️</div>
      <div className="reminder-content">
        <span className="reminder-title">Missing Attempts (Last 5 Years):</span>{' '}
        <span className="reminder-text">{parts.join(' | ')}</span>
      </div>
    </div>
  );
};

export default ExamSeriesTierReminder;

