const { extractText } = require('unpdf');
const fs = require('fs');

async function testUnpdf() {
  console.log('Testing unpdf on AQA exam paper...');
  
  try {
    // Read the PDF file and convert to Uint8Array
    const pdfBuffer = fs.readFileSync('./uploads/AQA/2024/AQA-83001H-QP-JUN24.PDF');
    const pdfArray = new Uint8Array(pdfBuffer);
    
    console.log('Extracting text with unpdf...');
    const result = await extractText(pdfArray);
    
    console.log('unpdf result type:', typeof result);
    console.log('unpdf result:', result);
    
    // Handle the result format - unpdf returns {totalPages, text: array}
    let extractedText;
    if (result && result.text && Array.isArray(result.text)) {
      extractedText = result.text.join('\n');
      console.log(`Total pages: ${result.totalPages}`);
    } else {
      console.log('Unexpected result format from unpdf');
      return;
    }
    
    console.log(`Extracted text length: ${extractedText.length} characters`);
    
    // Look for Question 7 specifically
    console.log('\n=== SEARCHING FOR QUESTION 7 ===');
    
    // Find question 7 with cone content
    const coneIndex = extractedText.search(/cone/i);
    if (coneIndex !== -1) {
      console.log('Found "cone" at position:', coneIndex);
      const context = extractedText.substring(Math.max(0, coneIndex - 200), coneIndex + 500);
      console.log('Context around "cone":');
      console.log(context);
    }
    
    // Look for question 7 patterns
    const q7Patterns = [
      /7\s*(.*?)(?=8\s|$)/s,
      /Here is a cone[\s\S]*?(?=8\s|Turn over|$)/i,
      /7\s*\(a\)[\s\S]*?7\s*\(c\)/i
    ];
    
    console.log('\n=== QUESTION 7 PATTERN MATCHING ===');
    q7Patterns.forEach((pattern, index) => {
      const match = extractedText.match(pattern);
      if (match) {
        console.log(`Pattern ${index + 1} matched:`);
        console.log(match[0].substring(0, 300) + '...');
      } else {
        console.log(`Pattern ${index + 1}: No match`);
      }
    });
    
    // Count total questions
    const questionMatches = extractedText.match(/^\s*(\d+)\s+/gm) || [];
    const questionNumbers = questionMatches
      .map(match => parseInt(match.trim()))
      .filter(num => num >= 1 && num <= 30)
      .sort((a, b) => a - b);
    
    console.log('\n=== QUESTION ANALYSIS ===');
    console.log('Question numbers found:', [...new Set(questionNumbers)]);
    console.log('Total unique questions:', new Set(questionNumbers).size);
    
    // Look for sub-question patterns
    const subQuestionPattern = /\d+\s*\([a-c]\)/gi;
    const subQuestions = extractedText.match(subQuestionPattern) || [];
    console.log('Sub-questions found:', subQuestions);
    
    // Specifically look for 7(a), 7(b), 7(c)
    const q7SubQuestions = subQuestions.filter(sq => sq.startsWith('7'));
    console.log('Question 7 sub-questions:', q7SubQuestions);
    
    return {
      text: extractedText,
      questionNumbers: [...new Set(questionNumbers)],
      totalQuestions: new Set(questionNumbers).size,
      subQuestions: subQuestions,
      q7SubQuestions: q7SubQuestions
    };
    
  } catch (error) {
    console.error('unpdf failed:', error);
    throw error;
  }
}

// Run the test
testUnpdf()
  .then(result => {
    console.log('\n=== TEST RESULTS ===');
    console.log('Total questions found:', result.totalQuestions);
    console.log('Question 7 sub-questions:', result.q7SubQuestions);
    
    if (result.totalQuestions >= 20 && result.q7SubQuestions.length >= 3) {
      console.log('✅ unpdf shows promise for better extraction!');
    } else {
      console.log('❌ unpdf didn\'t significantly improve extraction');
    }
  })
  .catch(error => {
    console.error('Test failed:', error);
  });
