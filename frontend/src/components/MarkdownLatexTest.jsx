import React from 'react';
import { MarkdownLatexRenderer } from '../utils/markdownLatexRenderer';

const MarkdownLatexTest = () => {
  const testContent = `To solve this problem, we will use the work-energy principle. This principle states that the work done on an object is equal to the change in its kinetic energy.

### Given:
- Mass of the particle, \\( m = 2 \\, \\text{kg} \\)
- Force, \\( F = 49 \\, \\text{N} \\)
- Angle of incline, \\( \\theta = 30^\\circ \\)
- Coefficient of friction, \\( \\mu = 0.5 \\)
- Distance between points \\( A \\) and \\( B \\), \\( s = 4 \\, \\text{m} \\)
- Initial speed at \\( A \\), \\( u = 10 \\, \\text{m/s} \\)

### Steps:

1. **Calculate the Gravitational Force Component:**
   \\[
   F_{\\text{gravity}} = mg \\sin \\theta = 2 \\times 9.8 \\times \\sin 30^\\circ = 9.8 \\, \\text{N}
   \\]

2. **Calculate the Frictional Force:**
   \\[
   F_{\\text{friction}} = \\mu N = \\mu mg \\cos \\theta = 0.5 \\times 2 \\times 9.8 \\times \\cos 30^\\circ = 8.49 \\, \\text{N}
   \\]

3. **Calculate Net Force:**
   \\[
   F_{\\text{net}} = F - F_{\\text{gravity}} - F_{\\text{friction}} = 49 - 9.8 - 8.49 = 30.71 \\, \\text{N}
   \\]

4. **Calculate Acceleration:**
   \\[
   a = \\frac{F_{\\text{net}}}{m} = \\frac{30.71}{2} = 15.355 \\, \\text{m/s}^2
   \\]

5. **Use Kinematic Equation:**
   \\[
   v^2 = u^2 + 2as
   \\]
   \\[
   v^2 = 10^2 + 2 \\times 15.355 \\times 4 = 100 + 122.84 = 222.84
   \\]
   \\[
   v = \\sqrt{222.84} \\approx 14.92 \\, \\text{m/s}
   \\]

Therefore, the speed of the particle as it passes through point \\( B \\) is approximately \\( 14.92 \\, \\text{m/s} \\).

### Code Example:
\`\`\`
// Calculate final velocity
const u = 10; // initial velocity
const a = 15.355; // acceleration
const s = 4; // distance
const v = Math.sqrt(u*u + 2*a*s);
console.log(\`Final velocity: \${v} m/s\`);
\`\`\``;

  return (
    <div style={{ 
      padding: '20px', 
      maxWidth: '800px', 
      margin: '0 auto',
      backgroundColor: 'var(--primary-bg)',
      color: 'var(--primary-text)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h1>Markdown + LaTeX Rendering Test</h1>
      <p>This component tests the combined Markdown and LaTeX rendering functionality.</p>
      
      <div style={{ 
        marginTop: '20px',
        padding: '20px',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        backgroundColor: 'var(--secondary-bg)'
      }}>
        <h2>Test Content:</h2>
        <MarkdownLatexRenderer content={testContent} />
      </div>
      
      <div style={{ 
        marginTop: '20px',
        padding: '20px',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        backgroundColor: 'var(--secondary-bg)'
      }}>
        <h2>Raw Content:</h2>
        <pre style={{
          background: 'var(--tertiary-bg)',
          padding: '12px',
          borderRadius: '6px',
          overflow: 'auto',
          fontSize: '12px',
          whiteSpace: 'pre-wrap'
        }}>
          {testContent}
        </pre>
      </div>
    </div>
  );
};

export default MarkdownLatexTest;
