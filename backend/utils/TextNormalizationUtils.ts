/**
 * Text Normalization Utilities
 * 
 * Provides standardized text normalization for similarity comparison.
 * Used across classification, OCR, and database text to ensure consistent matching.
 * 
 * IMPORTANT: This normalization is ONLY for comparison - original text with spaces
 * is still passed to AI for marking instructions.
 */

/**
 * Normalize text for similarity comparison
 * 
 * This function standardizes text by:
 * 1. Removing LaTeX formatting and delimiters
 * 2. Removing diagram descriptions
 * 3. Converting fractions and math operators
 * 4. Removing all spaces (handles OCR spacing artifacts)
 * 5. Preserving colons (:) and slashes (/) for ratios and fractions
 * 
 * @param text - Text to normalize (classification, OCR, or database text)
 * @returns Normalized text with no spaces, ready for similarity comparison
 * 
 * @example
 * normalizeTextForComparison("$$y = x^2 - 4$$") // Returns: "yx24"
 * normalizeTextForComparison("$y=x^{2}-4$") // Returns: "yx24"
 * normalizeTextForComparison("y = x^2 - 4") // Returns: "yx24"
 */
export function normalizeTextForComparison(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Remove diagram descriptions from database text (e.g., "[A coordinate grid shows...]")
  // Classification doesn't extract question diagrams, so we shouldn't compare against diagram descriptions
  let normalized = text
    .replace(/\[.*?\]/g, '') // Remove [diagram description] blocks
    // Remove LaTeX formatting: \( \), \[ \], \frac{}{}, \times, etc.
    .replace(/\\\(|\\\)/g, '') // Remove \( and \)
    .replace(/\\\[|\\\]/g, '') // Remove \[ and \]
    // IMPORTANT: Handle mixed numbers BEFORE converting \frac{}{} to a/b
    // Pattern: digit + \frac{}{} → "digit fraction" (e.g., "3\frac{4}{5}" → "3 4/5")
    .replace(/(\d+)\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 $2/$3') // Mixed numbers: 3\frac{4}{5} → 3 4/5
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2') // Standalone fractions: \frac{a}{b} → a/b
    .replace(/\\times/g, 'x') // Convert \times to x
    .replace(/\\cdot/g, '*') // Convert \cdot to *
    .replace(/\\mathrm\{([^}]+)\}/g, '$1') // Remove \mathrm{}
    .replace(/\\mathbf\{([^}]+)\}/g, '$1') // Remove \mathbf{} (e.g., \mathbf{A} → A)
    .replace(/\\mathit\{([^}]+)\}/g, '$1') // Remove \mathit{}
    .replace(/\\text\{([^}]+)\}/g, '$1') // Remove \text{}
    .replace(/\\/g, '') // Remove any remaining backslashes
    .replace(/\{|\}/g, '') // Remove braces
    .replace(/\$+/g, '') // Remove $ signs
  
  // Remove question number prefixes (e.g., "1 ", "2 (a)", "Q1 ", "Question 1")
  // BUT: Only if followed by common question words or if it's clearly a question number pattern
  // Don't remove numbers that are part of math expressions (e.g., "35 / 24")
  normalized = normalized
    .replace(/^q\d+[a-z]?\s+/i, '') // Remove "Q1 ", "Q2a ", etc.
    .replace(/^question\s+\d+[a-z]?\s+/i, '') // Remove "Question 1 ", etc.
    .replace(/^\d+[a-z]?\s*\([a-z]\)\s*/i, '') // Remove "2 (a) ", etc.
    // Only remove question number patterns if followed by question words (work, find, calculate, etc.)
    // CRITICAL: Don't remove if followed by math operators (=, +, -, /, ×, etc.) - this is a math expression
    // Match: "35 /" or "35=" or "35 +" etc. should NOT be removed (they're part of math)
    // Only remove if followed by question words like "35 work" or "35 find" (which shouldn't happen, but be safe)
    .replace(/^(\d+[a-z]?)\s+(?![+\-×÷*/=])/i, (match, num, offset, string) => {
      // Check what comes after the number and space
      const after = string.substring(offset + match.length);
      // If followed by math operator or number, keep it (it's part of a math expression)
      if (/^[+\-×÷*/=\d]/.test(after)) {
        return match; // Keep it (part of math expression like "35 / 24")
      }
      // If followed by question words, remove it (it's a question number)
      if (/^(work|find|calculate|simplify|solve|show|prove|write|draw|explain|state|give|describe|complete|fill|here|the|this|a\s|an\s|is|are|was|were)/i.test(after)) {
        return ''; // Remove it (it's a question number)
      }
      // Default: keep it (better safe than sorry - might be part of math expression)
      return match;
    })
  
  normalized = normalized
    .toLowerCase()
    // Preserve colons (:) for ratio notation (e.g., "3:4", "S:M:L")
    // Remove other punctuation but keep / for fractions and : for ratios
    .replace(/[^\w\s/:]/g, '') // Remove punctuation (keep / for fractions, : for ratios, word chars)
    // Remove ALL spaces for similarity checking (simplifies matching, handles all OCR spacing artifacts)
    // Note: This is only for comparison - original text with spaces is still passed to AI
    .replace(/\s+/g, '') // Remove all spaces
    .trim();
  
  // Normalize sign variations: \frac{5}{x} and -\frac{5}{x} should match
  // Only normalize fractions (not other expressions) to avoid false matches
  // This handles cases where classification returns different sign than database
  // Remove negative before 'frac' anywhere in the string (not just at start)
  // After normalization, "y-frac5/x" becomes "yfrac5/x" to match "yfrac5/x"
  if (normalized.includes('frac')) {
    normalized = normalized.replace(/-frac/g, 'frac'); // Remove negative before 'frac' anywhere
  }
  
  return normalized;
}

