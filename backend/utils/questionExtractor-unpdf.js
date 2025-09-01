const { extractText } = require('unpdf');
const fs = require('fs');

/**
 * Extract questions from PDF using unpdf library for better structure preservation
 * @param {string} filePath - Path to the PDF file
 * @returns {Object} Extraction result with questions and metadata
 */
async function extractQuestionsFromPDF(filePath) {
  try {
    console.log(`Starting PDF extraction with unpdf: ${filePath}`);
    
    // Read PDF file and convert to Uint8Array
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfArray = new Uint8Array(pdfBuffer);
    
    // Extract text using unpdf
    const result = await extractText(pdfArray);
    
    if (!result || !result.text || !Array.isArray(result.text)) {
      throw new Error('Invalid result from unpdf extraction');
    }
    
    console.log(`PDF has ${result.totalPages} pages`);
    
    // Extract questions using page-by-page approach
    const questions = identifyAndProcessQuestions(result.text);
    
    // Count questions with sub-questions
    const questionsWithSubQuestions = questions.filter(q => 
      q.subQuestions && q.subQuestions.length > 0
    );
    
    const extractionResult = {
      success: true,
      questions: questions,
      totalQuestions: questions.length,
      questionsWithSubQuestions: questionsWithSubQuestions.length,
      questionCount: questions.length,
      subQuestionCount: questionsWithSubQuestions.length
    };
    
    console.log(`Extraction successful: ${questions.length} questions, ${questionsWithSubQuestions.length} with sub-questions`);
    return extractionResult;
    
  } catch (error) {
    console.error('Error extracting questions from PDF:', error);
    return {
      success: false,
      error: error.message,
      questions: [],
      totalQuestions: 0,
      questionsWithSubQuestions: 0,
      questionCount: 0,
      subQuestionCount: 0
    };
  }
}

/**
 * Identify and process questions from the extracted text array (per page)
 * @param {Array} pageTexts - Array of text from each page
 * @returns {Array} Array of processed question objects
 */
function identifyAndProcessQuestions(pageTexts) {
  const questions = new Map();
  
  // First pass: collect all content for each question number
  pageTexts.forEach((pageText, pageIndex) => {
    if (pageText.includes('END OF QUESTIONS')) return;
    
    // Look for question patterns: "7 Here is a cone", "7 (a)", etc.
    const lines = pageText.split('\n');
    let currentQuestion = null;
    let currentContent = [];
    
    lines.forEach(line => {
      // Check if line starts with a question number
      const questionMatch = line.match(/^(\d+)\s+(.*)$/);
      if (questionMatch) {
        const qNum = parseInt(questionMatch[1]);
        if (qNum >= 1 && qNum <= 30) {
          // Save previous question if exists
          if (currentQuestion && currentContent.length > 0) {
            const content = currentContent.join('\n').trim();
            if (questions.has(currentQuestion)) {
              questions.get(currentQuestion).content += '\n' + content;
            } else {
              questions.set(currentQuestion, { questionNumber: currentQuestion, content: content });
            }
          }
          
          // Start new question
          currentQuestion = questionMatch[1];
          currentContent = [questionMatch[2]];
          return;
        }
      }
      
      // Add line to current question content
      if (currentQuestion) {
        currentContent.push(line);
      }
    });
    
    // Save last question
    if (currentQuestion && currentContent.length > 0) {
      const content = currentContent.join('\n').trim();
      if (questions.has(currentQuestion)) {
        questions.get(currentQuestion).content += '\n' + content;
      } else {
        questions.set(currentQuestion, { questionNumber: currentQuestion, content: content });
      }
    }
  });
  
  // Process all questions
  const processedQuestions = [];
  questions.forEach((questionData) => {
    if (isValidQuestionContent(questionData.content)) {
      const processedQuestion = processQuestion(questionData.questionNumber, questionData.content);
      if (processedQuestion) {
        processedQuestions.push(processedQuestion);
      }
    }
  });
  
  processedQuestions.sort((a, b) => parseInt(a.questionNumber) - parseInt(b.questionNumber));
  return processedQuestions;
}

/**
 * Process a single question and extract its components
 * @param {string} questionNumber - The question number
 * @param {string} content - The question content
 * @returns {Object} Processed question object
 */
function processQuestion(questionNumber, content) {
  // Clean up the content
  const cleanContent = cleanQuestionContent(content);
  
  // Extract sub-questions
  const subQuestions = extractSubQuestions(cleanContent);
  
  // Extract marks
  const marks = extractMarks(cleanContent);
  
  // Extract math expression
  const mathExpression = extractMathExpression(cleanContent);
  
  return {
    questionNumber: questionNumber,
    text: cleanContent,
    marks: marks,
    subQuestions: subQuestions,
    mathExpression: mathExpression,
    latex: convertToLatex(mathExpression),
    unicode: convertToUnicode(mathExpression),
    lineNumber: 0
  };
}

/**
 * Clean question content by removing artifacts and normalizing text
 * @param {string} content - Raw question content
 * @returns {string} Cleaned content
 */
function cleanQuestionContent(content) {
  if (!content) return '';
  
  let cleaned = content;
  
  // Remove page breaks
  cleaned = cleaned.replace(/--- PAGE BREAK ---/g, '\n');
  
  // Remove page markers and headers
  cleaned = cleaned.replace(/\*\d+\*/g, '');
  cleaned = cleaned.replace(/IB\/[MJ]\/\w+\/\d+\/\w+/g, '');
  cleaned = cleaned.replace(/Turn over.*?►/gi, '');
  cleaned = cleaned.replace(/Do not write outside the box/gi, '');
  
  // Normalize whitespace
  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\r/g, '\n');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  cleaned = cleaned.replace(/\n /g, '\n');
  cleaned = cleaned.replace(/ \n/g, '\n');
  
  return cleaned.trim();
}

/**
 * Extract sub-questions from question content
 * @param {string} content - Question content
 * @returns {Array} Array of sub-question objects
 */
function extractSubQuestions(content) {
  const subQuestions = [];
  
  // Pattern for detecting sub-questions like "7 (a)", "7(a)", "(a)", etc.
  const subQuestionPatterns = [
    // Pattern 1: Number followed by (letter): 7 (a), 7(a)
    /(\d+)\s*\(([a-z])\)\s*([^]*?)(?=\d+\s*\([a-z]\)|$)/gi,
    
    // Pattern 2: Just (letter): (a), (b), (c)
    /\(([a-z])\)\s*([^]*?)(?=\([a-z]\)|$)/gi
  ];
  
  for (const pattern of subQuestionPatterns) {
    let match;
    pattern.lastIndex = 0; // Reset regex
    
    while ((match = pattern.exec(content)) !== null) {
      let subQuestionNumber, subQuestionText;
      
      if (match.length === 4) {
        // Pattern 1: has question number
        subQuestionNumber = match[2];
        subQuestionText = match[3].trim();
      } else {
        // Pattern 2: just letter
        subQuestionNumber = match[1];
        subQuestionText = match[2].trim();
      }
      
      // Validate sub-question content
      if (subQuestionText.length > 5 && 
          /[a-zA-Z]/.test(subQuestionText) &&
          !subQuestions.find(sq => sq.subQuestionNumber === subQuestionNumber)) {
        
        subQuestions.push({
          subQuestionNumber: subQuestionNumber,
          text: subQuestionText,
          marks: extractMarks(subQuestionText),
          lineNumber: 0
        });
      }
    }
    
    // If we found sub-questions with this pattern, use them
    if (subQuestions.length > 0) break;
  }
  
  // Sort sub-questions alphabetically
  subQuestions.sort((a, b) => a.subQuestionNumber.localeCompare(b.subQuestionNumber));
  
  return subQuestions;
}

/**
 * Extract marks from text content
 * @param {string} text - Text to search for marks
 * @returns {number|null} Number of marks or null if not found
 */
function extractMarks(text) {
  if (!text) return null;
  
  const markPatterns = [
    /\[(\d+)\s*marks?\]/i,
    /\((\d+)\s*marks?\)/i,
    /(\d+)\s*marks?/i,
    /\[(\d+)\]/,
    /\((\d+)\)/
  ];
  
  for (const pattern of markPatterns) {
    const match = text.match(pattern);
    if (match) {
      const marks = parseInt(match[1]);
      if (marks >= 1 && marks <= 20) { // Reasonable range
        return marks;
      }
    }
  }
  
  return null;
}

/**
 * Extract mathematical expressions from content
 * @param {string} content - Question content
 * @returns {string} Extracted math expression
 */
