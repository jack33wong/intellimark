import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import './MarkdownMathRenderer.css';
import './YourWork.css';
import { detectAndWrapMath } from '../../utils/simpleMathDetector';

const preprocessLatexDelimiters = (content) => {
  if (!content || typeof content !== 'string') {
    return content;
  }
  return content
    // Normalize various delimiters to single $ or double $$
    .replace(/\\\\\(/g, '$')
    .replace(/\\\\\)/g, '$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\\\[/g, '$$')
    .replace(/\\\\\]/g, '$$')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    // Catch-all for triple backslash ones sometimes seen in OCR
    .replace(/\\\\\\\(/g, '$')
    .replace(/\\\\\\\)/g, '$')
    .replace(/\\\\\\\[/g, '$$')
    .replace(/\\\\\\\]/g, '$$')
    // FIX: This new line finds ^(...) and converts it to the correct ^{...} syntax.
    .replace(/\^\(([^)]+)\)/g, '^{$1}')
    // Strip raw HTML div wrappers that interfere with markdown/math parsing
    .replace(/<div class=["']step-explanation["']>([\s\S]*?)<\/div>/g, '$1')
    // FIX: Convert literal \n\n and \n to actual newlines for proper markdown rendering
    .replace(/\\n\\n/g, '\n\n')
    .replace(/\\n/g, '\n');
};

export default function MarkdownMathRenderer({
  content,
  className = '',
  options = {},
  YourWorkSection,
  isYourWork = false // NEW: Flag to skip aggressive detection inside grid
}) {
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

  // 1. Normalize AI-injected HTML into standard markdown so math rendering is reliable
  const normalizedHtml = content
    .replace(/<div class=["']step-title["']>([\s\S]*?)<\/div>/g, '\n### $1\n')
    .replace(/<div class=["']step-explanation["']>([\s\S]*?)<\/div>/g, '\n$1\n');

  // 2. Wrap :::your-work with custom tag FIRST
  const contentWithBlockMarkers = normalizedHtml.replace(
    /:::your-work\n([\s\S]*?):::/g,
    (match, workContent) => `<div class="your-work-block-marker" data-content="${encodeURIComponent(workContent)}"></div>`
  );

  // 2. Detect and wrap naked math expressions in the REMAINING text
  const contentWithMath = detectAndWrapMath(contentWithBlockMarkers);

  // 3. Normalize LaTeX delimiters
  const preprocessedContent = preprocessLatexDelimiters(contentWithMath);

  return (
    <div className={`markdown-math-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        // SWAP ORDER: rehypeKatex should usually run before rehypeRaw or properly co-exist
        rehypePlugins={[[rehypeKatex, defaultOptions], rehypeRaw]}
        components={{
          // Use div with class instead of custom tag for better compatibility
          div: ({ node, children, ...props }) => {
            if (props.className === 'your-work-block-marker') {
              if (!YourWorkSection) return null;
              const decodedContent = decodeURIComponent(props['data-content'] || '');
              return (
                <YourWorkSection
                  content={`:::your-work\n${decodedContent}\n:::`}
                  MarkdownMathRenderer={MarkdownMathRenderer}
                />
              );
            }
            // Filter out react-markdown specific props before spreading to div
            const { index, isFirst, ...domProps } = props;
            return <div {...domProps}>{children}</div>;
          },
          p: ({ node, children, ...props }) => {
            const hasStepTitle = React.Children.toArray(children).some(child =>
              typeof child === 'string' && /^(Step \d+:)/i.test(child)
            );

            if (hasStepTitle) {
              return <h3 className="markdown-h3">{children}</h3>;
            }
            const { index, isFirst, ...domProps } = props;
            // Use step-explanation class for all other paragraphs to match the grey design
            return <p className="markdown-p step-explanation" {...domProps}>{children}</p>;
          },
          em: ({ node, children, ...props }) => {
            const isKatex = React.Children.toArray(children).some(child =>
              child?.props?.className?.includes('katex')
            );
            if (isKatex) {
              return <>{children}</>;
            }
            const { index, isFirst, ...domProps } = props;
            return <em className="markdown-em" {...domProps}>{children}</em>;
          },
          h3: ({ node, children, ...props }) => {
            const textContent = React.Children.toArray(children)
              .map(child => typeof child === 'string' ? child : '')
              .join('');

            let id = undefined;
            const questionMatch = textContent.match(/Question\s+(\d+[a-z]*)/i);
            if (questionMatch) {
              id = `question-${questionMatch[1].toLowerCase()}`;
            }

            const { index, isFirst, ...domProps } = props;
            return (
              <h3 className="markdown-h3" id={id} {...domProps}>
                {React.Children.map(children, child => {
                  if (typeof child === 'string') {
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
          ol: ({ children, node, ...props }) => {
            const { index, isFirst, ...domProps } = props;
            return <ol className="markdown-ol" {...domProps}>{children}</ol>;
          },
          ul: ({ children, node, ...props }) => {
            const { index, isFirst, ...domProps } = props;
            return <ul {...domProps}>{children}</ul>;
          },
        }}
      >
        {preprocessedContent}
      </ReactMarkdown>
    </div>
  );
}