import React, { useMemo } from 'react';
import '../marking/YourWork.css';

interface YourWorkSectionProps {
    content: string;
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

    // Matches "M0 A0 - Reason" or "[M0] [A0] - Reason"
    // Clean up annotation first
    const cleanAnno = annotation.replace(/^-\s*/, '').trim();

    // Check for marks at start
    // Regex matches uppercase letter+digit pairs: (M1 A1) or ([M1] [A1])
    const marksMatch = cleanAnno.match(/^((?:\[?[A-Z]\d+\]?\s*)+)(?:-|)(.*)$/);
    if (marksMatch) {
        const rawMarks = marksMatch[1];
        reason = marksMatch[2].trim();

        // Format marks: Ensure brackets [M0] [A0]
        marks = rawMarks.trim().split(/\s+/).map(m => {
            const inner = m.replace(/[\[\]]/g, ''); // remove existing brackets
            return `[${inner}]`;
        }).join(' ');
    } else {
        // No marks found, check if entire specific format is reasoning or marks
        // If empty, return empty
    }

    return { work: studentWork.trim(), marks, reason };
};

export default function YourWorkSection({ content }: YourWorkSectionProps) {
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
                    studentWork: work,
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
                    studentWork: work,
                    annotationMarks: marks,
                    annotationReason: reason
                });
                currentQNum = '';
                pendingRowIndex = parsedRows.length - 1;
                return;
            }

            // 4. Content Line (No label)
            if (pendingRowIndex !== -1) {
                // Append to previous row student work
                // But careful if it contains annotation separator!
                // Re-parsing the full combined string might be better?
                // Or just append to 'work' if no annotation found yet.
                // Assuming multi-line content belongs to work.

                // If previous row already has marks/reason, this might be reasoning continuation?
                // For simplicity, append to work.
                const prev = parsedRows[pendingRowIndex];
                if (!prev.annotationMarks && !prev.annotationReason) {
                    // Re-parse combined
                    const combined = `${prev.studentWork} ${text}`;
                    const { work, marks, reason } = parseRowContent(combined);
                    prev.studentWork = work;
                    prev.annotationMarks = marks;
                    prev.annotationReason = reason;
                } else {
                    // Append to reason if reason exists? Or work?
                    // Usually reasoning wraps.
                    if (prev.annotationReason) {
                        prev.annotationReason += ` ${text}`;
                    } else {
                        prev.studentWork += ` ${text}`;
                    }
                }
            } else {
                // Orphan content (e.g. QNum provided but no sub-label line yet? Or just content)
                // If currentQNum exists, create row with empty subLabel
                const { work, marks, reason } = parseRowContent(text);
                parsedRows.push({
                    qNum: currentQNum,
                    subLabel: '',
                    studentWork: work,
                    annotationMarks: marks,
                    annotationReason: reason
                });
                currentQNum = '';
                pendingRowIndex = parsedRows.length - 1;
            }
        });

        return parsedRows;
    }, [content]);

    if (rows.length === 0) return null;

    return (
        <div className="your-work-section">
            <div className="your-work-header">YOUR WORK:</div>

            <div className="your-work-grid-container">
                {rows.map((row, i) => (
                    <React.Fragment key={i}>
                        <div className="yw-col-qnum">{row.qNum}</div>
                        <div className="yw-col-sublabel">
                            {row.subLabel ? row.subLabel : <span className="yw-bullet">•</span>}
                        </div>
                        <div className="yw-col-work" dangerouslySetInnerHTML={{ __html: row.studentWork || '&nbsp;' }} />
                        <div className="yw-col-annotation">
                            {row.annotationMarks && <span className="yw-marks">{row.annotationMarks}</span>}
                            {row.annotationReason && <span className="yw-reason">{row.annotationReason}</span>}
                        </div>
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
}
