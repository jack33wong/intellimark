const { extractQuestionsFromPDF, extractQuestionsFromText } = require('../utils/questionExtractor');
const path = require('path');

describe('Question Extractor', () => {
  describe('extractQuestionsFromPDF', () => {
    test('should extract questions from AQA-83001H-QP-JUN24.PDF', async () => {
      const filePath = path.join(__dirname, '../uploads/AQA/2024/AQA-83001H-QP-JUN24.PDF');
      
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
      
      // Expected sub-questions for JUN24.PDF:
      // Q4: 4a, 4b (existing)
      // Q5: 5a, 5b
      // Q6: 6a, 6b  
      // Q7: 7a, 7b, 7c (existing)
      // Q10: 10a, 10b
      // Q15: 15a, 15b
      // Q23: 23a, 23b
      // Q24: 24a, 24b
      
      const question4 = result.questions.find(q => q.questionNumber === '4');
      const question5 = result.questions.find(q => q.questionNumber === '5');
      const question6 = result.questions.find(q => q.questionNumber === '6');
      const question7 = result.questions.find(q => q.questionNumber === '7');
      const question10 = result.questions.find(q => q.questionNumber === '10');
      const question15 = result.questions.find(q => q.questionNumber === '15');
      const question23 = result.questions.find(q => q.questionNumber === '23');
      const question24 = result.questions.find(q => q.questionNumber === '24');
      const question25 = result.questions.find(q => q.questionNumber === '25');
      
      // Q25 should exist as a main question (no sub-questions)
      expect(question25).toBeDefined();
      expect(question25.subQuestions).toHaveLength(0);
      
      // Check Q4 sub-questions: 4a, 4b (existing - keep working)
      expect(question4).toBeDefined();
      expect(question4.subQuestions).toHaveLength(2);
      expect(question4.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question4.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q5 sub-questions: 5a, 5b
      expect(question5).toBeDefined();
      expect(question5.subQuestions).toHaveLength(2);
      expect(question5.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question5.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q6 sub-questions: 6a, 6b
      expect(question6).toBeDefined();
      expect(question6.subQuestions).toHaveLength(2);
      expect(question6.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question6.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q7 sub-questions: 7a, 7b, 7c (existing - keep working)
      expect(question7).toBeDefined();
      expect(question7.subQuestions).toHaveLength(3);
      expect(question7.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question7.subQuestions[1].subQuestionNumber).toBe('b');
      expect(question7.subQuestions[2].subQuestionNumber).toBe('c');
      
      // Check Q10 sub-questions: 10a, 10b
      expect(question10).toBeDefined();
      expect(question10.subQuestions).toHaveLength(2);
      expect(question10.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question10.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q15 sub-questions: 15a, 15b
      expect(question15).toBeDefined();
      expect(question15.subQuestions).toHaveLength(2);
      expect(question15.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question15.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q23 sub-questions: 23a, 23b
      expect(question23).toBeDefined();
      expect(question23.subQuestions).toHaveLength(2);
      expect(question23.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question23.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q24 sub-questions: 24a, 24b
      expect(question24).toBeDefined();
      expect(question24.subQuestions).toHaveLength(2);
      expect(question24.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question24.subQuestions[1].subQuestionNumber).toBe('b');
    }, 30000); // 30 second timeout for PDF processing
    
    test('should extract questions from AQA-83001F-QP-JUN22.PDF', async () => {
      const filePath = path.join(__dirname, '../uploads/AQA/2022/AQA-83001F-QP-JUN22.PDF');
      
      const result = await extractQuestionsFromPDF(filePath);
      
      expect(result.success).toBe(true);
      expect(result.totalQuestions).toBeGreaterThan(5); // At least 5 questions
      
      // Check that we have questions with sub-questions
      const questionsWithSubQuestions = result.questions.filter(q => q.subQuestions && q.subQuestions.length > 0);
      
      console.log(`Extracted ${result.totalQuestions} questions from AQA-83001F-QP-JUN22.PDF`);
      console.log(`Questions with sub-questions: ${questionsWithSubQuestions.length}`);
      
      // Debug which questions have sub-questions
      const foundWithSubs = questionsWithSubQuestions.map(q => parseInt(q.questionNumber)).sort((a, b) => a - b);
      console.log('Questions with sub-questions found:', foundWithSubs);
      
      // Show sub-question details
      for (const q of questionsWithSubQuestions) {
        const subNums = q.subQuestions.map(sq => sq.subQuestionNumber).join(', ');
        console.log(`Q${q.questionNumber}: ${subNums} (${q.subQuestions.length} sub-questions)`);
      }
      

      
      // Debug: Show which questions were found
      const questionNumbers = result.questions.map(q => parseInt(q.questionNumber)).sort((a, b) => a - b);
      console.log('Found questions:', questionNumbers.slice(0, 15).join(', '));
      console.log('Missing 1-10:', Array.from({length: 10}, (_, i) => i + 1).filter(n => !questionNumbers.includes(n)));
      
      // Temporarily skip some validations to see debug output
      // expect(questionsWithSubQuestions.length).toBeGreaterThan(0); // At least some sub-questions
      
      // Verify question structure
      if (result.questions.length > 0) {
        const firstQuestion = result.questions[0];
        expect(firstQuestion).toHaveProperty('questionNumber');
        expect(firstQuestion).toHaveProperty('text');
        expect(firstQuestion).toHaveProperty('subQuestions');
        expect(Array.isArray(firstQuestion.subQuestions)).toBe(true);
      }
      
      // Additional validation for AQA-83001F-QP-JUN22.PDF
      // Target: Exactly 28 main questions, 8 with sub-questions
      expect(result.totalQuestions).toBe(28);
      expect(questionsWithSubQuestions.length).toBe(8);
      
      // Expected sub-questions for JUN22.PDF (Foundation paper):
      // Q1: 1a, 1b, 1c
      // Q6: 6a, 6b
      // Q8: 8a, 8b
      // Q10: 10a, 10b
      // Q11: 11a, 11b
      // Q13: 13a, 13b
      // Q19: 19a, 19b
      // Q23: 23a, 23b
      
      const question1 = result.questions.find(q => q.questionNumber === '1');
      const question6 = result.questions.find(q => q.questionNumber === '6');
      const question8 = result.questions.find(q => q.questionNumber === '8');
      const question10 = result.questions.find(q => q.questionNumber === '10');
      const question11 = result.questions.find(q => q.questionNumber === '11');
      const question13 = result.questions.find(q => q.questionNumber === '13');
      const question19 = result.questions.find(q => q.questionNumber === '19');
      const question23 = result.questions.find(q => q.questionNumber === '23');
      
      // Check Q1 sub-questions: 1a, 1b, 1c
      expect(question1).toBeDefined();
      expect(question1.subQuestions).toHaveLength(3);
      expect(question1.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question1.subQuestions[1].subQuestionNumber).toBe('b');
      expect(question1.subQuestions[2].subQuestionNumber).toBe('c');
      
      // Check Q6 sub-questions: 6a, 6b
      expect(question6).toBeDefined();
      expect(question6.subQuestions).toHaveLength(2);
      expect(question6.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question6.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q8 sub-questions: 8a, 8b
      expect(question8).toBeDefined();
      expect(question8.subQuestions).toHaveLength(2);
      expect(question8.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question8.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q10 sub-questions: 10a, 10b
      expect(question10).toBeDefined();
      expect(question10.subQuestions).toHaveLength(2);
      expect(question10.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question10.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q11 sub-questions: 11a, 11b
      expect(question11).toBeDefined();
      expect(question11.subQuestions).toHaveLength(2);
      expect(question11.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question11.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q13 sub-questions: 13a, 13b
      expect(question13).toBeDefined();
      expect(question13.subQuestions).toHaveLength(2);
      expect(question13.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question13.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q19 sub-questions: 19a, 19b
      expect(question19).toBeDefined();
      expect(question19.subQuestions).toHaveLength(2);
      expect(question19.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question19.subQuestions[1].subQuestionNumber).toBe('b');
      
      // Check Q23 sub-questions: 23a, 23b
      expect(question23).toBeDefined();
      expect(question23.subQuestions).toHaveLength(2);
      expect(question23.subQuestions[0].subQuestionNumber).toBe('a');
      expect(question23.subQuestions[1].subQuestionNumber).toBe('b');
    }, 30000); // 30 second timeout for PDF processing
  });
  

});
