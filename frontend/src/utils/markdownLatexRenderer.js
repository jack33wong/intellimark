import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/**
 * React component for rendering Markdown + LaTeX content
 * @param {Object} props - Component props
 * @param {string} props.content - The content to render (Markdown + LaTeX)
 * @param {string} props.className - Additional CSS classes
 * @returns {JSX.Element} The rendered content
 */
export const MarkdownLatexRenderer = ({ content, className = '' }) => {
  if (!content || typeof content !== 'string') {
    return <div className={`markdown-latex-renderer ${className}`}>No content to render</div>;
  }

  return (
    <div className={`markdown-latex-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Custom styling for different elements
          h1: ({ children }) => <h1 style={{ fontSize: '1.5em', margin: '16px 0 8px 0', fontWeight: 'bold' }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: '1.3em', margin: '16px 0 8px 0', fontWeight: 'bold' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: '1.1em', margin: '16px 0 8px 0', fontWeight: 'bold' }}>{children}</h3>,
          h4: ({ children }) => <h4 style={{ fontSize: '1em', margin: '16px 0 8px 0', fontWeight: 'bold' }}>{children}</h4>,
          h5: ({ children }) => <h5 style={{ fontSize: '0.9em', margin: '16px 0 8px 0', fontWeight: 'bold' }}>{children}</h5>,
          h6: ({ children }) => <h6 style={{ fontSize: '0.8em', margin: '16px 0 8px 0', fontWeight: 'bold' }}>{children}</h6>,
          p: ({ children }) => <p style={{ margin: '8px 0', lineHeight: '1.6' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '8px 0', paddingLeft: '20px' }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: '4px 0' }}>{children}</li>,
          strong: ({ children }) => <strong style={{ fontWeight: '600' }}>{children}</strong>,
          em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
          code: ({ children, className }) => {
            // Check if this is a code block (has className) or inline code
            if (className) {
              return (
                <pre style={{
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
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code style={{
                background: 'var(--tertiary-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '2px 6px',
                fontFamily: 'monospace',
                fontSize: '0.9em',
                color: 'var(--secondary-text)'
              }}>
                {children}
              </code>
            );
          },
          // Custom styling for LaTeX elements
          '.math.math-display': ({ children }) => (
            <div style={{ margin: '16px 0', textAlign: 'center' }}>{children}</div>
          ),
          '.math.math-inline': ({ children }) => (
            <span style={{ fontSize: '1em' }}>{children}</span>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

/**
 * Utility function to escape LaTeX backslashes for proper rendering
 * @param {string} content - The content with LaTeX
 * @returns {string} Content with properly escaped LaTeX
 */
export const escapeLatex = (content) => {
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  // Double escape backslashes in LaTeX expressions
  return content
    // Escape backslashes in \( ... \) inline math
    .replace(/\\([^\\]*?)\\)/g, (match, inner) => {
      return `\\(${inner.replace(/\\/g, '\\\\')}\\)`;
    })
    // Escape backslashes in \[ ... \] block math
    .replace(/\\\[([^\\]*?)\\\]/g, (match, inner) => {
      return `\\[${inner.replace(/\\/g, '\\\\')}\\]`;
    });
};

/**
 * Utility function to process content before rendering
 * @param {string} content - Raw content
 * @returns {string} Processed content ready for rendering
 */
export const processMarkdownContent = (content) => {
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  // Escape LaTeX backslashes
  let processed = escapeLatex(content);
  
  // Ensure proper line breaks for lists
  processed = processed.replace(/^[-*]\s+/gm, '- ');
  processed = processed.replace(/^\d+\.\s+/gm, (match) => match);
  
  return processed;
};

export default MarkdownLatexRenderer;
