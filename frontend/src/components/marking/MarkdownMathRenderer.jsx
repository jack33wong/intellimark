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
    .replace(/\\\]/g, '$$');
};

const MarkdownMathRenderer = ({ 
  content, 
  className = '', 
  options = {} 
}) => {
  const defaultOptions = { /* ... */ };

  if (!content || typeof content !== 'string') {
    // ... (error handling is the same)
  }

  const contentWithMath = detectAndWrapMath(content);
  const preprocessedContent = preprocessLatexDelimiters(contentWithMath);

  return (
    <div className={`markdown-math-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, defaultOptions]]}
        components={{
          // --- THIS IS THE NEW RESILIENT LOGIC ---
          // It now checks the text content of a paragraph, not the tags inside it.
          p: ({ node, children }) => {
            // Extract plain text from the paragraph's children
            const textContent = node.children.map(child => child.value || '').join('').trim();
            
            // Check if the entire paragraph is just a step title
            const isStepTitle = /^(Step \d+:)$/i.test(textContent);

            if (isStepTitle) {
              // If it's a title, render it as an h3.
              return <h3 className="markdown-h3">{children}</h3>;
            }
            
            // Otherwise, render a normal paragraph.
            return <p className="markdown-p">{children}</p>;
          },
          
          h3: ({ children }) => <h3 className="markdown-h3">{children}</h3>,
          ol: ({ children }) => <ol className="markdown-ol">{children}</ol>,
          em: ({ children }) => <em className="markdown-em">{children}</em>,
        }}
      >
        {preprocessedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownMathRenderer;