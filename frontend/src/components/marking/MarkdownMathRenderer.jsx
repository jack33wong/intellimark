import React, { useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import renderMathInElement from 'katex/dist/contrib/auto-render';
import './MarkdownMathRenderer.css';
import { DiagramService } from '../../services/DiagramService';

/**
 * Pre-processes markdown content to handle common LaTeX delimiter issues.
 */
const preprocessLatexDelimiters = (content) => {
  if (!content || typeof content !== 'string') return '';
  return content
    // Fix: \f in JSON/JS strings is form-feed (\x0C), so \frac becomes <FF>rac.
    // Restore all form-feed chars back to \f to recover \frac, \forall, etc.
    .replace(/\x0C/g, '\\f')
    .replace(/\\\[/g, '$$$')
    .replace(/\\\]/g, '$$$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\\\\\[/g, '$$')
    .replace(/\\\\\\\]/g, '$$')
    .replace(/\^\(([^)]+)\)/g, '^{$1}')
    .replace(/&dollar;/g, '$')
    .replace(/&#36;/g, '$')
    .replace(/\\n\\n/g, '\n\n')
    .replace(/\\n/g, '\n');
};

const detectAndWrapMath = (content) => {
  if (!content) return '';
  return content;
};

const reorderAssistantContent = (content) => {
  if (!content || typeof content !== 'string') return content;

  // 1. Pre-process: Normalize line endings and strip redundant out-of-block labels
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/^#*\s*(?:\d+[\.\)]\s+)?(?:\*\*|__)?YOUR\s+WORK:?(?:\*\*|__)?\s*$/gmi, '')
    .replace(/###\s+YOUR\s+WORK:?/gi, '');

  // 2. Define Anchor Types and their Regexes
  const anchorTypes = [
    { id: 'question', regex: /^#+\s*(?:\*\*|__)?Question\s+\d+.*$/mi },
    { id: 'explanation', regex: /^#*\s*(?:\d+[\.\)]\s+)?(?:\*\*|__)?Explanation:?.*$/mi },
    { id: 'markingScheme', regex: /^#*\s*(?:\d+[\.\)]\s+)?(?:\*\*|__)?Marking\s+Scheme:?.*$/mi },
    { id: 'yourWork', regex: /:::your-work\b/mi }
  ];

  // 3. Find all matches with their indices
  const matches = [];
  anchorTypes.forEach(anchor => {
    const regex = new RegExp(anchor.regex, 'gmi');
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      matches.push({
        id: anchor.id,
        index: match.index,
        length: match[0].length,
        text: match[0]
      });
    }
  });

  // Sort by occurrence
  matches.sort((a, b) => a.index - b.index);

  if (matches.length === 0) return normalized;

  // 4. Split and Categorize blocks
  const segments = {
    preamble: '',
    question: '',
    explanation: '',
    markingScheme: '',
    yourWork: ''
  };

  let lastIndex = 0;
  let currentCategory = 'preamble';

  matches.forEach((match, i) => {
    // Content between previous anchor's end and this anchor's start belongs to previous section
    const textBetween = normalized.substring(lastIndex, match.index);
    if (textBetween) {
      segments[currentCategory] += textBetween;
    }

    // Switch category
    currentCategory = match.id;

    // Special block handling for :::your-work:::
    if (match.id === 'yourWork') {
      const remainingFromHere = normalized.substring(match.index);
      const fullBlockMatch = remainingFromHere.match(/:::your-work\n[\s\S]*?:::/);
      if (fullBlockMatch) {
        segments.yourWork = fullBlockMatch[0]; // Capture full block
        lastIndex = match.index + fullBlockMatch[0].length;
        currentCategory = 'preamble'; // Any text after your-work is preamble until next anchor
        return;
      }
    }

    segments[currentCategory] += match.text;
    lastIndex = match.index + match.length;
  });

  // Last chunk
  const lastText = normalized.substring(lastIndex);
  if (lastText) {
    segments[currentCategory] += lastText;
  }

  // 5. Rebuild in Strict 1-2-3 Order
  const finalParts = [];
  if (segments.preamble.trim()) finalParts.push(segments.preamble.trim());
  if (segments.question.trim()) finalParts.push(segments.question.trim());

  // Helper to aggressively flatten indentation to prevent accidental code blocks
  const flattenIndentation = (text) => {
    if (!text) return text;
    // Remove all leading whitespace from every line to ensure standard markdown paragraph parsing
    return text.split('\n').map(line => line.trimStart()).join('\n');
  };

  if (segments.explanation.trim()) {
    // 1. Remove the header specifically
    let body = segments.explanation.trim()
      .replace(/^(?:#+\s+)?(?:\d+[\.\)]\s+)?(?:\*\*|__)?Explanation(?:(?:\*\*|__)?\s*:?|:?\s*(?:\*\*|__)?)\s*/mi, '');

    // 2. Flatten indentation completely to remove code-block triggering indentation
    body = flattenIndentation(body);

    finalParts.push(`<div class="ai-explanation-section">\n\n### Explanation\n\n${body}\n\n</div>`);
  }

  if (segments.yourWork.trim()) {
    finalParts.push(segments.yourWork.trim());
  }

  if (segments.markingScheme.trim()) {
    // 1. Remove the header specifically
    let body = segments.markingScheme.trim()
      .replace(/^(?:#+\s+)?(?:\d+[\.\)]\s+)?(?:\*\*|__)?Marking\s+Scheme(?:(?:\*\*|__)?\s*:?|:?\s*(?:\*\*|__)?)\s*/mi, '');

    // 2. Flatten indentation
    body = flattenIndentation(body);

    finalParts.push(`<div class="ai-marking-scheme-section">\n\n### Marking Scheme\n\n${body}\n\n</div>`);
  }

  return finalParts.join('\n\n');
};

/**
 * Recursively extracts plain text from React children to enable robust ID matching
 */
const getRecursiveText = (children) => {
  return React.Children.toArray(children)
    .map(child => {
      if (typeof child === 'string') return child;
      if (typeof child === 'number') return String(child);
      if (child?.props?.children) return getRecursiveText(child.props.children);
      return '';
    })
    .join('');
};

// Stable component for rendering HTML with embedded LaTeX
// Bypasses ReactMarkdown to prevent reconciliation conflicts with auto-render
const StableHtmlRenderer = ({ content, className }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      try {
        renderMathInElement(containerRef.current, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true }
          ],
          throwOnError: false
        });
      } catch (e) {
        console.error('[StableHtmlRenderer] Math render error:', e);
      }
    }
  }, [content]);

  return (
    <div
      ref={containerRef}
      className={`markdown-math-renderer ${className}`}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
};

export default function MarkdownMathRenderer({
  content,
  className = '',
  options = {},
  YourWorkSection,
  isYourWork = false
}) {
  const defaultOptions = {
    throwOnError: false,
    errorColor: '#cc0000',
    strict: false,
    trust: true,
    ...options
  };

  /**
   * Detect primary question ID from entire message content.
   * Robust to bolding (**Question 10**) and HTML tags.
   */
  const globalQuestionId = useMemo(() => {
    if (!content || typeof content !== 'string') return undefined;
    
    // Look for Question X (e.g., in preamble "I will explain Question 10")
    // Use [^0-9a-z]* to bypass bolding/markdown markers
    const match = content.match(/Question[^0-9a-z]*(\d+[a-z]*)/i);
    return match ? `question-${match[1].toLowerCase()}` : undefined;
  }, [content]);

  // Helper to parse :::your-work blocks
  const parseYourWorkBlocks = (text) => {
    return text.replace(/:::your-work\n([\s\S]*?):::/g, (match, content) => {
      return `<div class="your-work-section">${content}</div>`;
    });
  };

  const injectMarkingTags = (text) => {
    if (!text || typeof text !== 'string') return text;
    // Surgically wrap [M1], [A1] etc in marking-code spans for right-alignment
    // This matches the design used in the explicit Model Answer templates
    return text.replace(/\[([A-Z]\d+[^\]]*)\]/g, (match, code) => {
      // Avoid double-wrapping if the AI already provided the span
      if (text.includes(`class="marking-code">[${code}]</span>`)) return match;
      return `<span class="marking-code">[${code}]</span>`;
    });
  };

  if (!content || typeof content !== 'string') {
    return (
      <div className={`markdown-math-renderer ${className}`}>
        <p className="empty-content">No content to display</p>
      </div>
    );
  }

  // DETECT MODE: If content is explicitly HTML structure (from backend templates), use StableHtmlRenderer.
  // This avoids ReactMarkdown parsing conflicts with raw HTML tags (especially </div> rendering as text).
  // NOTE: If content contains a "Your Work" block, we MUST use ReactMarkdown for component rendering.
  const hasYourWorkCard = content.includes(':::your-work') || content.includes('your-work-block-marker');
  
  const isExplicitHtml = !hasYourWorkCard && (
    content.includes('<div class="model_answer">') ||
    content.includes('<span class="model_question">') ||
    content.includes('<div class="ai-explanation-section">') ||
    content.includes('<div class="model-answer-block">') ||   // marking-scheme outer wrapper
    content.includes('<div class="model-question-number">') ||   // marking-scheme question header
    content.includes('<div class="step-title">') ||            // marking-scheme-explanation title
    content.includes('<div class="step-explanation">')         // marking-scheme-explanation body
  );

  // Only convert step-title/step-explanation divs to Markdown for mixed-mode content.
  // Skip this for explicit HTML content — it would leave orphaned </div> tags.
  const normalizedHtml = isExplicitHtml
    ? content
    : content
        .replace(/<div class=["']step-title["']>([\s\S]*?)<\/div>/g, '\n### $1\n')
        .replace(/<div class=["']step-explanation["']>([\s\S]*?)<\/div>/g, '\n$1\n');

  const reorderedContent = isYourWork ? normalizedHtml : reorderAssistantContent(normalizedHtml);

  const contentWithBlockMarkers = reorderedContent.replace(
    /:::your-work\n([\s\S]*?):::/g,
    (match, workContent) => `<div class="your-work-block-marker" data-content="${encodeURIComponent(workContent)}"></div>`
  );

  const contentWithMath = detectAndWrapMath(contentWithBlockMarkers);
  const preprocessedContent = preprocessLatexDelimiters(contentWithMath);
  const processedText = injectMarkingTags(parseYourWorkBlocks(preprocessedContent));

  // Apply Diagram Post-Processing (SVG Conversion)
  const finalProcessedText = (processedText.includes('model_answer') || processedText.includes('model_question') || processedText.includes('[Diagram'))
    ? DiagramService.process(processedText)
    : processedText;

  if (isExplicitHtml) {
    return <StableHtmlRenderer content={finalProcessedText} className={className} />;
  }

  return (
    <div className={`markdown-math-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, defaultOptions], rehypeRaw]}
        components={{
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
            const { index, isFirst, ...domProps } = props;
            return <div {...domProps}>{children}</div>;
          },
          p: ({ node, children, ...props }) => {
            const textContent = getRecursiveText(children);
            const isStepTitle = /^Step \d+:/i.test(textContent);

            if (isStepTitle) {
               const id = globalQuestionId;
               return (
                <h3 
                  className={`markdown-h3${id ? ' clickable-question-header' : ''}`} 
                  id={id} 
                  style={id ? { scrollMarginTop: '120px', cursor: 'pointer' } : {}}
                >
                  {children}
                </h3>
              );
            }
            const { index, isFirst, ...domProps } = props;
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
            const textContent = getRecursiveText(children);

            let id = undefined;
            const questionMatch = textContent.match(/Question\s+(\d+[a-z]*)/i);
            if (questionMatch) {
              id = `question-${questionMatch[1].toLowerCase()}`;
            } else if (globalQuestionId && /^Step \d+:/i.test(textContent)) {
              // Fallback to global ID for "Step X" headers that don't repeat the question number
              id = globalQuestionId;
            }

            const { index, isFirst, ...domProps } = props;
            return (
              <h3 
                className={`markdown-h3${id ? ' clickable-question-header' : ''}`} 
                id={id} 
                style={id ? { scrollMarginTop: '120px', cursor: 'pointer' } : {}}
                {...domProps}
              >
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
        {finalProcessedText}
      </ReactMarkdown>
    </div>
  );
}