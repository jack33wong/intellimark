import React, { useMemo, useState, useEffect } from 'react';
import { CheckCircle2, Target, Sparkles, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

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
}

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
  const size = 250;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 78;
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
      const labelPt = getPoint(i, 1.27);
      return { ...pt, labelX: labelPt.x, labelY: labelPt.y, item: d };
    });
  }, [data, n]);

  const polygonPointsStr = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const hasProvisional = data.some(d => !d.assessed);

  return (
    <div className="tmua-radar-wrapper">
      <div className="tmua-section-label">MASTERY BY TOPIC</div>
      <svg viewBox={`0 0 ${size} ${size}`} className="tmua-radar-svg">
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
  onQuestionClick
}) => {
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

  // Card collapse/expand state (Default: questions with lost marks expanded, or first 2 if 100%)
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    const qcList = parsedV2?.questionCoaching || [];
    const anyLostMarks = qcList.some(qc => (qc.maxMarks ?? 0) > 0 && (qc.awardedMarks ?? 0) < qc.maxMarks);
    qcList.forEach((qc, idx) => {
      const key = qc.q || String(idx);
      if (anyLostMarks) {
        initial[key] = (qc.maxMarks ?? 0) > 0 && (qc.awardedMarks ?? 0) < qc.maxMarks;
      } else {
        initial[key] = idx < 2;
      }
    });
    return initial;
  });

  useEffect(() => {
    const nextState: Record<string, boolean> = {};
    const qcList = parsedV2?.questionCoaching || [];
    const anyLostMarks = qcList.some(qc => (qc.maxMarks ?? 0) > 0 && (qc.awardedMarks ?? 0) < qc.maxMarks);
    qcList.forEach((qc, idx) => {
      const key = qc.q || String(idx);
      if (anyLostMarks) {
        nextState[key] = (qc.maxMarks ?? 0) > 0 && (qc.awardedMarks ?? 0) < qc.maxMarks;
      } else {
        nextState[key] = idx < 2;
      }
    });
    setExpandedCards(nextState);
  }, [parsedV2]);

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

  const toggleCard = (key: string) => {
    setExpandedCards(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

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
                  {score.awardedMarks} / {score.totalMarks} marks
                </span>
              </div>
              {isPastPaperWithBoundaries && (
                <div className={`tmua-grade-badge ${!hasAchievedGrade ? 'na' : ''}`}>
                  {gradeAchieved === 'Partial Paper' ? 'Partial Paper' : `Grade Achieved: ${gradeAchieved}`}
                </div>
              )}
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
                        onClick={() => m.q && onQuestionClick?.(String(m.q).replace(/^Q/i, ''))}
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
                        onClick={() => f.q && onQuestionClick?.(String(f.q).replace(/^Q/i, ''))}
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
        <div
          className="tmua-coaching-section"
          style={{
            marginTop: '14px',
            paddingTop: '14px',
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div className="tmua-section-label" style={{ marginBottom: '2px' }}>
            EXAMINER LEVEL &amp; GRADE-BOOSTING COACHING
          </div>
          {questionCoaching.map((qc, idx) => {
            const cardKey = qc.q || String(idx);
            const isCardExpanded = expandedCards[cardKey] ?? false;
            const ratio = qc.maxMarks > 0 ? (qc.awardedMarks ?? 0) / qc.maxMarks : 0;
            const isLevel4 = (qc.awardedLevel ?? 0) >= 4 || ((qc.awardedLevel ?? 0) === 0 && ratio >= 0.80);
            const isLevel3 = (qc.awardedLevel ?? 0) === 3 || ((qc.awardedLevel ?? 0) === 0 && ratio >= 0.55 && ratio < 0.80);
            const badgeStyle = isLevel4
              ? { background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.35)' }
              : isLevel3
                ? { background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', border: '1px solid rgba(139, 92, 246, 0.35)' }
                : { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.35)' };

            return (
              <div
                key={idx}
                style={{
                  borderRadius: '10px',
                  border: '1px solid rgba(148, 163, 184, 0.24)',
                  background: 'rgba(15, 23, 42, 0.03)',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div
                  onClick={() => toggleCard(cardKey)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isCardExpanded ? (
                      <ChevronUp size={16} style={{ color: 'var(--text-muted, #94a3b8)' }} />
                    ) : (
                      <ChevronDown size={16} style={{ color: 'var(--text-muted, #94a3b8)' }} />
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (qc.q && onQuestionClick) {
                          onQuestionClick(String(qc.q).replace(/^Q/i, ''));
                        } else {
                          toggleCard(cardKey);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: onQuestionClick ? 'pointer' : 'default',
                        fontWeight: 700,
                        fontSize: '0.92rem',
                        color: 'inherit'
                      }}
                    >
                      Question {qc.q}
                    </button>
                    {!isCardExpanded && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)', fontWeight: 500 }}>
                        — Click to view feedback
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: '999px',
                      ...badgeStyle
                    }}
                  >
                    {qc.rubricStamp}
                  </span>
                </div>

                {isCardExpanded && (
                  <>
                    {qc.coaching?.rationale && (
                      <div style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>
                        <strong style={{ color: '#059669' }}>Why This Level Was Awarded: </strong>
                        <span>{qc.coaching.rationale}</span>
                      </div>
                    )}

                    {qc.coaching?.nextLevelGap && (
                      <div style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>
                        <strong style={{ color: '#d97706' }}>How to Reach the Next Level: </strong>
                        <span>{qc.coaching.nextLevelGap}</span>
                      </div>
                    )}

                    {qc.coaching?.upgradeRewrite?.originalQuote &&
                      qc.coaching?.upgradeRewrite?.upgradedVersion &&
                      (qc.maxMarks ? qc.maxMarks > 4 : true) && (
                        <div
                          style={{
                            marginTop: '4px',
                            padding: '9px 11px',
                            borderRadius: '8px',
                            background: 'rgba(59, 130, 246, 0.06)',
                            borderLeft: '3px solid #3b82f6',
                            fontSize: '0.82rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px'
                          }}
                        >
                          <div style={{ fontWeight: 700, color: '#2563eb' }}>Concrete Upgrade Rewrite</div>
                          <div>
                            <span style={{ opacity: 0.75, fontWeight: 600 }}>Your Sentence: </span>
                            <em>&ldquo;{qc.coaching.upgradeRewrite.originalQuote}&rdquo;</em>
                          </div>
                          <div>
                            <span style={{ color: '#059669', fontWeight: 600 }}>Top-Band Upgrade: </span>
                            <span>&ldquo;{qc.coaching.upgradeRewrite.upgradedVersion}&rdquo;</span>
                          </div>
                          {qc.coaching.upgradeRewrite.explanation && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #94a3b8)', marginTop: '2px' }}>
                              💡 <strong>Why this scores higher: </strong>
                              <span>{qc.coaching.upgradeRewrite.explanation}</span>
                            </div>
                          )}
                        </div>
                      )}
                  </>
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
