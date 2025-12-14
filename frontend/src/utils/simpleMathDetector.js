/**
 * Detects and wraps unambiguous mathematical expressions in LaTeX delimiters.
 * This improved version uses a single, combined regular expression for efficiency
 * and correctly wraps the entire identified equation. It focuses on specific,
 * common formula patterns to minimize false positives on regular text.
 *
 * @param {string | null | undefined} content - The content to process.
 * @returns {string} Content with math expressions wrapped in '$' delimiters.
 */
export function detectAndWrapMath(content) {
  // Return early if content is not a non-empty string.
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Skip if content already contains LaTeX delimiters to avoid double-wrapping
  if (content.includes('$') || content.includes('\\(') || content.includes('\\[')) {
    return content;
  }

  // An array of regex patterns for specific, unambiguous math expressions.
  // This structure makes the patterns easier to read, maintain, and extend.
  const mathPatterns = [
    // Pattern for compound interest formulas, e.g., "A = P(1 + r/n)^(nt)"
    // It matches both variable and numerical versions of this distinct formula.
    '\\b(?:[A-Za-z]|\\d+)\\s*=\\s*(?:[A-Za-z]|\\d+)\\s*\\(\\s*1\\s*\\+\\s*[A-Za-z]\\s*/\\s*[A-Za-z0-9]+\\s*\\)\\s*\\^\\s*\\([A-Za-z0-9*]+\\)',

    // Pattern for simple formulas with an exponent, e.g., "E = mc^2"
    // It identifies a variable on the left and an expression containing a power (^) on the right.
    '\\b[A-Za-z]\\s*=\\s*[A-Za-z0-9]+\\s*\\^\\s*[A-Za-z0-9]+',

    // Pattern for raw LaTeX commands typically used in math
    // Matches \frac{...}{...}, \sqrt{...}, \sum, \int, \times, \div, etc.
    // It ensures we capture the command and some reasonable following context or arguments
    '\\\\(?:frac|sqrt|sum|int|prod|alpha|beta|gamma|Delta|theta|lambda|sigma|pi|mu|infty|times|div|pm|mp|leq|geq|neq|approx|cdot)(?:\\{[^}]*\\}|\\s+)?(?:\\{[^}]*\\})?',

    // Pattern for equations containing specific math operators where neither side is just a single word
    // e.g. "3x + 1 = 10" or "y = 2x - 4"
    // Avoids matching simple text like "Price = 10" unless it looks like math
    '\\b[a-zA-Z0-9]+(?:\\s*[-+*/^]\\s*[a-zA-Z0-9]+)+\\s*=\\s*[a-zA-Z0-9]+(?:\\s*[-+*/^]\\s*[a-zA-Z0-9]+)*',

    // Pattern for numeric/algebraic equalities with LaTeX symbols or exponents
    // e.g. "63=3^{2}\times11" or "105=3x5x7"
    // Matches: start text, equals sign, and right side with math symbols (^, \, times, etc)
    '\\b[0-9a-zA-Z]+\\s*=\\s*[0-9a-zA-Z\\\\{\\}\\^\\times\\+\\-\\*]+'
  ];

  // Combine all patterns into a single RegExp using the OR '|' operator.
  // The 'g' flag ensures all occurrences are matched and replaced.
  const combinedRegex = new RegExp(`(${mathPatterns.join(')|(')})`, 'g');

  // Use a single .replace() call with the combined regex.
  // The callback function wraps the entire matched formula in '$' delimiters.
  return content.replace(combinedRegex, (match) => {
    // Double check it doesn't already have delimiters
    if (match.trim().startsWith('$') || match.trim().startsWith('\\(')) return match;
    return `$${match.trim()}$`;
  });
}