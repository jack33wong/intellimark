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

    lines.forEach(line => {
        let text = line.replace(/^\t+/, '').replace(/\*\*(.*?)\*\*/g, '$1');
        if (!text.trim()) return;

        if (text.startsWith('YOUR WORK:')) return;
        if (/^\d+$/.test(text)) {
            questionHeader.push(text);
            return;
        }

        // Match standard format: "2ai) content" or "ai) content" or "b) content"
        // Also handle "2ai: content" or "ai: content" just in case
        const partMatch = text.match(/^(\d*)([a-z]+?)(i*)[\):]\s*(.+)$/);

        if (partMatch) {
            const [, , letter, roman, content] = partMatch;

            if (!groupedWork[letter]) {
                groupedWork[letter] = { label: `${letter})`, children: [] };
            }

            // Add to children
            groupedWork[letter].children.push({
                label: roman ? `${roman})` : '', // 'i)', 'ii)' or empty if simple 'b'
                content: content
            });
        } else {
            // No recognizable part label (e.g. main question marks or header text)
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
                        <div className="bullet-content" dangerouslySetInnerHTML={{ __html: item }} />
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
                                <span className={`subquestion-content ${!child.label ? 'subquestion-content-no-label' : ''}`}
                                    dangerouslySetInnerHTML={{ __html: child.content }} />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
