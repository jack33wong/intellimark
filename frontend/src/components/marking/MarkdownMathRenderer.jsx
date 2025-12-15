import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
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
        rehypePlugins={[rehypeRaw, [rehypeKatex, defaultOptions]]}
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
          h3: ({ children }) => {
            // Extract text content safely
            const text = React.Children.toArray(children).reduce((acc, child) => {
              return acc + (typeof child === 'string' ? child : '');
            }, '');

            // Default ID
            let id = undefined;

            // Try to extract question number for ID (e.g. "Question 3a")
            // pattern: Question \d+[a-z]*
            const questionMatch = text.match(/Question\s+(\d+[a-z]*)/i);
            if (questionMatch) {
              id = `question-${questionMatch[1]}`;
            }

            if (id) {
              console.log('[Renderer] Generated ID:', id, 'from text:', text);
            } else if (text.includes('Question')) {
              console.log('[Renderer] WARNING: Found "Question" but failed to generate ID. Text:', text);
            }

            // Check for marks pattern: (...) marks
            // We can split the children to style the marks part differently if it's a string
            return (
              <h3 className="markdown-h3" id={id}>
                {React.Children.map(children, child => {
                  if (typeof child === 'string') {
                    // Check if this string contains the marks part
                    // matches: (1 mark) or (2 marks)
                    const parts = child.split(/(\(\d+\s+marks?\))/i);
                    return parts.map((part, i) => {
                      if (/^\(\d+\s+marks?\)$/i.test(part)) {
                        return <span key={i} className="question-marks">{part}</span>;
                      }
                      return part;
                    });
                  }
                  return child;
                })}
              </h3>
            );
          },
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