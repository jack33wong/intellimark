import React, { useMemo, useState, useEffect } from 'react';
import { CheckCircle2, Target, Sparkles, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
import './css/PerformanceSummaryPanel.css';

interface RadarPoint {
  axis: string;
  score: number; // 0 - 100
  awarded: number;
  total: number;
  assessed: boolean;
}

interface QuestionCoachingItem {
  q: string;
  rubricStamp: string;
  awardedLevel: number;
  levelLabel: string;
  awardedMarks: number;
  maxMarks: number;
  aoBreakdown?: Array<{
    ao: string;
    skill?: string;
    level: number;
    levelLabel: string;
    awardedMarks: number;
    maxMarks: number;
  }>;
  coaching: {
    rationale: string;
    nextLevelGap: string;
    upgradeRewrite?: {
      originalQuote: string;
      upgradedVersion: string;
      explanation?: string;
    } | null;
  };
}

interface SummaryV2Payload {
  _type: 'AI_SUMMARY_V2';
  level: 'GCSE' | 'ALEVEL';
  subjectKey?: string;
  headline?: string;
  tooDenseWarning?: boolean;
  examInfo?: {
    examBoard?: string;
    examSeries?: string;
    subject?: string;
    examCode?: string;
    tier?: string;
    isModified?: boolean;
  } | null;
  score: {
    awardedMarks: number;
    totalMarks: number;
    percentage: number;
    questionsTotal: number;
    questionsFullMarks: number;
    questionsAttempted: number;
  };
  grading?: {
    grade?: string | null;
    predictedGrade?: string | null;
    boundaries?: Record<string, number>;
  } | null;
  radar: RadarPoint[];
  mastered: Array<{ q?: string; text: string }>;
  focusNext: Array<{ q?: string; text: string }>;
  questionCoaching?: QuestionCoachingItem[];
}

interface PerformanceSummaryPanelProps {
  rawSummary: string;
  MarkdownMathRenderer: React.ElementType;
  onQuestionClick?: (qNum: string) => void;
  activeQuestionId?: string | null;
}

// Helpers for Scannable Micro-Coaching and Single-Expand Strategy
const renderBoldText = (str: string, highlight?: boolean): React.ReactNode[] => {
  if (!str) return [];
  const parts = str.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2);
      return (
        <strong
          key={i}
          className={highlight ? 'coaching-highlight-phrase' : undefined}
        >
          {inner}
        </strong>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

const parseCoachingBullets = (text: string): string[] => {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 1. Pipe-separated bullets: "bullet 1 | bullet 2"
  if (trimmed.includes('|')) {
    return trimmed
      .split(/\s*\|\s*/)
      .map(b => b.trim())
      .filter(Boolean);
  }

  // 2. Numbered markers: "1) ... 2) ..."
  if (/\b\d+\)\s*/.test(trimmed)) {
    return trimmed
      .split(/(?=\b\d+\)\s*)/)
      .map(b => b.replace(/^\d+\)\s*/, '').trim())
      .filter(Boolean);
  }

  // 3. Fallback: multiple sentences if length > 140 chars
  if (trimmed.length > 140) {
    const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
    if (sentences && sentences.length > 1) {
      return sentences.map(s => s.trim()).filter(Boolean).slice(0, 3);
    }
  }

  return [trimmed];
};

const getDefaultExpandedKey = (qcList: QuestionCoachingItem[]): string | null => {
  if (!qcList || qcList.length === 0) return null;
  const parseQNum = (qStr: string | number) => {
    const num = parseInt(String(qStr).replace(/\D/g, ''), 10);
    return isNaN(num) ? 999 : num;
  };
  const sorted = [...qcList].sort((a, b) => parseQNum(a.q) - parseQNum(b.q));

  // 1. Find the first extended question (> 4 maxMarks) that lost marks
  const firstExtendedLost = sorted.find(
    qc => (qc.maxMarks ?? 0) > 4 && (qc.awardedMarks ?? 0) < (qc.maxMarks ?? 0)
  );
  if (firstExtendedLost) return String(firstExtendedLost.q);

  // 2. Fallback: first question of any mark value where marks were lost
  const firstLost = sorted.find(
    qc => (qc.maxMarks ?? 0) > 0 && (qc.awardedMarks ?? 0) < (qc.maxMarks ?? 0)
  );
  if (firstLost) return String(firstLost.q);

  // 3. Fallback: first question in qcList
  if (sorted.length > 0) return String(sorted[0].q);
  return null;
};

const getCardPreviewText = (
  qc: QuestionCoachingItem,
  focusNextList: Array<{ q?: string; text: string }> = []
): string => {
  const normQ = String(qc.q).replace(/^Q/i, '').trim().toLowerCase();
  const matchFocus = focusNextList.find(f => f.q && String(f.q).replace(/^Q/i, '').trim().toLowerCase() === normQ);
  if (matchFocus && matchFocus.text) {
    return matchFocus.text;
  }
  const rawGap = qc.coaching?.nextLevelGap || qc.coaching?.rationale || '';
  const clean = rawGap.replace(/\*\*/g, '').replace(/\|/g, '•').trim();
  return clean.length > 60 ? clean.slice(0, 60) + '...' : clean;
};

// Formats the rubric stamp into a clean, compact pill text (desktop vs. mobile)
const formatRubricBadge = (
  stamp: string | undefined,
  awarded: number | undefined,
  max: number | undefined,
  isMobile: boolean
): string => {
  const aw = awarded ?? 0;
  const mx = max ?? 0;
  const markPart = mx > 0 ? `${aw}/${mx}` : '';

  if (!stamp) return markPart ? (isMobile ? markPart : `${markPart} marks`) : '';

  // Clean outer brackets and extra whitespaces
  let clean = stamp.replace(/^\[\s*|\s*\]$/g, '').trim();

  // Strip parentheses content like "(Clear, relevant)"
  clean = clean.replace(/\s*\([^)]*\)/g, '').trim();

  // Check if contains pipe separator: "Point-Based | 3/4 marks" or "Level 3 | 9/12 marks"
  if (clean.includes('|')) {
    const [tier, marks] = clean.split(/\s*\|\s*/).map(s => s.trim());
    const cleanMarks = marks ? marks.replace(/\s+marks?/i, '').trim() : markPart;
    if (isMobile) {
      let shortTier = tier;
      if (/^point-based/i.test(tier)) shortTier = 'Pt';
      else if (/^level\s*(\d+)/i.test(tier)) {
        const m = tier.match(/^level\s*(\d+)/i);
        shortTier = m ? `L${m[1]}` : tier;
      }
      return cleanMarks ? `${shortTier} • ${cleanMarks}` : shortTier;
    }
    return cleanMarks ? `${tier} • ${cleanMarks}` : tier;
  }

  // Dual AO pattern: "AO5: 16/24 (L3) + AO6: 12/16 (L3) = 28/40"
  if (/AO5.*AO6/i.test(clean)) {
    if (isMobile) {
      return markPart ? `AO5+6 • ${markPart}` : 'AO5+6';
    }
    return markPart ? `AO5+AO6 • ${markPart}` : 'AO5+AO6';
  }

  // Remove trailing "marks" and replace | with •
  clean = clean.replace(/\s+marks?/i, '').replace(/\s*\|\s*/g, ' • ');

  if (isMobile) {
    clean = clean.replace(/^point-based/i, 'Pt').replace(/^level\s*(\d+)/i, 'L$1');
  }

  return clean;
};

// Aligns badge color with top question ribbon (full mark = green, mid = yellow, low = red)
const getStampScoreColor = (
  awarded: number | undefined,
  max: number | undefined
): 'green' | 'yellow' | 'red' | 'neutral' => {
  if (max === undefined || max === null || max <= 0 || awarded === undefined || awarded === null) {
    return 'neutral';
  }
  if (awarded >= max) return 'green';
  if (awarded === 0) return 'red';
  return 'yellow';
};

// Soft pastel sector colors (adapts via opacity to both light & dark mode)
const SECTOR_COLORS = [
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f97316', // Orange
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#eab308'  // Yellow
];

const TopicRadarChart: React.FC<{ data: RadarPoint[] }> = ({ data }) => {
  const width = 360;
  const height = 310;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 94;
  const levels = [0.25, 0.5, 0.75, 1.0];
  const n = data.length || 6;

  const getPoint = (index: number, ratio: number) => {
    // Start at top (-90 deg)
    const angle = (Math.PI * 2 * index) / n - Math.PI / 2;
    return {
      x: cx + radius * ratio * Math.cos(angle),
      y: cy + radius * ratio * Math.sin(angle),
      angle
    };
  };

  // Sector background wedges (like TMUA radar chart)
  const sectorPaths = useMemo(() => {
    return data.map((_, i) => {
      const nextI = (i + 1) % n;
      const p1 = getPoint(i, 1);
      const p2 = getPoint(nextI, 1);
      return {
        d: `M ${cx} ${cy} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} Z`,
        color: SECTOR_COLORS[i % SECTOR_COLORS.length]
      };
    });
  }, [data, n]);

  // Data polygon points
  const dataPoints = useMemo(() => {
    return data.map((d, i) => {
      const ratio = Math.max(0.08, Math.min(1, (d.score || 0) / 100));
      const pt = getPoint(i, ratio);
      const labelPt = getPoint(i, 1.20);
      return { ...pt, labelX: labelPt.x, labelY: labelPt.y, item: d };
    });
  }, [data, n]);

  const polygonPointsStr = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const hasProvisional = data.some(d => !d.assessed);

  return (
    <div className="tmua-radar-wrapper">
      <div className="tmua-section-label">MASTERY BY TOPIC</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="tmua-radar-svg">
        {/* Subtle colored sector wedges */}
        {sectorPaths.map((s, idx) => (
          <path key={idx} d={s.d} fill={s.color} className="tmua-radar-sector" />
        ))}

        {/* Concentric web polygons */}
        {levels.map((lvl, lIdx) => {
          const pts = data.map((_, i) => {
            const p = getPoint(i, lvl);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          }).join(' ');
          return (
            <polygon
              key={lIdx}
              points={pts}
              fill="none"
              className="tmua-radar-grid-ring"
            />
          );
        })}

        {/* Axis spokes */}
        {data.map((_, i) => {
          const end = getPoint(i, 1);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={end.x.toFixed(1)}
              y2={end.y.toFixed(1)}
              className="tmua-radar-spoke"
            />
          );
        })}

        {/* Filled Mastery Polygon */}
        <polygon
          points={polygonPointsStr}
          className={`tmua-radar-area ${hasProvisional ? 'has-provisional' : ''}`}
        />

        {/* Vertex Dots (Solid for assessed, Hollow for provisional) */}
        {dataPoints.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.item.assessed ? 4 : 3.5}
              className={p.item.assessed ? 'tmua-dot-solid' : 'tmua-dot-hollow'}
            >
              <title>
                {p.item.axis}: {p.item.assessed ? `${p.item.awarded}/${p.item.total} (${p.item.score}%)` : 'Not assessed in this upload (provisional)'}
              </title>
            </circle>
          </g>
        ))}

        {/* Axis Labels */}
        {dataPoints.map((p, i) => {
          const cos = Math.cos(p.angle);
          const textAnchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
          // Split long labels onto 2 lines if needed
          const words = p.item.axis.split(' ');
          const line1 = words.length > 2 ? words.slice(0, 2).join(' ') : p.item.axis;
          const line2 = words.length > 2 ? words.slice(2).join(' ') : '';

          return (
            <text
              key={i}
              x={p.labelX}
              y={p.labelY}
              textAnchor={textAnchor}
              dominantBaseline="middle"
              className={`tmua-radar-label ${p.item.assessed ? 'assessed' : 'provisional'}`}
            >
              <tspan x={p.labelX} dy={line2 ? '-0.4em' : '0'}>{line1}</tspan>
              {line2 && <tspan x={p.labelX} dy="1.1em">{line2}</tspan>}
            </text>
          );
        })}
      </svg>

      <div className="tmua-radar-legend">
        <span className="legend-item">
          <span className="legend-dot solid" /> Assessed
        </span>
        {hasProvisional && (
          <span className="legend-item">
            <span className="legend-dot hollow" /> Provisional
          </span>
        )}
      </div>
    </div>
  );
};

export const PerformanceSummaryPanel: React.FC<PerformanceSummaryPanelProps> = ({
  rawSummary,
  MarkdownMathRenderer,
  onQuestionClick,
  activeQuestionId: propActiveQuestionId
}) => {
  let contextActiveQuestionId: string | null = null;
  try {
    const markingPage = useMarkingPage();
    contextActiveQuestionId = markingPage?.activeQuestionId || null;
  } catch (_) {
    // Safe fallback if rendered outside MarkingPageProvider
  }
  const effectiveActiveQuestionId = propActiveQuestionId ?? contextActiveQuestionId;

  const parsedV2 = useMemo<SummaryV2Payload | null>(() => {
    if (!rawSummary || typeof rawSummary !== 'string') return null;
    const trimmed = rawSummary.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj._type === 'AI_SUMMARY_V2') {
        return obj as SummaryV2Payload;
      }
    } catch (_) {}
    return null;
  }, [rawSummary]);

  // Sort grade boundaries descending (highest grade 9 / A* on the left, matching original database table)
  const sortedBoundariesDesc = useMemo(() => {
    if (!parsedV2?.grading?.boundaries) return [];
    return Object.entries(parsedV2.grading.boundaries)
      .map(([g, mark]) => ({ grade: g, mark: Number(mark) }))
      .filter(b => !isNaN(b.mark))
      .sort((a, b) => b.mark - a.mark);
  }, [parsedV2]);

  // Strategy 1 Initial Default (Single-Expand Accordion)
  const [expandedQuestionKey, setExpandedQuestionKey] = useState<string | null>(() =>
    getDefaultExpandedKey(parsedV2?.questionCoaching || [])
  );

  useEffect(() => {
    if (parsedV2?.questionCoaching && parsedV2.questionCoaching.length > 0) {
      setExpandedQuestionKey(prev => prev ?? getDefaultExpandedKey(parsedV2.questionCoaching!));
    }
  }, [parsedV2]);

  // Sync When User Clicks Top QUESTION BREAKDOWN Ribbon or Focus Next Chips
  useEffect(() => {
    if (!effectiveActiveQuestionId || !parsedV2?.questionCoaching) return;
    const normActive = String(effectiveActiveQuestionId).replace(/^Q/i, '').trim().toLowerCase();
    const match = parsedV2.questionCoaching.find(
      qc => String(qc.q).replace(/^Q/i, '').trim().toLowerCase() === normActive
    );
    if (match) {
      setExpandedQuestionKey(String(match.q));
    }
  }, [effectiveActiveQuestionId, parsedV2]);

  // Fallback for legacy markdown sessions
  if (!parsedV2) {
    return (
      <div className="ai-performance-summary">
        <div className="ai-performance-summary-content">
          <MarkdownMathRenderer
            content={rawSummary}
            className="chat-message-renderer"
            options={{ throwOnError: false, errorColor: '#cc0000' }}
          />
        </div>
        <hr className="summary-separator" />
      </div>
    );
  }

  const { examInfo, score, grading, radar, mastered, focusNext, headline, tooDenseWarning, questionCoaching } = parsedV2;

  const isPastPaperWithBoundaries = sortedBoundariesDesc.length > 0;
  const maxBoundaryMark = sortedBoundariesDesc[0]?.mark || 0;
  const isPartialPaper = isPastPaperWithBoundaries && score.totalMarks > 0 && score.totalMarks < maxBoundaryMark * 0.65;

  let proratedGradeStr: string | null = null;
  if (isPartialPaper) {
    const fullPaperMax = maxBoundaryMark > 45 ? 80 : 100;
    const proratedMark = Math.round((score.percentage / 100) * fullPaperMax);
    const matchedBoundary = sortedBoundariesDesc.find(b => proratedMark >= b.mark);
    if (matchedBoundary) {
      proratedGradeStr = `Grade ${matchedBoundary.grade}`;
    }
  }

  const rawGradeAchieved = grading?.grade || 'N/A';
  const rawPredictedGrade = grading?.predictedGrade || 'N/A';

  const gradeAchieved = isPartialPaper
    ? 'Partial Paper'
    : (rawGradeAchieved || 'N/A');

  const predictedGrade = isPartialPaper
    ? (proratedGradeStr ? `~${proratedGradeStr}` : (rawPredictedGrade && rawPredictedGrade !== 'N/A' && rawPredictedGrade.startsWith('~') ? rawPredictedGrade : 'N/A'))
    : (rawPredictedGrade || 'N/A');

  const hasAchievedGrade = gradeAchieved !== 'N/A' && gradeAchieved !== 'Partial Paper';

  // Compute the next higher grade boundary above score.awardedMarks (lowest b.mark above score.awardedMarks)
  const nextBoundary = (() => {
    if (!sortedBoundariesDesc || sortedBoundariesDesc.length === 0 || !score) return null;
    const higherBoundaries = sortedBoundariesDesc.filter(b => b.mark > score.awardedMarks);
    if (higherBoundaries.length === 0) return null;
    return higherBoundaries[higherBoundaries.length - 1];
  })();

  const scrollToCoachingCard = (qNum: string) => {
    const clean = String(qNum).replace(/^Q/i, '');
    const el = document.getElementById(`coaching-card-q${clean}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  return (
    <div className="tmua-summary-card">
      {/* Header Row */}
      <div className="tmua-summary-header">
        <div className="tmua-summary-title">
          <Sparkles size={15} className="tmua-sparkle-icon" />
          <span>AI PERFORMANCE SUMMARY</span>
        </div>
        {examInfo && examInfo.examBoard && (
          <div className="tmua-exam-pills">
            {examInfo.examBoard && <span className="tmua-pill">{examInfo.examBoard}</span>}
            {examInfo.subject && <span className="tmua-pill">{examInfo.subject}</span>}
            {examInfo.examCode && <span className="tmua-pill strong">{examInfo.examCode}</span>}
            {examInfo.examSeries && <span className="tmua-pill">{examInfo.examSeries}</span>}
            {examInfo.tier && examInfo.tier !== 'N/A' && <span className="tmua-pill">{examInfo.tier}</span>}
            {examInfo.isModified && <span className="tmua-pill modified">Modified</span>}
          </div>
        )}
      </div>

      {tooDenseWarning && (
        <div className="tmua-warning-banner">
          <AlertTriangle size={15} />
          <span>Some dense pages required manual review and were skipped.</span>
        </div>
      )}

      {/* Main 2-Column Body: Left (2/3) Metrics + Right (1/3) Radar */}
      <div className="tmua-summary-grid">
        {/* LEFT COLUMN (~65%) */}
        <div className="tmua-left-col">
          {/* Hero Metric, Progress Bar & Official Past Paper Grade Boundary Table */}
          <div className="tmua-hero-box">
            <div className="tmua-hero-top">
              <div className="tmua-hero-score-group">
                <span className="tmua-hero-pct">{score.percentage}%</span>
                <span className="tmua-hero-Raw">
                  <span className="score-raw-desktop">{score.awardedMarks} / {score.totalMarks} marks</span>
                  <span className="score-raw-mobile">{score.awardedMarks}/{score.totalMarks}</span>
                </span>
              </div>
              <div className="tmua-hero-badges">
                {isPastPaperWithBoundaries && (
                  <div className={`tmua-grade-badge ${!hasAchievedGrade ? 'na' : ''}`}>
                    <span className="pill-text-desktop">
                      {gradeAchieved === 'Partial Paper' ? 'Partial Paper' : `Grade Achieved: ${gradeAchieved}`}
                    </span>
                    <span className="pill-text-mobile">
                      {gradeAchieved === 'Partial Paper' ? 'Partial' : `Grade: ${gradeAchieved}`}
                    </span>
                  </div>
                )}
                {nextBoundary && isPastPaperWithBoundaries && score.totalMarks > 0 && (
                  <div
                    className="tmua-next-grade-pill"
                    title={`${nextBoundary.mark - score.awardedMarks} ${nextBoundary.mark - score.awardedMarks === 1 ? 'mark' : 'marks'} away from Grade ${nextBoundary.grade}`}
                  >
                    <span>🔥</span>
                    <span>
                      {nextBoundary.mark - score.awardedMarks} {nextBoundary.mark - score.awardedMarks === 1 ? 'mark' : 'marks'} to Grade {nextBoundary.grade}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {headline && <p className="tmua-headline-text">{headline}</p>}

            {/* Linear Progress Bar */}
            <div className="tmua-track-container">
              <div className="tmua-track-bar">
                <div
                  className="tmua-track-fill"
                  style={{ width: `${Math.min(100, Math.max(0, score.percentage))}%` }}
                />
                <div
                  className="tmua-track-thumb"
                  style={{ left: `${Math.min(100, Math.max(0, score.percentage))}%` }}
                  title={`${score.awardedMarks}/${score.totalMarks} (${score.percentage}%)`}
                />
              </div>
              <div className="tmua-Scale-labels">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Official Past Paper Grade Boundary Table (Always shown when boundaries exist in DB) */}
            {isPastPaperWithBoundaries && (
              <div className="tmua-grade-table-wrapper">
                <table className="tmua-grade-table">
                  <tbody>
                    <tr>
                      <th>Grade</th>
                      {sortedBoundariesDesc.map((b) => {
                        const isMatch = hasAchievedGrade && String(gradeAchieved) === String(b.grade);
                        return (
                          <td key={b.grade} className={isMatch ? 'highlighted-grade' : ''}>
                            {b.grade}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <th>Mark Required</th>
                      {sortedBoundariesDesc.map((b) => {
                        const isMatch = hasAchievedGrade && String(gradeAchieved) === String(b.grade);
                        return (
                          <td key={b.grade} className={isMatch ? 'highlighted-grade' : ''}>
                            {b.mark}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3 Compact Stat Pills */}
          {isPastPaperWithBoundaries ? (
            <div className="tmua-stat-pills-row">
              <div className="tmua-stat-card">
                <div className="tmua-stat-value">
                  {score.questionsFullMarks} <span className="tmua-stat-sub">/ {score.questionsTotal}</span>
                </div>
                <div className="tmua-stat-label">Full marks questions</div>
              </div>
              <div className="tmua-stat-card">
                <div className="tmua-stat-value">{gradeAchieved}</div>
                <div className="tmua-stat-label">Grade Achieved</div>
              </div>
              <div className="tmua-stat-card">
                <div className="tmua-stat-value">{predictedGrade}</div>
                <div className="tmua-stat-label">Predicted Grade</div>
              </div>
            </div>
          ) : (
            <div className="tmua-stat-pills-row">
              <div className="tmua-stat-card">
                <div className="tmua-stat-value">{score.questionsTotal}</div>
                <div className="tmua-stat-label">Questions marked</div>
              </div>
              <div className="tmua-stat-card">
                <div className="tmua-stat-value">
                  {score.questionsFullMarks} <span className="tmua-stat-sub">/ {score.questionsTotal}</span>
                </div>
                <div className="tmua-stat-label">Full marks</div>
              </div>
              <div className="tmua-stat-card">
                <div className="tmua-stat-value">{score.percentage}%</div>
                <div className="tmua-stat-label">Overall accuracy</div>
              </div>
            </div>
          )}

          {/* Concise Mastered & Focus Next Chips */}
          {(mastered.length > 0 || focusNext.length > 0) && (
            <div className="tmua-insights-box">
              {mastered.length > 0 && (
                <div className="tmua-insight-row">
                  <div className="tmua-insight-heading mastered">
                    <CheckCircle2 size={14} />
                    <span>Strengths</span>
                  </div>
                  <div className="tmua-insight-chips">
                    {mastered.map((m, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="tmua-insight-chip mastered"
                        onClick={() => {
                          if (m.q) {
                            const cleanQ = String(m.q).replace(/^Q/i, '');
                            setExpandedQuestionKey(String(m.q));
                            onQuestionClick?.(cleanQ);
                            scrollToCoachingCard(cleanQ);
                          }
                        }}
                      >
                        {m.q && <span className="chip-q">Q{String(m.q).replace(/^Q/i, '')}</span>}
                        <span>{m.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {focusNext.length > 0 && (
                <div className="tmua-insight-row">
                  <div className="tmua-insight-heading focus">
                    <Target size={14} />
                    <span>Focus Next</span>
                  </div>
                  <div className="tmua-insight-chips">
                    {focusNext.map((f, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="tmua-insight-chip focus"
                        onClick={() => {
                          if (f.q) {
                            const cleanQ = String(f.q).replace(/^Q/i, '');
                            setExpandedQuestionKey(String(f.q));
                            onQuestionClick?.(cleanQ);
                            scrollToCoachingCard(cleanQ);
                          }
                        }}
                      >
                        {f.q && <span className="chip-q">Q{String(f.q).replace(/^Q/i, '')}</span>}
                        <span>{f.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (~35%): Radar Chart */}
        {radar && radar.length >= 3 && (
          <div className="tmua-right-col">
            <TopicRadarChart data={radar} />
          </div>
        )}
      </div>

      {/* 3-Part Examiner Coaching Block for Level-of-Response Questions */}
      {questionCoaching && questionCoaching.length > 0 && (
        <div className="tmua-coaching-section">
          <div className="tmua-section-label">
            EXAMINER LEVEL &amp; GRADE-BOOSTING COACHING
          </div>
          {questionCoaching.map((qc, idx) => {
            const cardKey = String(qc.q || idx);
            const isCardExpanded = expandedQuestionKey === cardKey;
            const cleanQ = String(qc.q).replace(/^Q/i, '');
            const cardId = `coaching-card-q${cleanQ}`;
            const scoreColor = getStampScoreColor(qc.awardedMarks, qc.maxMarks);

            const handleCardHeaderClick = () => {
              if (isCardExpanded) {
                setExpandedQuestionKey(null);
              } else {
                setExpandedQuestionKey(cardKey);
                onQuestionClick?.(cleanQ);
                scrollToCoachingCard(cleanQ);
              }
            };

            const previewText = getCardPreviewText(qc, focusNext);

            return (
              <div
                key={idx}
                id={cardId}
                className={`coaching-card ${isCardExpanded ? 'expanded' : ''}`}
              >
                <div
                  className="coaching-card-header"
                  onClick={handleCardHeaderClick}
                >
                  <div className="coaching-card-header-left">
                    {isCardExpanded ? (
                      <ChevronUp size={16} className="coaching-card-chevron" />
                    ) : (
                      <ChevronDown size={16} className="coaching-card-chevron" />
                    )}
                    <span className="coaching-card-q-title">
                      Question {qc.q}
                    </span>
                    {!isCardExpanded && (
                      <span className="coaching-card-preview" title={previewText}>
                        — {previewText}
                      </span>
                    )}
                  </div>
                  <span className={`coaching-stamp-badge score-${scoreColor}`}>
                    <span className="badge-text-desktop">
                      {formatRubricBadge(qc.rubricStamp, qc.awardedMarks, qc.maxMarks, false)}
                    </span>
                    <span className="badge-text-mobile">
                      {formatRubricBadge(qc.rubricStamp, qc.awardedMarks, qc.maxMarks, true)}
                    </span>
                  </span>
                </div>

                {isCardExpanded && (
                  <div className="coaching-card-body">
                    {/* 2-Column Grid */}
                    <div className="coaching-grid">
                      {/* Left Box (✅ What Worked) */}
                      <div className="coaching-box coaching-what-worked">
                        <div className="coaching-box-header what-worked">
                          <span>✅</span>
                          <span>What Worked</span>
                        </div>
                        {qc.coaching?.rationale ? (
                          <ul className="coaching-bullet-list">
                            {parseCoachingBullets(qc.coaching.rationale).map((bullet, bIdx) => (
                              <li key={bIdx}>
                                {renderBoldText(bullet)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="coaching-empty-note">No rationale provided.</span>
                        )}
                      </div>

                      {/* Right Box (🎯 How to Reach Next Level) */}
                      <div className="coaching-box coaching-next-level">
                        <div className="coaching-box-header next-level">
                          <span>🎯</span>
                          <span>How to Reach Next Level</span>
                        </div>
                        {qc.coaching?.nextLevelGap ? (
                          <ul className="coaching-bullet-list">
                            {parseCoachingBullets(qc.coaching.nextLevelGap).map((bullet, bIdx) => (
                              <li key={bIdx}>
                                {renderBoldText(bullet)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="coaching-empty-note">Full marks achieved.</span>
                        )}
                      </div>
                    </div>

                    {/* Compact Grade 9 Upgrade Rewrite Box */}
                    {qc.coaching?.upgradeRewrite?.originalQuote &&
                      qc.coaching?.upgradeRewrite?.upgradedVersion &&
                      (qc.maxMarks ? qc.maxMarks > 4 : true) && (
                        <div className="coaching-rewrite-box">
                          <div className="coaching-rewrite-title">
                            Grade 9 Analytical Upgrade Rewrite
                          </div>
                          <div>
                            <span className="coaching-rewrite-label user-line">Your Line: </span>
                            <em className="coaching-rewrite-quote">&ldquo;{qc.coaching.upgradeRewrite.originalQuote}&rdquo;</em>
                          </div>
                          <div>
                            <span className="coaching-rewrite-label upgrade">Grade 9 Upgrade: </span>
                            <span>
                              &ldquo;{renderBoldText(qc.coaching.upgradeRewrite.upgradedVersion, true)}&rdquo;
                            </span>
                          </div>
                          {qc.coaching.upgradeRewrite.explanation && (
                            <div className="coaching-rewrite-explanation">
                              💡 <strong>Why this scores higher: </strong>
                              <span>{qc.coaching.upgradeRewrite.explanation}</span>
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PerformanceSummaryPanel;
