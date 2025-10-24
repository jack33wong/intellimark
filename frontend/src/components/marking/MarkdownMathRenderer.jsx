import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './MarkdownMathRenderer.css';
import { detectAndWrapMath } from '../../utils/simpleMathDetector';

const preprocessLatexDelimiters = (content) => {
  if (!content || typeof content !== 'string') {
    return content;
  }
  return content
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    // FIX: This new line finds ^(...) and converts it to the correct ^{...} syntax.
    .replace(/\^\(([^)]+)\)/g, '^{$1}')
    // FIX: Convert literal \n\n to actual newlines for proper markdown rendering
    .replace(/\\n\\n/g, '\n\n')
    .replace(/\\n/g, '\n');
};

const MarkdownMathRenderer = ({ 
  content, 
  className = '', 
  options = {} 
}) => {
  const defaultOptions = {
    throwOnError: false,
    errorColor: '#cc0000',
    strict: false,
    trust: true,
    ...options
  };

  if (!content || typeof content !== 'string') {
    return (
      <div className={`markdown-math-renderer ${className}`}>
        <p className="empty-content">No content to display</p>
      </div>
    );
  }

  const contentWithMath = detectAndWrapMath(content);
  const preprocessedContent = preprocessLatexDelimiters(contentWithMath);

  return (
    <div className={`markdown-math-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, defaultOptions]]}
        components={{
          p: ({ node, children }) => {
            const textContent = node.children.map(child => child.value || '').join('').trim();
            const isStepTitle = /^(Step \d+:)/i.test(textContent);
            if (isStepTitle) {
              return <h3 className="markdown-h3">{children}</h3>;
            }
            return <p className="markdown-p">{children}</p>;
          },
          em: ({ node, children }) => {
            const isMathWrapper =
              node.children.length === 1 &&
              node.children[0].tagName === 'span' &&
              node.children[0].properties?.className?.includes('katex');
            if (isMathWrapper) {
              return <>{children}</>;
            }
            return <em className="markdown-em">{children}</em>;
          },
          h3: ({ children }) => <h3 className="markdown-h3">{children}</h3>,
          ol: ({ children }) => <ol className="markdown-ol">{children}</ol>,
          ul: ({ children }) => <ul>{children}</ul>,
        }}
      >
        {preprocessedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownMathRenderer;