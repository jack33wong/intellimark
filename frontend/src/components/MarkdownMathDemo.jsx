import React, { useState } from 'react';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import './MarkdownMathDemo.css';

/**
 * MarkdownMathDemo - Demo component showcasing the MarkdownMathRenderer
 * 
 * Features:
 * - Interactive examples of Markdown + LaTeX rendering
 * - Live preview with custom input
 * - Pre-built examples demonstrating various features
 * - Toggle between different example content
 */
const MarkdownMathDemo = () => {
  const [customInput, setCustomInput] = useState('');
  const [selectedExample, setSelectedExample] = useState('basic');

  // Pre-built examples
  const examples = {
    basic: {
      title: 'Basic Math Examples',
      content: `# Basic Mathematical Expressions

This is a simple example showing inline and block math.

## Inline Math
The Pythagorean theorem states that $a^2 + b^2 = c^2$ for a right triangle.

## Block Math
Einstein's famous equation:

$$E = mc^2$$

## More Examples
- Quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$
- Sum notation: $\\sum_{i=1}^{n} x_i = x_1 + x_2 + \\cdots + x_n$
- Integral: $\\int_{0}^{\\infty} e^{-x} dx = 1$`
    },
    
    physics: {
      title: 'Physics Problem',
      content: `# Physics Problem Solution

## Given
- Mass of the particle: $m = 2 \\, \\text{kg}$
- Force applied: $F = 49 \\, \\text{N}$
- Angle of incline: $\\theta = 30^\\circ$
- Coefficient of friction: $\\mu = 0.5$

## Solution Steps

### 1. Calculate Gravitational Force Component
$$F_{\\text{gravity}} = mg \\sin \\theta = 2 \\times 9.8 \\times \\sin 30^\\circ = 9.8 \\, \\text{N}$$

### 2. Calculate Frictional Force
$$F_{\\text{friction}} = \\mu N = \\mu mg \\cos \\theta = 0.5 \\times 2 \\times 9.8 \\times \\cos 30^\\circ = 8.49 \\, \\text{N}$$

### 3. Calculate Net Force
$$F_{\\text{net}} = F - F_{\\text{gravity}} - F_{\\text{friction}} = 49 - 9.8 - 8.49 = 30.71 \\, \\text{N}$$

### 4. Calculate Acceleration
$$a = \\frac{F_{\\text{net}}}{m} = \\frac{30.71}{2} = 15.355 \\, \\text{m/s}^2$$

### 5. Use Kinematic Equation
$$v^2 = u^2 + 2as$$

Where:
- $u$ = initial velocity
- $v$ = final velocity  
- $a$ = acceleration
- $s$ = distance`
    },
    
    advanced: {
      title: 'Advanced Mathematics',
      content: `# Advanced Mathematical Concepts

## Matrix Operations

### Identity Matrix
$$I = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}$$

### Matrix Multiplication
$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\begin{pmatrix} e & f \\\\ g & h \\end{pmatrix} = \\begin{pmatrix} ae+bg & af+bh \\\\ ce+dg & cf+dh \\end{pmatrix}$$

## Calculus

### Derivatives
The derivative of $f(x) = x^2$ is $f'(x) = 2x$

### Partial Derivatives
$$\\frac{\\partial f}{\\partial x} = 2x + y$$
$$\\frac{\\partial f}{\\partial y} = x + 2y$$

### Multiple Integrals
$$\\int_{0}^{1} \\int_{0}^{1} (x + y) \\, dx \\, dy = 1$$

## Statistics

### Normal Distribution
$$f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$$

### Expected Value
$$E[X] = \\sum_{i=1}^{n} x_i P(x_i)$$

## Quantum Mechanics

### Schrödinger Equation
$$i\\hbar \\frac{\\partial}{\\partial t} \\Psi(\\mathbf{r}, t) = \\hat{H} \\Psi(\\mathbf{r}, t)$$

### Uncertainty Principle
$$\\Delta x \\Delta p \\geq \\frac{\\hbar}{2}$$`
    },
    
    mixed: {
      title: 'Mixed Content Example',
      content: `# Mixed Content with Markdown and Math

This example shows how **Markdown formatting** and *LaTeX math* work together seamlessly.

## Text with Inline Math

The quadratic equation $ax^2 + bx + c = 0$ has solutions given by:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

## Lists with Math

Here's a list of mathematical constants:

1. **Pi**: $\\pi \\approx 3.14159$
2. **Euler's number**: $e \\approx 2.71828$
3. **Golden ratio**: $\\phi = \\frac{1 + \\sqrt{5}}{2} \\approx 1.61803$

## Code and Math

Here's some JavaScript code that calculates the area of a circle:

\`\`\`javascript
function calculateArea(radius) {
  return Math.PI * radius * radius; // πr²
}
\`\`\`

The mathematical formula is: $A = \\pi r^2$

## Blockquotes with Math

> **Important Note**: The derivative of $f(x) = x^n$ is $f'(x) = nx^{n-1}$

## Tables with Math

| Function | Derivative | Integral |
|----------|------------|----------|
| $x^2$ | $2x$ | $\\frac{x^3}{3} + C$ |
| $\\sin(x)$ | $\\cos(x)$ | $-\\cos(x) + C$ |
| $e^x$ | $e^x$ | $e^x + C$ |

## Links and Math

Check out this [mathematical resource](https://example.com) for more information about $\\LaTeX$ syntax.`
    },
    
    delimiters: {
      title: 'Different Delimiters',
      content: `# Testing Different LaTeX Delimiters

This example demonstrates that our renderer supports multiple LaTeX delimiter formats.

## Standard Delimiters

### Inline Math with $...$
The Pythagorean theorem: $a^2 + b^2 = c^2$

### Block Math with $$...$$
Einstein's equation:
$$E = mc^2$$

## LaTeX Delimiters

### Inline Math with \\(...\\)
The quadratic formula: \\(x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\)

### Block Math with \\[...\\]
Your test equation:
\\[ F_{\\text{gravity}} = mg \\sin \\theta = 2 \\times 9.8 \\times \\sin 30^\\circ = 9.8 \\, \\text{N} \\]

## Mixed Usage

You can use both formats in the same document:

- Standard: $\\pi \\approx 3.14159$
- LaTeX: \\(\\pi \\approx 3.14159\\)

- Standard: $$\\int_{0}^{\\infty} e^{-x} dx = 1$$
- LaTeX: \\[\\int_{0}^{\\infty} e^{-x} dx = 1\\]

## Your Test Case

1. **Calculate the Gravitational Force Component:** \\[ F_{\\text{gravity}} = mg \\sin \\theta = 2 \\times 9.8 \\times \\sin 30^\\circ = 9.8 \\, \\text{N} \\]

This should render as a proper block equation!`
    }
  };

  return (
    <div className="markdown-math-demo">
      <div className="demo-header">
        <h1>Markdown + LaTeX Renderer Demo</h1>
        <p>A production-ready component for rendering Markdown with LaTeX mathematical expressions</p>
      </div>

      <div className="demo-content">
        <div className="demo-sidebar">
          <h3>Examples</h3>
          <div className="example-buttons">
            {Object.entries(examples).map(([key, example]) => (
              <button
                key={key}
                className={`example-btn ${selectedExample === key ? 'active' : ''}`}
                onClick={() => setSelectedExample(key)}
              >
                {example.title}
              </button>
            ))}
          </div>

          <div className="custom-input-section">
            <h3>Custom Input {customInput.trim() && <span className="active-indicator">(Active)</span>}</h3>
            <textarea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Enter your own Markdown + LaTeX content here..."
              rows={8}
            />
            <button 
              className="clear-btn"
              onClick={() => setCustomInput('')}
              disabled={!customInput.trim()}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="demo-main">
          <div className="renderer-container">
            <h2>Rendered Output</h2>
            <div className="renderer-content">
              <MarkdownMathRenderer 
                content={customInput.trim() || examples[selectedExample].content}
                className="demo-renderer"
              />
            </div>
          </div>

          <div className="source-container">
            <h2>Source Code</h2>
            <pre className="source-code">
              <code>{customInput.trim() || examples[selectedExample].content}</code>
            </pre>
          </div>
        </div>
      </div>

      <div className="demo-footer">
        <h3>Features</h3>
        <ul>
          <li>✅ **Inline math** with $...$ and \(...\) delimiters</li>
          <li>✅ **Block math** with $$...$$ and \[...\] delimiters</li>
          <li>✅ **Full Markdown support** (headings, lists, tables, etc.)</li>
          <li>✅ **KaTeX rendering** for high-quality math</li>
          <li>✅ **Error handling** for invalid LaTeX</li>
          <li>✅ **Responsive design** with dark mode support</li>
          <li>✅ **Production-ready** with TypeScript support</li>
        </ul>
      </div>
    </div>
  );
};

export default MarkdownMathDemo;
