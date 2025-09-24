/**
 * Simple math detector that wraps obvious math expressions in LaTeX delimiters
 * @param {string} content - The content to process
 * @returns {string} Content with math expressions wrapped in $ delimiters
 */
export function detectAndWrapMath(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  let processedContent = content;

  // Only catch specific math patterns that we know are mathematical
  // Pattern 1: A = P (1 + r/n)^(nt) - compound interest formula
  processedContent = processedContent.replace(/\b([A-Za-z])\s*=\s*([A-Za-z]\s*\(\s*1\s*\+\s*[A-Za-z]\/[A-Za-z]\s*\)\^\([A-Za-z0-9]+\))/g, (match, var1, expression) => {
    return `${var1} = $${expression.trim()}$`;
  });

  // Pattern 2: 2000 = 1000(1 + r/1)^(1*5) - numerical equations
  processedContent = processedContent.replace(/\b(\d+)\s*=\s*(\d+\(\s*1\s*\+\s*[A-Za-z]\/[A-Za-z0-9]\s*\)\^\([A-Za-z0-9\s*]+\))/g, (match, var1, expression) => {
    return `${var1} = $${expression.trim()}$`;
  });

  // Pattern 3: E = mc^2 - simple formulas
  processedContent = processedContent.replace(/\b([A-Za-z])\s*=\s*([A-Za-z0-9]+\^[0-9]+)/g, (match, var1, expression) => {
    return `${var1} = $${expression.trim()}$`;
  });

  return processedContent;
}