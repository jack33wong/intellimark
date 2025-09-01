import React from 'react';
import { MathRenderer } from './latexRenderer';

/**
 * Utility function to parse and render content with both Markdown and LaTeX
 * @param {string} content - The content to render (Markdown + LaTeX)
 * @returns {Array} Array of React elements and strings
 */
export const parseMarkdownLatex = (content) => {
  if (!content || typeof content !== 'string') {
    return [content];
  }

  const elements = [];
  let currentIndex = 0;

  // Regex patterns for different elements
  const patterns = [
    // LaTeX block math: \[ ... \]
    { regex: /\\\[([\s\S]*?)\\\]/g, type: 'latex-block' },
    // LaTeX inline math: \( ... \)
    { regex: /\\\(([\s\S]*?)\\\)/g, type: 'latex-inline' },
    // Markdown block math: $$ ... $$
    { regex: /\$\$([\s\S]*?)\$\$/g, type: 'latex-block' },
    // Markdown inline math: $ ... $
    { regex: /\$([^$\n]+?)\$/g, type: 'latex-inline' },
    // Headers: ### ...
    { regex: /^(#{1,6})\s+(.+)$/gm, type: 'header' },
    // Bold: **text** or __text__
    { regex: /\*\*([^*]+)\*\*/g, type: 'bold' },
    { regex: /__([^_]+)__/g, type: 'bold' },
    // Italic: *text* or _text_
    { regex: /\*([^*]+)\*/g, type: 'italic' },
    { regex: /_([^_]+)_/g, type: 'italic' },
    // Code blocks: ```...```
    { regex: /```([\s\S]*?)```/g, type: 'code-block' },
    // Inline code: `...`
    { regex: /`([^`]+)`/g, type: 'inline-code' },
    // Lists: - item or * item
    { regex: /^[-*]\s+(.+)$/gm, type: 'list-item' },
    // Numbered lists: 1. item
    { regex: /^\d+\.\s+(.+)$/gm, type: 'numbered-item' },
    // Line breaks
    { regex: /\n\n/g, type: 'paragraph-break' },
    { regex: /\n/g, type: 'line-break' }
  ];

  // Sort patterns by priority (LaTeX first, then Markdown)
  patterns.sort((a, b) => {
    const latexPriority = ['latex-block', 'latex-inline'];
    const aPriority = latexPriority.indexOf(a.type);
    const bPriority = latexPriority.indexOf(b.type);
    return bPriority - aPriority;
  });

  let remainingText = content;

  // Process each pattern
  patterns.forEach(({ regex, type }) => {
    const matches = [...remainingText.matchAll(regex)];
    
    if (matches.length > 0) {
      let lastIndex = 0;
      const newElements = [];

      matches.forEach((match) => {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;

        // Add text before the match
        if (matchStart > lastIndex) {
          const textBefore = remainingText.slice(lastIndex, matchStart);
          if (textBefore.trim()) {
            newElements.push(textBefore);
          }
        }

        // Process the match based on type
        switch (type) {
          case 'latex-block':
            newElements.push(
              <MathRenderer 
                key={`latex-block-${matchStart}`}
                expression={`\\[${match[1]}\\]`}
                displayMode="block"
              />
            );
            break;

          case 'latex-inline':
            newElements.push(
              <MathRenderer 
                key={`latex-inline-${matchStart}`}
                expression={`\\(${match[1]}\\)`}
                displayMode="inline"
              />
            );
            break;

          case 'header':
            const level = match[1].length;
            const HeaderTag = `h${level}`;
            newElements.push(
              React.createElement(HeaderTag, {
                key: `header-${matchStart}`,
                style: { 
                  marginTop: '16px', 
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: 'var(--primary-text)'
                }
              }, match[2])
            );
            break;

          case 'bold':
            newElements.push(
              <strong key={`bold-${matchStart}`} style={{ fontWeight: 'bold' }}>
                {match[1]}
              </strong>
            );
            break;

          case 'italic':
            newElements.push(
              <em key={`italic-${matchStart}`} style={{ fontStyle: 'italic' }}>
                {match[1]}
              </em>
            );
            break;

          case 'code-block':
            newElements.push(
              <pre key={`code-block-${matchStart}`} style={{
                background: 'var(--tertiary-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '12px',
                margin: '8px 0',
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '14px',
                color: 'var(--secondary-text)'
              }}>
                {match[1]}
              </pre>
            );
            break;

          case 'inline-code':
            newElements.push(
              <code key={`inline-code-${matchStart}`} style={{
                background: 'var(--tertiary-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '2px 6px',
                fontFamily: 'monospace',
                fontSize: '14px',
                color: 'var(--secondary-text)'
              }}>
                {match[1]}
              </code>
            );
            break;

          case 'list-item':
            newElements.push(
              <li key={`list-item-${matchStart}`} style={{
                marginLeft: '20px',
                marginBottom: '4px'
              }}>
                {match[1]}
              </li>
            );
            break;

          case 'numbered-item':
            newElements.push(
              <li key={`numbered-item-${matchStart}`} style={{
                marginLeft: '20px',
                marginBottom: '4px'
              }}>
                {match[1]}
              </li>
            );
            break;

          case 'paragraph-break':
            newElements.push(<br key={`para-break-${matchStart}`} />);
            break;

          case 'line-break':
            newElements.push(<br key={`line-break-${matchStart}`} />);
            break;

          default:
            newElements.push(match[0]);
        }

        lastIndex = matchEnd;
      });

      // Add remaining text after last match
      if (lastIndex < remainingText.length) {
        const textAfter = remainingText.slice(lastIndex);
        if (textAfter.trim()) {
          newElements.push(textAfter);
        }
      }

      remainingText = newElements.join('');
    }
  });

  // If no patterns matched, return the original content
  if (remainingText === content) {
    return [content];
  }

  // Process the final result to handle lists properly
  return processLists(remainingText);
};

/**
 * Process lists to wrap consecutive list items in ul/ol tags
 * @param {Array} elements - Array of elements and strings
 * @returns {Array} Processed elements with proper list structure
 */
const processLists = (elements) => {
  if (!Array.isArray(elements)) {
    return [elements];
  }

  const result = [];
  let currentList = [];
  let inList = false;

  elements.forEach((element, index) => {
    if (React.isValidElement(element) && element.type === 'li') {
      if (!inList) {
        inList = true;
        currentList = [];
      }
      currentList.push(element);
    } else {
      if (inList && currentList.length > 0) {
        // Close the current list
        result.push(
          <ul key={`list-${index}`} style={{
            margin: '8px 0',
            paddingLeft: '20px'
          }}>
            {currentList}
          </ul>
        );
        currentList = [];
        inList = false;
      }
      result.push(element);
    }
  });

  // Handle list at the end
  if (inList && currentList.length > 0) {
    result.push(
      <ul key={`list-end`} style={{
        margin: '8px 0',
        paddingLeft: '20px'
      }}>
        {currentList}
      </ul>
    );
  }

  return result;
};

/**
 * React component for rendering Markdown + LaTeX content
 * @param {Object} props - Component props
 * @param {string} props.content - The content to render
 * @param {string} props.className - Additional CSS classes
 * @returns {JSX.Element} The rendered content
 */
export const MarkdownLatexRenderer = ({ content, className = '' }) => {
  const renderedElements = parseMarkdownLatex(content);

  return (
    <div className={`markdown-latex-renderer ${className}`}>
      {renderedElements}
    </div>
  );
};

export default MarkdownLatexRenderer;
