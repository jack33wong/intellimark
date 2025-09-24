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
  
    // An array of regex patterns for specific, unambiguous math expressions.
    // This structure makes the patterns easier to read, maintain, and extend.
    const mathPatterns = [
      // Pattern for compound interest formulas, e.g., "A = P(1 + r/n)^(nt)"
      // It matches both variable and numerical versions of this distinct formula.
      '\\b(?:[A-Za-z]|\\d+)\\s*=\\s*(?:[A-Za-z]|\\d+)\\s*\\(\\s*1\\s*\\+\\s*[A-Za-z]\\s*/\\s*[A-Za-z0-9]+\\s*\\)\\s*\\^\\s*\\([A-Za-z0-9*]+\\)',
  
      // Pattern for simple formulas with an exponent, e.g., "E = mc^2"
      // It identifies a variable on the left and an expression containing a power (^) on the right.
      '\\b[A-Za-z]\\s*=\\s*[A-Za-z0-9]+\\s*\\^\\s*[A-Za-z0-9]+',
    ];
  
    // Combine all patterns into a single RegExp using the OR '|' operator.
    // The 'g' flag ensures all occurrences are matched and replaced.
    const combinedRegex = new RegExp(`(${mathPatterns.join(')|(')})`, 'g');
  
    // Use a single .replace() call with the combined regex.
    // The callback function wraps the entire matched formula in '$' delimiters.
    return content.replace(combinedRegex, (match) => `$${match.trim()}$`);
  }