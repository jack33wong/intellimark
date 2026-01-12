import React, { useMemo } from 'react';
import '../marking/YourWork.css';

interface YourWorkSectionProps {
    content: string;
    MarkdownMathRenderer?: React.ElementType;
}

interface YourWorkRow {
    qNum: string;
    subLabel: string; // formatted: "a i)"
    studentWork: string;
    annotationMarks: string; // "[B1]"
    annotationReason: string; // "Correct..."
}

/**
 * Parsers helper to split content string into work, marks, and reason
 */
const parseRowContent = (text: string): { work: string, marks: string, reason: string } => {
    let studentWork = text;
    let annotation = '';

    // 1. Explicit separator
    if (text.includes(' -- ')) {
        const parts = text.split(' -- ');
        studentWork = parts[0];
        annotation = parts.slice(1).join(' -- ');
    } else {
        // 2. Pattern match: Space + Codes + Hyphen
        const markMatch = text.match(/\s+((?:[A-Z]\d+\s*)+)\s-\s/);
        if (markMatch && markMatch.index !== undefined) {
            studentWork = text.substring(0, markMatch.index);
            annotation = text.substring(markMatch.index).trim();
        }
    }

    // 3. Extract Marks and Reason
    let marks = '';
    let reason = annotation;

    // Clean up annotation first
    const cleanAnno = annotation.replace(/^-\s*/, '').trim();

    // Check for marks at start
    const marksMatch = cleanAnno.match(/^((?:\[?[A-Z]\d+\]?\s*)+)(?:-|)(.*)$/);
    if (marksMatch) {
        const rawMarks = marksMatch[1];
        let rawReason = marksMatch[2].trim();

        // DEDUPLICATION: Remove accidental trailing markers like "-- P1 - Reason" inside the reason itself
        // if rawReason contains "-- [MARKS] - ", strip that suffix to avoid messy duplicate echoes
        rawReason = rawReason.split(' -- ')[0].trim();

        // Format marks: Ensure brackets [M0] [A0]
        marks = rawMarks.trim().split(/\s+/).map(m => {
            const inner = m.replace(/[\[\]]/g, ''); // remove existing brackets
            return `[${inner}]`;
        }).join(' ');

        reason = rawReason;
    }

    // SANITIZATION: Strip trailing \$ which often leak from OCR (keep balanced $)
    studentWork = studentWork.replace(/\\\$$/, '').trim();
    reason = reason.replace(/\\\$$/, '').trim();

    return { work: studentWork, marks, reason };
};

const sanitizeStudentWork = (text: string) => {
    if (!text) return '';
    // Remove common OCR artifacts
    let cleaned = text.replace(/\\ /g, ' ').replace(/&/g, '').trim();
    return cleaned;
};

const WorkContent = ({ content, MarkdownMathRenderer, showBullet }: { content: string, MarkdownMathRenderer?: any, showBullet: boolean }) => {
    const isDrawing = content.includes('[DRAWING]');
    const [expanded, setExpanded] = React.useState(false);

    if (isDrawing) {
        // [DRAWING] Visual styling
        const cleanContent = content.replace('[DRAWING]', '').trim();

        return (
            <div
                className={`yw-col-work ${!showBullet ? 'yw-no-bullet' : ''} yw-drawing-container ${expanded ? 'expanded' : ''}`}
                onClick={() => setExpanded(!expanded)}
                title={expanded ? "Click to collapse" : "Click to expand drawing description"}
            >
                <span className="yw-drawing-badge">DRAWING</span>
                <span className="yw-drawing-text">
                    {cleanContent}
                </span>
            </div>
        );
    }

    return (
        <div className={`yw-col-work ${!showBullet ? 'yw-no-bullet' : ''}`}>
            {MarkdownMathRenderer ? (
                <MarkdownMathRenderer
                    content={content}
                    className="yw-math-renderer"
                    isYourWork={true}
                />
            ) : (
                <span dangerouslySetInnerHTML={{ __html: content || '&nbsp;' }} />
            )}
        </div>
    );
};

