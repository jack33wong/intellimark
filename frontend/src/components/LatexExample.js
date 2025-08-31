import React from 'react';
import { MathRenderer, useLatexRenderer, processLatexExpression } from '../utils/latexRenderer';

/**
 * Example component showing different ways to use the LaTeX renderer
 * @returns {JSX.Element} Example component
 */
function LatexExample() {
  // Example 1: Using the MathRenderer component directly
  const example1 = <MathRenderer expression="E = mc^2" displayMode="block" />;
  
  // Example 2: Using the hook for automatic delimiter detection
  const { renderedComponent: example2 } = useLatexRenderer("\\[x^2 + y^2 = z^2\\]");
  
  // Example 3: Using the utility function to process expressions
  const { processedExpression, displayMode } = processLatexExpression("\\(\\frac{1}{2}\\)");
  
  // Example 4: Inline math in text
  const example4 = (
    <p>
      The quadratic formula is: <MathRenderer expression="x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" displayMode="inline" />
    </p>
  );

  return (
    <div style={{ padding: '20px', background: '#1f2937', borderRadius: '8px', margin: '20px 0' }}>
      <h3 style={{ color: '#f3f4f6', marginBottom: '16px' }}>LaTeX Renderer Examples</h3>
      
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ color: '#9ca3af', marginBottom: '8px' }}>Example 1: Direct Component Usage</h4>
        {example1}
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ color: '#9ca3af', marginBottom: '8px' }}>Example 2: Hook with Auto-Detection</h4>
        {example2}
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ color: '#9ca3af', marginBottom: '8px' }}>Example 3: Utility Function</h4>
        <p style={{ color: '#f3f4f6' }}>
          Processed: "{processedExpression}" | Mode: {displayMode}
        </p>
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ color: '#9ca3af', marginBottom: '8px' }}>Example 4: Inline in Text</h4>
        <div style={{ color: '#f3f4f6' }}>
          {example4}
        </div>
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ color: '#9ca3af', marginBottom: '8px' }}>Example 5: Different Delimiters</h4>
        <div style={{ color: '#f3f4f6' }}>
          <p>Traditional block: <MathRenderer expression="\\[\\pi\\]" /></p>
          <p>Traditional inline: <MathRenderer expression="\\(\\pi\\)" /></p>
          <p>Markdown block: <MathRenderer expression="$$\\pi$$" /></p>
          <p>Markdown inline: <MathRenderer expression="$\\pi$" /></p>
          <p>No delimiters: <MathRenderer expression="\\pi" displayMode="inline" /></p>
        </div>
      </div>
    </div>
  );
}

export default LatexExample;