/**
 * Extract base question number from a question number string
 * 
 * Extracts the leading numeric part, handling:
 * - Simple numbers: "12" -> "12"
 * - Sub-questions with letters: "2a" -> "2", "12ii" -> "12", "12iii" -> "12"
 * - Prefixed numbers: "Q12ii" -> "12"
 * 
 * @param questionNumber - Question number string (e.g., "12ii", "2a", "Q12", "21")
 * @returns Base numeric part (e.g., "12", "2", "21"), or empty string if no digits found
 * 
 * @example
 * getBaseQuestionNumber("12ii") // Returns: "12"
 * getBaseQuestionNumber("2a") // Returns: "2"
 * getBaseQuestionNumber("Q12ii") // Returns: "12"
 * getBaseQuestionNumber("21") // Returns: "21"
 * getBaseQuestionNumber(null) // Returns: ""
 */
export function getBaseQuestionNumber(questionNumber: string | null | undefined): string {
  if (!questionNumber) return '';
  const qNumStr = String(questionNumber);
  // Extract leading digits (more reliable than removing letters)
  // Examples: "12ii" -> "12", "12iii" -> "12", "2a" -> "2", "21" -> "21", "Q12ii" -> "12"
  const match = qNumStr.match(/^\d+/);
  return match ? match[0] : '';
}

/**
 * Normalize LaTeX delimiters to consistent $ format
 * 
 * Converts all LaTeX delimiter formats to $ delimiters for consistency:
 * - \( ... \) → $ ... $
 * - \[ ... \] → $ ... $
 * - Removes spaces around $ delimiters
 * 
 * This ensures marking scheme and OCR text use the same delimiter format
 * so AI can properly match them.
 * 
 * @param text - Text with LaTeX delimiters
 * @returns Text with normalized $ delimiters
 * 
 * @example
 * normalizeLatexDelimiters("\\( 3 \\sqrt{5} \\)") // Returns: "$3\\sqrt{5}$"
 * normalizeLatexDelimiters("\\[ x^2 \\]") // Returns: "$x^2$"
 */
export function normalizeLatexDelimiters(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }
  
  // Replace \( ... \) with $ ... $ (non-greedy match to handle nested cases)
  text = text.replace(/\\\(([^\\]*?)\\\)/g, '$$1$');
  // Replace \[ ... \] with $ ... $ (display math to inline)
  text = text.replace(/\\\[([^\\]*?)\\\]/g, '$$1$');
  // Remove any remaining standalone \( or \) that weren't matched (cleanup)
  text = text.replace(/\\\(/g, '');
  text = text.replace(/\\\)/g, '');
  text = text.replace(/\\\[/g, '');
  text = text.replace(/\\\]/g, '');
  // Normalize spaces around $ delimiters (remove spaces immediately after $ and before $)
  // This helps match: "$ 3 \sqrt{5} $" with "3$sqrt{5}$" in marking scheme
  text = text.replace(/\$\s+/g, '$');
  text = text.replace(/\s+\$/g, '$');
  
  return text;
}

/**
 * Normalize sub-question part for consistent comparison
 * Handles various formats: "(i)", "i", "(I)", "I", "ii", "(ii)", etc.
 * 
 * @param part - Sub-question part from classification or question number (e.g., "(i)", "i", "ii", "(ii)")
 * @returns Normalized sub-question part in lowercase (e.g., "i", "ii", "iii", "a", "b")
 * 
 * @example
 * normalizeSubQuestionPart("(i)") // Returns: "i"
 * normalizeSubQuestionPart("i") // Returns: "i"
 * normalizeSubQuestionPart("(I)") // Returns: "i"
 * normalizeSubQuestionPart("(ii)") // Returns: "ii"
 * normalizeSubQuestionPart("ii") // Returns: "ii"
 */
export function normalizeSubQuestionPart(part: string | null | undefined): string {
  if (!part || typeof part !== 'string') {
    return '';
  }
  
  // Remove parentheses, spaces, and convert to lowercase
  // Handles: "(i)", "i", "(I)", "I", " (i) ", etc.
  return part
    .trim()
    .replace(/[()]/g, '') // Remove parentheses
    .replace(/\s+/g, '') // Remove spaces
    .toLowerCase(); // Convert to lowercase
}

/**
 * Format full question text with proper numbering and labels
 * 
 * Formats question text in the standard format:
 * - Main question: "{baseQuestionNumber}. {mainQuestionText}"
 * - Sub-questions: "{part}) {subQuestionText}"
 * 
 * Used consistently for:
 * - AI Marking Instruction prompts
 * - detectedQuestion storage
 * - Model Answer prompts
 * 
 * @param baseQuestionNumber - Base question number (e.g., "5")
 * @param mainQuestionText - Main question text (e.g., "Sophie drives...")
 * @param subQuestionNumbers - Array of full sub-question numbers (e.g., ["5a", "5b"])
 * @param subQuestionTexts - Array of sub-question texts (e.g., ["Work out...", "Is your answer..."])
 * @returns Formatted full question text with proper numbering and labels
 * 
 * @example
 * formatFullQuestionText(
 *   "5",
 *   "Sophie drives a distance of 513 kilometres...",
 *   ["5a", "5b"],
 *   ["Work out an estimate...", "Is your answer..."]
 * )
 * // Returns:
 * // "5. Sophie drives a distance of 513 kilometres...
 * //
 * // a) Work out an estimate...
 * //
 * // b) Is your answer..."
 */
export function formatFullQuestionText(
  baseQuestionNumber: string,
  mainQuestionText: string,
  subQuestionNumbers: string[],
  subQuestionTexts: string[]
): string {
  const parts: string[] = [];
  
  // Format main question with number prefix
  if (mainQuestionText) {
    parts.push(`${baseQuestionNumber}. ${mainQuestionText}`);
  }
  
  // Format sub-questions with labels
  if (subQuestionNumbers.length > 0 && subQuestionTexts.length > 0) {
    const formattedSubQuestions = subQuestionTexts.map((subQText, index) => {
      if (index < subQuestionNumbers.length) {
        const fullSubQNum = subQuestionNumbers[index]; // e.g., "5a"
        const subQPart = fullSubQNum.replace(/^\d+/, ''); // Extract "a" from "5a"
        return `${subQPart}) ${subQText}`;
      }
      return subQText; // Fallback if no matching number
    });
    parts.push(...formattedSubQuestions);
  }
  
  return parts.join('\n\n');
}

/**
 * Extract question numbers from filename (e.g., "q19.png" -> ["19"], "q13-14.png" -> ["13", "14"])
 * @param fileName - The filename to extract question numbers from
 * @returns Array of question numbers found in filename, or null if none found
 */
export function extractQuestionNumberFromFilename(fileName?: string): string[] | null {
  if (!fileName) return null;
  
  // Extract question numbers from filename patterns like "q13-14", "q21", etc.
  const matches = fileName.toLowerCase().match(/q(\d+[a-z]?)/g);
  return matches ? matches.map(m => m.replace('q', '')) : null;
}