export default function YourWorkSection({ content, MarkdownMathRenderer }: YourWorkSectionProps) {
    const rows = useMemo(() => {
        if (!content) return [];
        const match = content.match(/:::your-work\n([\s\S]*?)\n:::/);
        if (!match) return [];

        const lines = match[1].split('\n');
        const parsedRows: YourWorkRow[] = [];

        let currentQNum = '';
        let pendingRowIndex = -1;

        lines.forEach(line => {
            let text = line.replace(/^\t+/, '').replace(/\*\*(.*?)\*\*/g, '$1').trim();
            if (!text) return;
            if (text.startsWith('YOUR WORK:')) return;

            // 1. Question Number Header (e.g. "2")
            if (/^\d+$/.test(text)) {
                currentQNum = text;
                return;
            }

            // 2. Sub-Question Label (e.g. "ai)", "a)", "3)")
            // Regex to capture label and remainder
            const labelMatch = text.match(/^([a-z0-9]+[ivx]*)\)\s*(.*)$/i);

            if (labelMatch) {
                const rawLabel = labelMatch[1];
                let remainder = labelMatch[2];

                // Format Label: "ai" -> "a i"
                // Heuristic: If starts with letter, ends with roman numerals (ii/iii/iv...)
                let formattedLabel = rawLabel;
                // Regex: Single letter (a-z) followed by roman numerals
                const subMatch = rawLabel.match(/^([a-z])([ivx]+)$/i);
                if (subMatch) {
                    formattedLabel = `${subMatch[1]} ${subMatch[2]}`;
                }
                formattedLabel += ')';

                const { work, marks, reason } = parseRowContent(remainder);

                parsedRows.push({
                    qNum: currentQNum,
                    subLabel: formattedLabel,
                    studentWork: sanitizeStudentWork(work),
                    annotationMarks: marks,
                    annotationReason: reason
                });

                // QNum consumed for this block
                currentQNum = '';
                pendingRowIndex = parsedRows.length - 1;
                return;
            }

            // 3. Sub-Question Label alternative "a)" (covered above mostly) or "a ii)" (with space)
            const labelSpaceMatch = text.match(/^([a-z]\s+[ivx]+)\)\s*(.*)$/i);
            if (labelSpaceMatch) {
                const rawLabel = labelSpaceMatch[1]; // "a ii"
                let remainder = labelSpaceMatch[2];
                const { work, marks, reason } = parseRowContent(remainder);
                parsedRows.push({
                    qNum: currentQNum,
                    subLabel: rawLabel + ')',
                    studentWork: sanitizeStudentWork(work),
                    annotationMarks: marks,
                    annotationReason: reason
                });
                currentQNum = '';
                pendingRowIndex = parsedRows.length - 1;
                return;
            }

            // 4. Content Line (No label)
            if (pendingRowIndex !== -1) {
                const prev = parsedRows[pendingRowIndex];

                // If previous row is "complete" (has annotations), we assume this new line is a NEW step
                // unless it clearly looks like a reasoning continuation (no marks, starts with lowercase? hard to tell).
                // Given the user request "new line and bullet point", we favor splitting.
                if (prev.annotationMarks || prev.annotationReason) {
                    // Start new row
                    const { work, marks, reason } = parseRowContent(text);
                    parsedRows.push({
                        qNum: currentQNum, // usually empty if consumed similar to above
                        subLabel: '', // Implicit -> Bullet
                        studentWork: sanitizeStudentWork(work),
                        annotationMarks: marks,
                        annotationReason: reason
                    });
                    currentQNum = '';
                    pendingRowIndex = parsedRows.length - 1;
                } else {
                    // Previous row has Work but NO annotations yet.
                    // Try to attach this line as the annotation part?
                    // Or append to work?

                    // If this text LOOKS like annotation (starts with marks or separator):
                    const potentialParse = parseRowContent(text);
                    if (potentialParse.marks || text.trim().startsWith('--')) {
                        // It completes the previous row
                        // We merge content carefully
                        // If text is " -- M0...", parseRowContent handles it.
                        // But parseRowContent logic assumes "Work -- Marks".
                        // If text is JUST " -- M0", work is empty string.

                        const { work, marks, reason } = parseRowContent(text);
                        // If 'work' is empty or just separator, we just add marks/reason to prev
                        if (!work && (marks || reason)) {
                            prev.annotationMarks = marks;
                            prev.annotationReason = reason;
                        } else {
                            // It has 'work' part too? e.g. "more work -- M0"
                            // Append work, set marks
                            if (work) prev.studentWork += ` ${sanitizeStudentWork(work)}`;
                            prev.annotationMarks = marks;
                            prev.annotationReason = reason;
                        }
                    } else {
                        // Just more work content?
                        prev.studentWork += ` ${sanitizeStudentWork(text)}`;
                    }
                }
            } else {
                // Orphan content (e.g. QNum provided but no sub-label line yet? Or just content)
                // If currentQNum exists, create row with empty subLabel
                const { work, marks, reason } = parseRowContent(text);
                parsedRows.push({
                    qNum: currentQNum,
                    subLabel: '',
                    studentWork: sanitizeStudentWork(work),
                    annotationMarks: marks,
                    annotationReason: reason
                });
                currentQNum = '';
                pendingRowIndex = parsedRows.length - 1;
            }
        });

        return parsedRows;
    }, [content]);

    // SECOND PASS: Identify groups of marks belonging to the same (sub-)question and decide whether to show bullets
    const processedRows = useMemo(() => {
        const counts: Record<string, number> = {};
        let currentParentQ = '';
        let currentParentSub = '';

        // 1. First pass to calculate counts
        const rowsWithMeta = rows.map(row => {
            if (row.qNum) currentParentQ = row.qNum;
            if (row.subLabel) currentParentSub = row.subLabel;

            const key = `${currentParentQ}_${currentParentSub}`;
            counts[key] = (counts[key] || 0) + 1;
            return { ...row, key };
        });

        // 2. Second pass to add showBullet flag
        return rowsWithMeta.map(row => ({
            ...row,
            showBullet: counts[row.key] > 1
        }));
    }, [rows]);

    if (processedRows.length === 0) return null;

    return (
        <div className="your-work-wrapper">
            <div className="your-work-header">YOUR WORK:</div>
            <div className="your-work-section">
                <div className="your-work-grid-container">
                    {processedRows.map((row, i) => (
                        <div className="your-work-row" key={i}>
                            <div className="yw-col-qnum">{row.qNum}</div>
                            <div className="yw-col-sublabel">{row.subLabel}</div>
                            {row.showBullet ? (
                                <div className="yw-col-bullet">•</div>
                            ) : (
                                /* Spacer if no bullet, to maintain grid structure on desktop if needed, or handle via CSS */
                                <div className="yw-col-bullet empty"></div>
                            )}
                            <WorkContent
                                content={row.studentWork}
                                MarkdownMathRenderer={MarkdownMathRenderer}
                                showBullet={row.showBullet}
                            />
                            <div className="yw-col-annotation">
                                {row.annotationMarks && <span className="yw-marks">{row.annotationMarks}</span>}
                                {row.annotationReason && <span className="yw-reason">{row.annotationReason}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

    );
}
