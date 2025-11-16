/**
 * Exam Paper Tab Component
 * Displays exam paper details as a tab above AI response messages
 */
import React from 'react';
import type { DetectedQuestion, components } from '../../types';
import './ExamPaperTab.css';

type StudentScore = components['schemas']['UnifiedMessage']['studentScore'];

interface ExamPaperTabProps {
  detectedQuestion: DetectedQuestion | null;
  studentScore?: StudentScore;
  grade?: string | null; // Grade from message (if available from pipeline)
}

const ExamPaperTab: React.FC<ExamPaperTabProps> = ({ detectedQuestion, studentScore, grade: gradeFromProps }) => {
  // Grade is only available from the message (calculated during marking pipeline)
  // No API fallback - if grade is not in message, it won't be displayed

  if (!detectedQuestion || !detectedQuestion.found) {
    return null;
  }

  // Helper function to extract base question number (e.g., "3a" -> "3", "22" -> "22")
  const getBaseQuestionNumber = (questionNumber: string): number => {
    const match = questionNumber.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  // Helper function to check if numbers are in sequence
  const isSequence = (numbers: number[]): boolean => {
    if (numbers.length <= 1) return false;
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] !== numbers[i - 1] + 1) {
        return false;
      }
    }
    return true;
  };

  // Handle multiple exam papers case
  if (detectedQuestion.multipleExamPapers && detectedQuestion.examPapers) {
    return (
      <div className="exam-paper-tab">
        <div className="exam-paper-tab-content">
          {detectedQuestion.examPapers.map((examPaper, index) => (
            <div key={index} className="exam-paper-line">
              <span className="tab-item">
                {examPaper.examBoard} {examPaper.subject} {examPaper.examCode} ({examPaper.examSeries}) {examPaper.tier}
              </span>
              <span className="tab-item">
                {(() => {
                  const baseNumbers = examPaper.questions
                    .map(q => getBaseQuestionNumber(q.questionNumber.split('_')[0]))
                    .filter(num => num > 0)
                    .sort((a, b) => a - b);
                  const uniqueNumbers = Array.from(new Set(baseNumbers));
                  
                  if (uniqueNumbers.length === 0) {
                    return examPaper.questions.map(q => `Q${q.questionNumber.split('_')[0]}`).join(', ');
                  }
                  
                  if (isSequence(uniqueNumbers)) {
                    return `Q${uniqueNumbers[0]} to Q${uniqueNumbers[uniqueNumbers.length - 1]}`;
                  }
                  
                  return uniqueNumbers.map(num => `Q${num}`).join(', ');
                })()}
              </span>
              <span className="tab-item marks">
                {(() => {
                  const questionCount = examPaper.questions.length;
                  if (questionCount > 5) {
                    return `${examPaper.totalMarks} marks`;
                  }
                  return `${examPaper.questions.map(q => q.marks).join(' + ')} = ${examPaper.totalMarks} marks`;
                })()}
              </span>
            </div>
          ))}
          {studentScore && studentScore.scoreText && (
            <span className="tab-item total-score">{studentScore.scoreText}</span>
          )}
        </div>
      </div>
    );
  }

  const formatExamInfo = () => {
    // Get exam info from first exam paper
    if (detectedQuestion.examPapers && detectedQuestion.examPapers.length > 0) {
      const firstExamPaper = detectedQuestion.examPapers[0];
      const parts = [];
      
      if (firstExamPaper.examBoard) {
        parts.push(firstExamPaper.examBoard);
      }
      
      if (firstExamPaper.subject) {
        parts.push(firstExamPaper.subject);
      }
      
      if (firstExamPaper.examCode) {
        parts.push(firstExamPaper.examCode);
      }
      
      if (firstExamPaper.examSeries) {
        parts.push(`(${firstExamPaper.examSeries})`);
      }
      
      if (firstExamPaper.tier) {
        // Don't add "Tier" prefix if tier already contains "Tier" (e.g., "Foundation Tier")
        const tierDisplay = firstExamPaper.tier.toLowerCase().includes('tier') 
          ? firstExamPaper.tier 
          : `Tier ${firstExamPaper.tier}`;
        parts.push(tierDisplay);
      }
      
      return parts.join(' ');
    }
    
    return '';
  };

  // Helper function to format question numbers
  const formatQuestionNumbers = (questions: any[]): string => {
    if (questions.length === 0) return '';
    
    // Extract base question numbers and sort
    const baseNumbers = questions
      .map(q => getBaseQuestionNumber(q.questionNumber))
      .filter(num => num > 0)
      .sort((a, b) => a - b);
    
    // Remove duplicates
    const uniqueNumbers = Array.from(new Set(baseNumbers));
    
    if (uniqueNumbers.length === 0) {
      // Fallback: show all question numbers as-is
      return questions.map(q => `Q${q.questionNumber}`).join(', ');
    }
    
    // Check if in sequence
    if (isSequence(uniqueNumbers)) {
      return `Q${uniqueNumbers[0]} to Q${uniqueNumbers[uniqueNumbers.length - 1]}`;
    }
    
    // Not in sequence, show all
    return uniqueNumbers.map(num => `Q${num}`).join(', ');
  };

  const formatQuestionInfo = () => {
    // Extract all questions from examPapers
    if (detectedQuestion.examPapers && detectedQuestion.examPapers.length > 0) {
      const allQuestions = detectedQuestion.examPapers.flatMap(ep => ep.questions);
      return formatQuestionNumbers(allQuestions);
    }
    
    return '';
  };

  const questionInfo = formatQuestionInfo();

  return (
    <div className="exam-paper-tab">
      <div className="exam-paper-tab-content">
        <div className="exam-paper-line">
          <span className="tab-item">{formatExamInfo()}</span>
          {questionInfo && (
            <span className="tab-item">{questionInfo}</span>
          )}
          {detectedQuestion.totalMarks && (
            <span className="tab-item marks">
              {(() => {
                // Extract all questions from examPapers
                if (detectedQuestion.examPapers && detectedQuestion.examPapers.length > 0) {
                  const allQuestions = detectedQuestion.examPapers.flatMap(ep => ep.questions);
                  const questionCount = allQuestions.length;
                  
                  if (questionCount > 5) {
                    return `${detectedQuestion.totalMarks} marks`;
                  }
                  
                  return `${allQuestions.map(q => `${q.marks}`).join(' + ')} = ${detectedQuestion.totalMarks} marks`;
                }
                
                return `${detectedQuestion.totalMarks} marks`;
              })()}
            </span>
          )}
          {studentScore && studentScore.scoreText && (
            <span className="tab-item total-score">{studentScore.scoreText}</span>
          )}
          {gradeFromProps && (
            <span className="tab-item grade">Grade: {gradeFromProps}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExamPaperTab;
