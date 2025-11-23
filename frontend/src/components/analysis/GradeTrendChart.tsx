/**
 * Grade Trend Chart Component
 * Displays a line chart showing grade progression across exam series or marking attempts
 */

import React, { useState, useMemo } from 'react';
import { Calendar, TrendingUp } from 'lucide-react';
import type { GroupedMarkingResult } from './markingResultsUtils';
import { extractPaperCode } from './markingResultsUtils';
import './GradeTrendChart.css';

interface PaperCodeSetGroup {
  paperCodeSet: { tier: string; paperCodes: string[] };
  grouped: GroupedMarkingResult[];
}

interface GradeTrendChartProps {
  allGroupedResults: PaperCodeSetGroup[];
}

interface ChartDataPoint {
  examSeries?: string;
  attemptNumber?: number;
  paperCode: string;
  grade: number;
  date: Date;
}

/**
 * Parse exam series string to Date (e.g., "June 2024" -> Date)
 */
function parseExamSeriesDate(examSeries: string): Date {
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

const GradeTrendChart: React.FC<GradeTrendChartProps> = ({
  allGroupedResults
}) => {
  const [activeTab, setActiveTab] = useState<'examSeries' | 'attempts'>('examSeries');

  // Get unique exam series for x-axis (from all paper code sets)
  // Limit to latest 10 exam series
  const examSeriesList = useMemo(() => {
    const series = new Set<string>();
    allGroupedResults.forEach(({ grouped }) => {
      grouped.forEach(group => series.add(group.examSeries));
    });
    const sorted = Array.from(series).sort((a, b) => {
      const dateA = parseExamSeriesDate(a);
      const dateB = parseExamSeriesDate(b);
      return dateB.getTime() - dateA.getTime(); // Sort newest first
    });
    // Take latest 10, then sort oldest to newest for display
    return sorted.slice(0, 10).reverse();
  }, [allGroupedResults]);

  // Prepare chart data for Grade vs Exam Series view
  const chartDataExamSeries = useMemo(() => {
    if (!allGroupedResults || allGroupedResults.length === 0) return [];

    const dataPoints: ChartDataPoint[] = [];

    // Process each paper code set
    allGroupedResults.forEach(({ paperCodeSet, grouped }) => {
      const tierLabel = paperCodeSet.tier ? ` (${paperCodeSet.tier})` : '';
      
      // Process each group in this paper code set
      grouped.forEach(group => {
        group.examCodeGroups.forEach(examCodeGroup => {
          if (examCodeGroup.records.length === 0) return;

          const paperCode = extractPaperCode(examCodeGroup.examCode || '');
          if (!paperCode) return;

          // Calculate average grade for this paper code in this exam series
          const grades = examCodeGroup.records
            .map(r => r.grade)
            .filter(g => g !== undefined && g !== null)
            .map(g => {
              // Convert grade to number (e.g., "9" -> 9, "A*" -> 10, "A" -> 9, etc.)
              if (typeof g === 'string') {
                const num = parseInt(g, 10);
                if (!isNaN(num)) return num;
                // Handle letter grades (A* = 10, A = 9, B = 8, etc.)
                if (g === 'A*') return 10;
                if (g === 'A') return 9;
                if (g === 'B') return 8;
                if (g === 'C') return 7;
                if (g === 'D') return 6;
                if (g === 'E') return 5;
                if (g === 'F') return 4;
                if (g === 'G') return 3;
                if (g === 'U') return 1;
              }
              return null;
            })
            .filter((g): g is number => g !== null);

          if (grades.length > 0) {
            const avgGrade = grades.reduce((sum, g) => sum + g, 0) / grades.length;
            const date = parseExamSeriesDate(group.examSeries);

            // Include tier label in paper code for distinction
            const paperCodeLabel = `${paperCode}${tierLabel}`;
            
            dataPoints.push({
              examSeries: group.examSeries,
              paperCode: paperCodeLabel,
              grade: Math.round(avgGrade * 10) / 10, // Round to 1 decimal
              date
            });
          }
        });
      });
    });

    // Sort by date
    const allPoints = dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Filter to only include latest 10 exam series
    const latestSeries = new Set(examSeriesList);
    return allPoints.filter(point => 
      point.examSeries && latestSeries.has(point.examSeries)
    );
  }, [allGroupedResults, examSeriesList]);

  // Prepare chart data for Grade vs Marking Attempts view
  const chartDataAttempts = useMemo(() => {
    if (!allGroupedResults || allGroupedResults.length === 0) return [];

    const dataPoints: ChartDataPoint[] = [];

    // Collect all records across all paper code sets and sort by timestamp
    const allRecords: Array<{
      paperCode: string;
      tierLabel: string;
      grade: number;
      timestamp: string;
    }> = [];

    allGroupedResults.forEach(({ paperCodeSet, grouped }) => {
      const tierLabel = paperCodeSet.tier ? ` (${paperCodeSet.tier})` : '';
      
      grouped.forEach(group => {
        group.examCodeGroups.forEach(examCodeGroup => {
          if (examCodeGroup.records.length === 0) return;

          const paperCode = extractPaperCode(examCodeGroup.examCode || '');
          if (!paperCode) return;

          examCodeGroup.records.forEach(record => {
            const grade = record.grade;
            if (grade !== undefined && grade !== null) {
              let gradeNum: number | null = null;
              if (typeof grade === 'string') {
                const num = parseInt(grade, 10);
                if (!isNaN(num)) {
                  gradeNum = num;
                } else {
                  // Handle letter grades
                  if (grade === 'A*') gradeNum = 10;
                  else if (grade === 'A') gradeNum = 9;
                  else if (grade === 'B') gradeNum = 8;
                  else if (grade === 'C') gradeNum = 7;
                  else if (grade === 'D') gradeNum = 6;
                  else if (grade === 'E') gradeNum = 5;
                  else if (grade === 'F') gradeNum = 4;
                  else if (grade === 'G') gradeNum = 3;
                  else if (grade === 'U') gradeNum = 1;
                }
              }

              if (gradeNum !== null) {
                allRecords.push({
                  paperCode: `${paperCode}${tierLabel}`,
                  tierLabel,
                  grade: gradeNum,
                  timestamp: record.timestamp
                });
              }
            }
          });
        });
      });
    });

    // Sort all records by timestamp (oldest first)
    allRecords.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Group by paper code and assign attempt numbers per paper code
    const paperCodeGroups = new Map<string, Array<{ grade: number; timestamp: string }>>();
    allRecords.forEach(record => {
      if (!paperCodeGroups.has(record.paperCode)) {
        paperCodeGroups.set(record.paperCode, []);
      }
      paperCodeGroups.get(record.paperCode)!.push({
        grade: record.grade,
        timestamp: record.timestamp
      });
    });

    // Create data points with attempt numbers
    // Limit to latest 10 attempts per paper code
    paperCodeGroups.forEach((records, paperCode) => {
      // Take latest 10 attempts (most recent)
      const latestRecords = records.slice(-10);
      latestRecords.forEach((record, index) => {
        // Recalculate attempt number based on position in latest 10
        // If we have 15 attempts total, and we're showing last 10, 
        // the first of the last 10 should be attempt 6, not attempt 1
        const totalAttempts = records.length;
        const startAttemptNumber = Math.max(1, totalAttempts - 9);
        const attemptNumber = startAttemptNumber + index;
        const avgGrade = record.grade;

        dataPoints.push({
          attemptNumber,
          paperCode,
          grade: Math.round(avgGrade * 10) / 10,
          date: new Date(record.timestamp)
        });
      });
    });

    // Sort by attempt number
    const allPoints = dataPoints.sort((a, b) => 
      (a.attemptNumber || 0) - (b.attemptNumber || 0)
    );

    // Get unique attempt numbers across all paper codes
    const attemptNumbers = new Set<number>();
    allPoints.forEach(point => {
      if (point.attemptNumber !== undefined) {
        attemptNumbers.add(point.attemptNumber);
      }
    });
    const sortedAttempts = Array.from(attemptNumbers).sort((a, b) => a - b);
    
    // Limit to latest 10 attempt numbers overall
    const latest10AttemptNumbers = sortedAttempts.slice(-10);
    const latest10AttemptSet = new Set(latest10AttemptNumbers);

    // Filter to only include data points with latest 10 attempt numbers
    return allPoints.filter(point => 
      point.attemptNumber !== undefined && latest10AttemptSet.has(point.attemptNumber)
    );
  }, [allGroupedResults]);

  // Use appropriate chart data based on active tab
  const chartData = activeTab === 'examSeries' ? chartDataExamSeries : chartDataAttempts;

  // Get unique attempt numbers for x-axis
  // Limit to latest 10 attempts
  const attemptNumbersList = useMemo(() => {
    const attempts = new Set<number>();
    chartDataAttempts.forEach(point => {
      if (point.attemptNumber !== undefined) {
        attempts.add(point.attemptNumber);
      }
    });
    const sorted = Array.from(attempts).sort((a, b) => a - b);
    // Take latest 10 attempts
    return sorted.slice(-10);
  }, [chartDataAttempts]);

  // Calculate chart dimensions
  const chartWidth = 400;
  const chartHeight = 300;
  const padding = { top: 40, right: 40, bottom: 40, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Grade range (1-10 for GCSE, adjust as needed)
  const minGrade = 1;
  const maxGrade = 10;

  // Get unique paper codes for legend
  const paperCodes = useMemo(() => {
    const codes = new Set<string>();
    chartData.forEach(point => {
      if (point.paperCode !== 'Total') {
        codes.add(point.paperCode);
      }
    });
    return Array.from(codes).sort();
  }, [chartData]);

  // Helper to convert grade to y coordinate
  const gradeToY = (grade: number): number => {
    const normalized = (grade - minGrade) / (maxGrade - minGrade);
    return padding.top + plotHeight - (normalized * plotHeight);
  };

  // Helper to convert exam series index to x coordinate
  const seriesToX = (index: number): number => {
    const list = activeTab === 'examSeries' ? examSeriesList : attemptNumbersList;
    if (list.length === 1) return padding.left + plotWidth / 2;
    return padding.left + (index / (list.length - 1)) * plotWidth;
  };

  // Helper to convert attempt number to x coordinate
  const attemptToX = (attemptNumber: number): number => {
    if (attemptNumbersList.length === 1) return padding.left + plotWidth / 2;
    const index = attemptNumbersList.indexOf(attemptNumber);
    return padding.left + (index / (attemptNumbersList.length - 1)) * plotWidth;
  };

  // Generate line paths for each paper code
  const generateLinePath = (paperCode: string): string => {
    const points = chartData
      .filter(p => p.paperCode === paperCode)
      .sort((a, b) => {
        if (activeTab === 'examSeries') {
          return a.date.getTime() - b.date.getTime();
        } else {
          return (a.attemptNumber || 0) - (b.attemptNumber || 0);
        }
      });

    if (points.length === 0) return '';

    const pathParts: string[] = [];
    points.forEach((point, index) => {
      let x: number;
      if (activeTab === 'examSeries') {
        x = seriesToX(examSeriesList.indexOf(point.examSeries || ''));
      } else {
        x = attemptToX(point.attemptNumber || 0);
      }
      const y = gradeToY(point.grade);
      if (index === 0) {
        pathParts.push(`M ${x} ${y}`);
      } else {
        pathParts.push(`L ${x} ${y}`);
      }
    });

    return pathParts.join(' ');
  };

  // Generate circle points for each data point
  const generateCircles = (paperCode: string) => {
    const points = chartData
      .filter(p => p.paperCode === paperCode)
      .sort((a, b) => {
        if (activeTab === 'examSeries') {
          return a.date.getTime() - b.date.getTime();
        } else {
          return (a.attemptNumber || 0) - (b.attemptNumber || 0);
        }
      });

    return points.map((point, index) => {
      let x: number;
      if (activeTab === 'examSeries') {
        x = seriesToX(examSeriesList.indexOf(point.examSeries || ''));
      } else {
        x = attemptToX(point.attemptNumber || 0);
      }
      const y = gradeToY(point.grade);
      return { 
        x, 
        y, 
        grade: point.grade, 
        examSeries: point.examSeries,
        attemptNumber: point.attemptNumber
      };
    });
  };

  // Color palette for lines
  const colors = [
    '#3b82f6', // Blue
    '#10b981', // Green
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#8b5cf6', // Purple
    '#ec4899', // Pink
  ];

  const getColor = (paperCode: string, index: number): string => {
    return colors[index % colors.length];
  };

  // Determine if we have data for the active tab
  const hasData = activeTab === 'examSeries' 
    ? (chartDataExamSeries.length > 0 && examSeriesList.length > 0)
    : (chartDataAttempts.length > 0 && attemptNumbersList.length > 0);

  if (!hasData) {
    return (
      <div className="grade-trend-chart-container">
        <div className="chart-tabs">
          <button
            className={`chart-tab ${activeTab === 'examSeries' ? 'active' : ''}`}
            onClick={() => setActiveTab('examSeries')}
          >
            <Calendar size={14} />
            <span>Grade vs Exam Series</span>
          </button>
          <button
            className={`chart-tab ${activeTab === 'attempts' ? 'active' : ''}`}
            onClick={() => setActiveTab('attempts')}
          >
            <TrendingUp size={14} />
            <span>Grade vs Marking Attempts</span>
          </button>
        </div>
        <div className="chart-empty">
          <p>No data available for chart</p>
        </div>
      </div>
    );
  }

  // Get x-axis labels based on active tab
  const xAxisLabels = activeTab === 'examSeries' ? examSeriesList : attemptNumbersList.map(n => `${n}`);

  return (
    <div className="grade-trend-chart-container">
      <div className="chart-tabs">
        <button
          className={`chart-tab ${activeTab === 'examSeries' ? 'active' : ''}`}
          onClick={() => setActiveTab('examSeries')}
        >
          <Calendar size={14} />
          <span>Grade vs Exam Series</span>
        </button>
        <button
          className={`chart-tab ${activeTab === 'attempts' ? 'active' : ''}`}
          onClick={() => setActiveTab('attempts')}
        >
          <TrendingUp size={14} />
          <span>Grade vs Marking Attempts</span>
        </button>
      </div>
      <div className="chart-wrapper">
        <svg width={chartWidth} height={chartHeight} className="chart-svg">
          {/* Grid lines */}
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(grade => {
            const y = gradeToY(grade);
            return (
              <g key={grade}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + plotWidth}
                  y2={y}
                  stroke="var(--border-main)"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                  opacity="0.3"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="var(--text-tertiary)"
                >
                  {grade}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {xAxisLabels.map((label, index) => {
            const x = seriesToX(index);
            return (
              <text
                key={label}
                x={x}
                y={chartHeight - padding.bottom + 20}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-tertiary)"
              >
                {label}
              </text>
            );
          })}

          {/* X-axis label */}
          {activeTab === 'attempts' && (
            <text
              x={padding.left + plotWidth / 2}
              y={chartHeight - padding.bottom + 35}
              textAnchor="middle"
              fontSize="12"
              fill="var(--text-secondary)"
            >
              Attempts
            </text>
          )}

          {/* Y-axis label */}
          <text
            x={padding.left - 30}
            y={padding.top + plotHeight / 2}
            textAnchor="middle"
            fontSize="12"
            fill="var(--text-secondary)"
            transform={`rotate(-90 ${padding.left - 30} ${padding.top + plotHeight / 2})`}
          >
            Grade
          </text>

          {/* Draw lines for each paper code */}
          {paperCodes.map((paperCode, index) => {
            const path = generateLinePath(paperCode);
            const circles = generateCircles(paperCode);
            const color = getColor(paperCode, index);

            return (
              <g key={paperCode}>
                {/* Line */}
                {path && (
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                  />
                )}
                {/* Circles */}
                {circles.map((circle, circleIndex) => (
                  <circle
                    key={`${paperCode}-${circleIndex}`}
                    cx={circle.x}
                    cy={circle.y}
                    r={4}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="chart-legend">
        {paperCodes.map((paperCode, index) => (
          <div key={paperCode} className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: getColor(paperCode, index) }}
            />
            <span className="legend-label">{paperCode}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GradeTrendChart;

