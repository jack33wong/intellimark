const { extractQuestionsFromPDF, extractQuestionsFromText } = require('../utils/questionExtractor');
const path = require('path');

describe('Question Extractor', () => {
  describe('extractQuestionsFromPDF', () => {
    test('should extract questions from AQA-83001H-QP-JUN24.PDF', async () => {
      const filePath = path.join(__dirname, '../uploads/AQA/2024/48f5dc41-5f6e-4cfa-92cb-45911fb13d12-AQA-83001H-QP-JUN24.PDF');
      
      const result = await extractQuestionsFromPDF(filePath);
      
      expect(result.success).toBe(true);
      expect(result.totalQuestions).toBeGreaterThan(10); // At least 10 questions
      
      // Check that we have questions with sub-questions
      const questionsWithSubQuestions = result.questions.filter(q => q.subQuestions && q.subQuestions.length > 0);
      expect(questionsWithSubQuestions.length).toBeGreaterThan(0); // At least some sub-questions
      
      // Verify question structure
      if (result.questions.length > 0) {
        const firstQuestion = result.questions[0];
        expect(firstQuestion).toHaveProperty('questionNumber');
        expect(firstQuestion).toHaveProperty('text');
        expect(firstQuestion).toHaveProperty('subQuestions');
        expect(Array.isArray(firstQuestion.subQuestions)).toBe(true);
        
        // Check if first question has sub-questions
        if (firstQuestion.subQuestions.length > 0) {
          const firstSubQuestion = firstQuestion.subQuestions[0];
          expect(firstSubQuestion).toHaveProperty('subQuestionNumber');
          expect(firstSubQuestion).toHaveProperty('text');
          expect(firstSubQuestion).toHaveProperty('marks');
        }
      }
      
      console.log(`Extracted ${result.totalQuestions} questions from AQA-83001H-QP-JUN24.PDF`);
      console.log(`Questions with sub-questions: ${questionsWithSubQuestions.length}`);
      
      // Additional validation for AQA-83001H-QP-JUN24.PDF
      // Target: Exactly 25 main questions, 8 with sub-questions
      expect(result.totalQuestions).toBe(25);
      expect(questionsWithSubQuestions.length).toBe(8);
      
      // Check for specific sub-questions: 4a, 4b, 7a, 7b, 7c
      const question4 = result.questions.find(q => q.questionNumber === '4');
      const question7 = result.questions.find(q => q.questionNumber === '7');
      
      expect(question4).toBeDefined();
      expect(question4.subQuestions).toHaveLength(2);
      expect(question4.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question4.subQuestions[1].subQuestionNumber).toBe('b');
      
      expect(question7).toBeDefined();
      expect(question7.text).toContain('Here is a cone.');
      expect(question7.subQuestions).toHaveLength(3);
      expect(question7.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question7.subQuestions[1].subQuestionNumber).toBe('b');
      expect(question7.subQuestions[2].subQuestionNumber).toBe('c');
    }, 30000); // 30 second timeout for PDF processing
    
    test('should extract questions from AQA-83001F-QP-JUN22.PDF', async () => {
      const filePath = path.join(__dirname, '../uploads/AQA/2022/9dae25b9-fca6-4274-80f3-f23baa79212a-AQA-83001F-QP-JUN22.PDF');
      
      const result = await extractQuestionsFromPDF(filePath);
      
      expect(result.success).toBe(true);
      expect(result.totalQuestions).toBeGreaterThan(5); // At least 5 questions
      
      // Check that we have questions with sub-questions
      const questionsWithSubQuestions = result.questions.filter(q => q.subQuestions && q.subQuestions.length > 0);
      expect(questionsWithSubQuestions.length).toBeGreaterThan(0); // At least some sub-questions
      
      // Verify question structure
      if (result.questions.length > 0) {
        const firstQuestion = result.questions[0];
        expect(firstQuestion).toHaveProperty('questionNumber');
        expect(firstQuestion).toHaveProperty('text');
        expect(firstQuestion).toHaveProperty('subQuestions');
        expect(Array.isArray(firstQuestion.subQuestions)).toBe(true);
      }
      
      console.log(`Extracted ${result.totalQuestions} questions from AQA-83001F-QP-JUN22.PDF`);
      console.log(`Questions with sub-questions: ${questionsWithSubQuestions.length}`);
      
      // Additional validation for AQA-83001F-QP-JUN22.PDF
      // Target: Exactly 28 main questions, 8 with sub-questions
      expect(result.totalQuestions).toBe(28);
      expect(questionsWithSubQuestions.length).toBe(8);
    }, 30000); // 30 second timeout for PDF processing
  });
  

});
