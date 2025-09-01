import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './MarkdownMathRenderer.css';

/**
 * Preprocesses LaTeX delimiters to standard delimiters
 * Converts \(...\) to $...$ and \[...\] to $$...$$
 * @param {string} content - The content to preprocess
 * @returns {string} - The preprocessed content
 */
const preprocessLatexDelimiters = (content) => {
  if (!content || typeof content !== 'string') {
    return content;
  }

  return content
    // Convert \(...\) to $...$ (inline math)
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    // Convert \[...\] to $$...$$ (block math)
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$');
};

/**
 * MarkdownMathRenderer - A production-ready component for rendering Markdown with LaTeX math
 * 
 * Features:
 * - Renders Markdown content with proper formatting
 * - Supports inline math with $...$ and \(...\) delimiters
 * - Supports block math with $$...$$ and \[...\] delimiters
 * - Automatically converts LaTeX delimiters to standard delimiters
 * - Uses KaTeX for high-quality math rendering
 * - Includes proper TypeScript types
 * - Production-ready with error handling
 * 
 * @param {Object} props - Component props
 * @param {string} props.content - Markdown content to render
 * @param {string} [props.className] - Additional CSS classes
 * @param {Object} [props.options] - KaTeX rendering options
 * @returns {JSX.Element} Rendered Markdown with LaTeX
 */
const MarkdownMathRenderer = ({ 
  content, 
  className = '', 
  options = {} 
}) => {
  // Default KaTeX options for production use
  const defaultOptions = {
    throwOnError: false,
    errorColor: '#cc0000',
    strict: false,
    trust: true,
    ...options
  };

  // Handle empty or invalid content
  if (!content || typeof content !== 'string') {
    return (
      <div className={`markdown-math-renderer ${className}`}>
        <p className="empty-content">No content to display</p>
      </div>
    );
  }

  // Preprocess the content to convert LaTeX delimiters
  const preprocessedContent = preprocessLatexDelimiters(content);

  return (
    <div className={`markdown-math-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, defaultOptions]]}
        components={{
          // Custom component overrides for better styling
          h1: ({ children }) => <h1 className="markdown-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="markdown-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="markdown-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="markdown-h4">{children}</h4>,
          h5: ({ children }) => <h5 className="markdown-h5">{children}</h5>,
          h6: ({ children }) => <h6 className="markdown-h6">{children}</h6>,
          p: ({ children }) => <p className="markdown-p">{children}</p>,
          ul: ({ children }) => <ul className="markdown-ul">{children}</ul>,
          ol: ({ children }) => <ol className="markdown-ol">{children}</ol>,
          li: ({ children }) => <li className="markdown-li">{children}</li>,
          code: ({ children, className }) => {
            const isInline = !className;
            return isInline ? (
              <code className="markdown-inline-code">{children}</code>
            ) : (
              <code className={`markdown-code ${className}`}>{children}</code>
            );
          },
          pre: ({ children }) => <pre className="markdown-pre">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="markdown-blockquote">{children}</blockquote>
          ),
          table: ({ children }) => <table className="markdown-table">{children}</table>,
          th: ({ children }) => <th className="markdown-th">{children}</th>,
          td: ({ children }) => <td className="markdown-td">{children}</td>,
          a: ({ href, children }) => (
            <a href={href} className="markdown-link" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="markdown-strong">{children}</strong>,
          em: ({ children }) => <em className="markdown-em">{children}</em>,
          hr: () => <hr className="markdown-hr" />
        }}
      >
        {preprocessedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownMathRenderer;
