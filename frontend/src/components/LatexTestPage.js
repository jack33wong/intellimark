import React, { useState } from 'react';
import { Code, Play, RotateCcw, Copy, Check } from 'lucide-react';
import { MathRenderer, processLatexExpression } from '../utils/latexRenderer';
import './LatexTestPage.css';

const LatexTestPage = () => {
  const [inputExpression, setInputExpression] = useState('');
  const [displayMode, setDisplayMode] = useState('block');
  const [copied, setCopied] = useState(false);
  const [testHistory, setTestHistory] = useState([]);

  // Predefined examples for quick testing
  const examples = [
    { name: 'Basic Math', expression: 'E = mc^2', mode: 'inline' },
    { name: 'Quadratic Formula', expression: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', mode: 'block' },
    { name: 'Integral', expression: '\\int_{0}^{\\infty} e^{-x} dx = 1', mode: 'block' },
    { name: 'Matrix', expression: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', mode: 'block' },
    { name: 'Sum', expression: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', mode: 'block' },
    { name: 'Greek Letters', expression: '\\alpha, \\beta, \\gamma, \\pi, \\theta', mode: 'inline' },
    { name: 'Fractions', expression: '\\frac{1}{2} + \\frac{1}{3} = \\frac{5}{6}', mode: 'inline' },
    { name: 'Powers and Subscripts', expression: 'x^2 + y_1 = z^{n+1}', mode: 'inline' }
  ];

  const handleTest = () => {
    if (!inputExpression.trim()) return;

    const newTest = {
      id: Date.now(),
      expression: inputExpression,
      displayMode,
      timestamp: new Date().toISOString()
    };

    setTestHistory(prev => [newTest, ...prev.slice(0, 9)]); // Keep last 10 tests
  };

  const handleExampleClick = (example) => {
    setInputExpression(example.expression);
    setDisplayMode(example.mode);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inputExpression);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleClear = () => {
    setInputExpression('');
    setDisplayMode('block');
  };

  const { displayMode: detectedMode } = processLatexExpression(inputExpression);
  const finalDisplayMode = detectedMode || displayMode;

  return (
    <div className="latex-test-page">
      <div className="latex-test-header">
        <h1>LaTeX Testing</h1>
        <p>Test and preview LaTeX mathematical expressions in real-time</p>
      </div>

      <div className="latex-test-content">
        <div className="input-section">
          <div className="input-controls">
            <div className="expression-input">
              <label htmlFor="latex-input">LaTeX Expression:</label>
              <textarea
                id="latex-input"
                value={inputExpression}
                onChange={(e) => setInputExpression(e.target.value)}
                placeholder="Enter LaTeX expression (e.g., E = mc^2, \\frac{1}{2}, \\int_{0}^{\\infty})"
                rows={4}
              />
            </div>

            <div className="display-mode-selector">
              <label htmlFor="display-mode">Display Mode:</label>
              <select
                id="display-mode"
                value={displayMode}
                onChange={(e) => setDisplayMode(e.target.value)}
              >
                <option value="block">Block (Centered)</option>
                <option value="inline">Inline</option>
                <option value="auto">Auto-detect</option>
              </select>
            </div>

            <div className="action-buttons">
              <button className="test-btn" onClick={handleTest} disabled={!inputExpression.trim()}>
                <Play size={16} />
                Test Expression
              </button>
              <button className="copy-btn" onClick={handleCopy} disabled={!inputExpression.trim()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button className="clear-btn" onClick={handleClear}>
                <RotateCcw size={16} />
                Clear
              </button>
            </div>
          </div>

          <div className="preview-section">
            <h3>Live Preview</h3>
            <div className="preview-container">
              {inputExpression.trim() ? (
                <MathRenderer 
                  expression={inputExpression} 
                  displayMode={finalDisplayMode}
                />
              ) : (
                <div className="preview-placeholder">
                  <Code size={48} />
                  <p>Enter a LaTeX expression to see the preview</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="examples-section">
          <h3>Quick Examples</h3>
          <div className="examples-grid">
            {examples.map((example, index) => (
              <button
                key={index}
                className="example-btn"
                onClick={() => handleExampleClick(example)}
              >
                <div className="example-name">{example.name}</div>
                <div className="example-expression">{example.expression}</div>
              </button>
            ))}
          </div>
        </div>

        {testHistory.length > 0 && (
          <div className="history-section">
            <h3>Test History</h3>
            <div className="history-list">
              {testHistory.map((test) => (
                <div key={test.id} className="history-item">
                  <div className="history-expression">
                    <MathRenderer 
                      expression={test.expression} 
                      displayMode={test.displayMode}
                    />
                  </div>
                  <div className="history-details">
                    <code className="history-code">{test.expression}</code>
                    <span className="history-timestamp">
                      {new Date(test.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LatexTestPage;
