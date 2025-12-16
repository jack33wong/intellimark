import React from 'react';

interface YourWorkSectionProps {
    content: string; // Raw content from backend in :::your-work format
}

/**
 * YourWorkSection - Renders the "Your Work" section from backend
 * Expects format:
 * :::your-work
 * Your work:
 *   2
 *     ai) 53000 -- B1 - Correct...
 *     b) 3.42×10 -- M0 - Incorrect...
 * :::
 */
import '../marking/YourWork.css';

/**
 * Component to format a line of work: "Student Text -- Mark - Reasoning"
 * Renders as: Student Text      [Mark] Reasoning
 */
const FormattedContent = ({ content }: { content: string }) => {
    let studentWork = content;
    let annotation = '';

    // 1. Try explicit separator first
    if (content.includes(' -- ')) {
        const parts = content.split(' -- ');
        studentWork = parts[0];
        annotation = parts.slice(1).join(' -- ');
    } else {
        // 2. Fallback: Look for pattern "Space + MarkCodes + Hyphen + Reason"
        // Matches: " val   M0 A0 - Reason" or " val B1 - Reason"
        const markMatch = content.match(/\s+((?:[A-Z]\d+\s*)+)\s-\s/);
        if (markMatch && markMatch.index !== undefined) {
            studentWork = content.substring(0, markMatch.index);
            annotation = content.substring(markMatch.index).trim();
        }
    }

    // 3. Format Annotation: "M0 A0 - Reason" -> "[M0] [A0] Reason"
    let displayAnnotation = annotation;

    // Matches start with marks: "M0 A0 - Reason..."
    const annoMatch = annotation.match(/^((?:[A-Z]\d+\s*)+)\s-\s*(.*)$/);
    if (annoMatch) {
        const marksStr = annoMatch[1];
        const reason = annoMatch[2];

        // Wrap each mark in brackets: "M0 A0" -> "[M0] [A0]"
        const formattedMarks = marksStr.trim().split(/\s+/).map(m => `[${m}]`).join(' ');

        displayAnnotation = `${formattedMarks} ${reason}`;
    }

    // Render with Flexbox Grid-like alignment
    // Student Work: Fixed width (e.g. 280px) to ensure vertical alignment of annotations
    // Annotation: Takes remaining space
    return (
        <div className="your-work-formatted-row">
            {/* Student Work Col */}
            <div className="your-work-student-col">
                <span dangerouslySetInnerHTML={{ __html: studentWork }} />
            </div>

            {/* Annotation Col */}
            {displayAnnotation && (
                <div className="your-work-annotation-col">
                    {displayAnnotation}
                </div>
            )}
        </div>
    );
};

export default function YourWorkSection({ content }: YourWorkSectionProps) {
    if (!content) return null;

    // Extract content between :::your-work and :::
    const match = content.match(/:::your-work\n([\s\S]*?)\n:::/);
    if (!match) return null;

    const innerContent = match[1];
    const lines = innerContent.split('\n');

    // Parse and group content
    const questionHeader: string[] = [];
    const groupedWork: { [parent: string]: { label: string; children: { label: string; content: string }[] } } = {};
    const ungroupedWork: string[] = [];

    // Parsing State
    let currentParentLabel: string | null = null;
    let currentChildIndex = -1;

    lines.forEach(line => {
        let text = line.replace(/^\t+/, '').replace(/\*\*(.*?)\*\*/g, '$1').trim();
        if (!text) return;

        if (text.startsWith('YOUR WORK:')) return;

        // 1. Header: Pure digits (e.g. "2")
        if (/^\d+$/.test(text)) {
            questionHeader.push(text);
            return;
        }

        // 2. Format: "Label" only (a), i), a:, i:)
        const labelOnlyMatch = text.match(/^(\d*[a-z]+|[ivx]+)[\):]$/i);

        if (labelOnlyMatch) {
            const label = labelOnlyMatch[1];
            // Heuristic: If it looks like a Roman numeral (i, ii, v) AND we have a parent, it's likely a child.
            // Otherwise it's a new parent (a, b, c).
            const isRoman = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)+$/i.test(label) && currentParentLabel;

            if (isRoman && currentParentLabel) {
                // Add Child to current Parent
                groupedWork[currentParentLabel].children.push({
                    label: `${label})`,
                    content: ''
                });
                currentChildIndex = groupedWork[currentParentLabel].children.length - 1;
            } else {
                // New Parent Group
                const newLabel = label;
                if (!groupedWork[newLabel]) {
                    groupedWork[newLabel] = { label: `${newLabel})`, children: [] };
                }
                currentParentLabel = newLabel;
                currentChildIndex = -1; // Reset child index
            }
            return;
        }

        // 3. Format: "Label Content" (a) text, i) text)
        const labelContentMatch = text.match(/^(\d*[a-z]+|[ivx]+)[\):]\s+(.+)$/i);
        if (labelContentMatch) {
            const label = labelContentMatch[1];
            const content = labelContentMatch[2];
            const isRoman = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)+$/i.test(label) && currentParentLabel;

            if (isRoman && currentParentLabel) {
                groupedWork[currentParentLabel].children.push({
                    label: `${label})`,
                    content: content
                });
                currentChildIndex = groupedWork[currentParentLabel].children.length - 1;
            } else {
                const newLabel = label;
                if (!groupedWork[newLabel]) {
                    groupedWork[newLabel] = { label: `${newLabel})`, children: [] };
                }
                currentParentLabel = newLabel;
                // Start implicit child for content
                groupedWork[newLabel].children.push({
                    label: '',
                    content: content
                });
                currentChildIndex = groupedWork[newLabel].children.length - 1;
            }
            return;
        }

        // 4. Content Line (No label, just text)
        if (currentParentLabel && currentChildIndex !== -1) {
            // Append to current active child
            const child = groupedWork[currentParentLabel].children[currentChildIndex];
            // Append with space
            child.content = child.content ? `${child.content} ${text}` : text;
        } else if (currentParentLabel) {
            // Parent exists but no active child. Create implicit child.
            groupedWork[currentParentLabel].children.push({
                label: '',
                content: text
            });
            currentChildIndex = groupedWork[currentParentLabel].children.length - 1;
        } else {
            // No grouping context
            ungroupedWork.push(text);
        }
    });

    return (
        <div className="your-work-section">
            <div className="your-work-header">YOUR WORK:</div>

            {questionHeader.map((h, i) => (
                <div key={`head-${i}`} className="your-work-question">{h}</div>
            ))}

            <div className="your-work-content">
                {/* Ungrouped items first (main marks) - with bullets */}
                {ungroupedWork.map((item, i) => (
                    <div key={`main-${i}`} className="your-work-bullet-item">
                        <span className="bullet-point">•</span>
                        <div className="bullet-content">
                            <FormattedContent content={item} />
                        </div>
                    </div>
                ))}

                {/* Grouped items */}
                {Object.values(groupedWork).map((group, i) => (
                    <div key={`group-${i}`} className="your-work-group">
                        <div className="your-work-parent">{group.label}</div>
                        {group.children.map((child, j) => (
                            <div key={`child-${i}-${j}`} className="your-work-subquestion">
                                {child.label && <span className="subquestion-label">{child.label}</span>}
                                {/* If no label (e.g. b), just show content with padding */}
                                <span className={`subquestion-content ${!child.label ? 'subquestion-content-no-label' : ''}`}>
                                    <FormattedContent content={child.content} />
                                </span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
