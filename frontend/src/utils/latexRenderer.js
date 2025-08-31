import React from 'react';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

/**
 * Utility function to process LaTeX expression and determine display mode
 * @param {string} expression - The LaTeX expression to process
 * @returns {Object} Object containing processed expression and display mode
 */
export const processLatexExpression = (expression) => {
  if (!expression || expression.trim() === '') {
    return { processedExpression: '', displayMode: 'block' };
  }

  let processedExpression = expression.trim();
  
  // Handle \[ \] delimiters for block math
  if (processedExpression.startsWith('\\[') && processedExpression.endsWith('\\]')) {
    processedExpression = processedExpression.slice(2, -2); // Remove \[ and \]
    return { processedExpression, displayMode: 'block' };
  }
  
  // Handle \( \) delimiters for inline math
  if (processedExpression.startsWith('\\(') && processedExpression.endsWith('\\)')) {
    processedExpression = processedExpression.slice(2, -2); // Remove \( and \)
    return { processedExpression, displayMode: 'inline' };
  }
  
  // Handle $$ delimiters for block math
  if (processedExpression.startsWith('$$') && processedExpression.endsWith('$$')) {
    processedExpression = processedExpression.slice(2, -2); // Remove $$ and $$
    return { processedExpression, displayMode: 'block' };
  }
  
  // Handle $ delimiters for inline math
  if (processedExpression.startsWith('$') && processedExpression.endsWith('$')) {
    processedExpression = processedExpression.slice(1, -1); // Remove $ and $
    return { processedExpression, displayMode: 'inline' };
  }

  // If no delimiters found, return the expression as-is
  return { processedExpression, displayMode: null };
};

/**
 * React component for rendering LaTeX expressions
 * @param {Object} props - Component props
 * @param {string} props.expression - The LaTeX expression to render
 * @param {string} props.displayMode - Display mode: 'inline' or 'block' (default: 'block')
 * @param {string} props.className - Additional CSS classes
 * @returns {JSX.Element} The rendered math component
 */
export const MathRenderer = ({ 
  expression, 
  displayMode = 'block',
  className = ''
}) => {
  try {
    if (!expression || expression.trim() === '') {
      return (
        <div className={`math-renderer ${className}`}>
          <span style={{ color: '#9ca3af' }}>No expression to render</span>
        </div>
      );
    }

    // Process the expression to handle delimiters
    const { processedExpression, displayMode: detectedMode } = processLatexExpression(expression);
    
    // Use detected mode if available, otherwise use the provided displayMode
    const finalDisplayMode = detectedMode || displayMode;

    let mathComponent;
    if (finalDisplayMode === 'inline') {
      mathComponent = <InlineMath math={processedExpression} />;
    } else {
      mathComponent = <BlockMath math={processedExpression} />;
    }

    return (
      <div className={`math-renderer ${className}`}>
        {mathComponent}
      </div>
    );
  } catch (error) {
    console.error('LaTeX rendering error:', error);
    return (
      <div className={`math-renderer ${className}`}>
        <div className="latex-error" style={{ color: '#ef4444' }}>
          <span>Invalid LaTeX: {expression}</span>
          <br />
          <small>Error: {error.message}</small>
        </div>
      </div>
    );
  }
};

/**
 * Simple function to render LaTeX as a string (for non-React contexts)
 * @param {string} expression - The LaTeX expression
 * @param {string} displayMode - Display mode: 'inline' or 'block'
 * @returns {string} HTML string representation
 */
export const renderLatexToString = (expression, displayMode = 'block') => {
  try {
    const { processedExpression } = processLatexExpression(expression);
    
    if (!processedExpression) {
      return '';
    }

    // This is a simplified version - in a real implementation,
    // you might want to use KaTeX's renderToString function
    return `<span class="latex-${displayMode}">${processedExpression}</span>`;
  } catch (error) {
    return `<span class="latex-error">Invalid LaTeX: ${expression}</span>`;
  }
};

export default MathRenderer;