function extractMathExpression(content) {
  if (!content) return '';
  
  // Keywords that typically precede math expressions
  const mathKeywords = [
    'Work out', 'Calculate', 'Find', 'Solve', 'Show that', 'Prove', 
    'Express', 'Simplify', 'Evaluate', 'Determine', 'Write down',
    'Give your answer', 'Hence', 'Estimate'
  ];
  
  // Try to extract math after keywords
  for (const keyword of mathKeywords) {
    const regex = new RegExp(`${keyword.replace(' ', '\\s+')}\\s*([^.!?\\n]+)`, 'i');
    const match = content.match(regex);
    if (match && match[1]) {
      const expression = match[1].trim();
      return parseMathExpression(expression);
    }
  }
  
  return '';
}

/**
 * Parse and reconstruct mathematical expressions
 * @param {string} expression - Raw math expression
 * @returns {string} Parsed expression
 */
function parseMathExpression(expression) {
  if (!expression) return '';
  
  let parsed = expression.trim();
  
  // Reconstruct fractions from separated numbers
  parsed = parsed
    .replace(/(\d+)\s+(\d+)(?=\s*[×÷+\-]|\s*$)/g, '$1/$2')
    .replace(/\(\s*(\d+)\s+(\d+)\s*\)/g, '($1/$2)')
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2')
    .replace(/\s+/g, ' ')
    .trim();
  
  return parsed;
}

/**
 * Convert math expression to LaTeX format
 * @param {string} mathExpr - Math expression
 * @returns {string} LaTeX formatted expression
 */
function convertToLatex(mathExpr) {
  if (!mathExpr) return '';
  
  return mathExpr
    .replace(/(\d+)\/(\d+)/g, '\\frac{$1}{$2}')
    .replace(/\(([^)]+)\/([^)]+)\)/g, '\\left(\\frac{$1}{$2}\\right)')
    .replace(/(\w+|\d+)\^(\w+|\d+)/g, '$1^{$2}')
    .replace(/×/g, '\\times')
    .replace(/÷/g, '\\div')
    .replace(/±/g, '\\pm')
    .replace(/≤/g, '\\leq')
    .replace(/≥/g, '\\geq')
    .replace(/√(\d+)/g, '\\sqrt{$1}')
    .replace(/°/g, '^\\circ')
    .replace(/\s*=\s*/g, ' = ');
}

/**
 * Convert math expression to Unicode format
 * @param {string} mathExpr - Math expression
 * @returns {string} Unicode formatted expression
 */
function convertToUnicode(mathExpr) {
  if (!mathExpr) return '';
  
  const superscriptMap = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
  };
  
  return mathExpr
    .replace(/\^(\d)/g, (match, digit) => superscriptMap[digit] || match)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validate question content
 * @param {string} content - Content to validate
 * @returns {boolean} True if valid question content
 */
function isValidQuestionContent(content) {
  if (!content || content.length < 10) return false;
  
  // Must contain actual words, not just symbols or numbers
  if (!/[a-zA-Z]{3,}/.test(content)) return false;
  
  // Filter out common non-question content
  const excludePatterns = [
    /^\s*Do not write/i,
    /^\s*Turn over/i,
    /^\s*\*\d+\*/,
    /^\s*IB\/[MJ]/i,
    /^Question\s+number/i,
    /^Additional page/i
  ];
  
  for (const pattern of excludePatterns) {
    if (pattern.test(content)) return false;
  }
  
  return true;
}

/**
 * Remove duplicate questions
 * @param {Array} questions - Array of questions
 * @returns {Array} Array with duplicates removed
 */
function removeDuplicateQuestions(questions) {
  const uniqueQuestions = [];
  const seenNumbers = new Set();
  
  questions.forEach(question => {
    if (!seenNumbers.has(question.questionNumber)) {
      seenNumbers.add(question.questionNumber);
      uniqueQuestions.push(question);
    }
  });
  
  return uniqueQuestions;
}

// Export functions for testing
module.exports = {
  extractQuestionsFromPDF,
  identifyAndProcessQuestions,
  processQuestion,
  extractSubQuestions,
  extractMarks,
  extractMathExpression,
  convertToLatex,
  convertToUnicode,
  cleanQuestionContent,
  isValidQuestionContent
};
