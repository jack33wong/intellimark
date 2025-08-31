import React, { useMemo } from 'react';
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
  const renderedMath = useMemo(() => {
    try {
      if (!expression || expression.trim() === '') {
        return null;
      }

      // Process the expression to handle delimiters
      const { processedExpression, displayMode: detectedMode } = processLatexExpression(expression);
      
      // Use detected mode if available, otherwise use the provided displayMode
      const finalDisplayMode = detectedMode || displayMode;

      if (finalDisplayMode === 'inline') {
        return <InlineMath math={processedExpression} />;
      } else {
        return <BlockMath math={processedExpression} />;
      }
    } catch (error) {
      console.error('LaTeX rendering error:', error);
      return (
        <div className={`latex-error ${className}`} style={{ color: '#ef4444' }}>
          <span>Invalid LaTeX: {expression}</span>
          <br />
          <small>Error: {error.message}</small>
        </div>
      );
    }
  }, [expression, displayMode, className]);

  return (
    <div className={`math-renderer ${className}`}>
      {renderedMath}
    </div>
  );
};

/**
 * Hook for rendering LaTeX expressions with automatic delimiter detection
 * @param {string} expression - The LaTeX expression to render
 * @param {string} fallbackDisplayMode - Fallback display mode if no delimiters detected
 * @returns {Object} Object containing the rendered component and display mode
 */
export const useLatexRenderer = (expression, fallbackDisplayMode = 'block') => {
  const { processedExpression, displayMode } = processLatexExpression(expression);
  const finalDisplayMode = displayMode || fallbackDisplayMode;

  const renderedComponent = useMemo(() => {
    try {
      if (!processedExpression) {
        return null;
      }

      if (finalDisplayMode === 'inline') {
        return <InlineMath math={processedExpression} />;
      } else {
        return <BlockMath math={processedExpression} />;
      }
    } catch (error) {
      console.error('LaTeX rendering error:', error);
      return (
        <div className="latex-error" style={{ color: '#ef4444' }}>
          <span>Invalid LaTeX: {expression}</span>
          <br />
          <small>Error: {error.message}</small>
        </div>
      );
    }
  }, [processedExpression, finalDisplayMode, expression]);

  return {
    renderedComponent,
    displayMode: finalDisplayMode,
    processedExpression
  };
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

