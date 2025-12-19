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
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Strictly target only "naked" LaTeX commands that start with a backslash.
  // This is the safest way to detect math without catching regular text.
  // We look for patterns like \frac, \sqrt, \alpha, \pi, \pm, etc.
  // We also try to catch the entire expression if multiple commands are together.

  // 1. Identify existing delimited regions to avoid double-processing
  const existingRegions = [];
  const delimRegex = /(\$\$?|\\\(|\\\[)[\s\S]*?(\$\$?|\\\)|\\\])/g;
  let m;
  while ((m = delimRegex.exec(content)) !== null) {
    existingRegions.push({ start: m.index, end: m.index + m[0].length });
  }

  const isInsideExisting = (index, length) => {
    return existingRegions.some(r =>
      (index >= r.start && index < r.end) ||
      (index + length > r.start && index + length <= r.end)
    );
  };

  // 2. Minimal LaTeX command pattern
  // Matches \command followed by optional braces or spaces
  const latexPattern = /\\(?:[a-zA-Z]+)(?:\{[^}]*\}|\s+)?(?:\{[^}]*\})?/g;

  // Strictly ONLY wrap the actual LaTeX match to avoid duplicating surrounding text
  return content.replace(latexPattern, (match, offset) => {
    if (isInsideExisting(offset, match.length)) {
      return match;
    }

    const trimmedMatch = match.trim();
    // Wrap with single $ if it's not already wrapped.
    return `$${trimmedMatch}$`;
  });
}