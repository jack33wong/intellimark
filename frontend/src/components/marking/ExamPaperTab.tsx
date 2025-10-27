/**
 * Exam Paper Tab Component
 * Displays exam paper details as a tab above AI response messages
 */
import React from 'react';
import type { DetectedQuestion, components } from '../../types';
import './ExamPaperTab.css';

type StudentScore = components['schemas']['UnifiedMessage']['studentScore'];

// Extend DetectedQuestion to include multiple questions support
interface ExtendedDetectedQuestion extends DetectedQuestion {
  multipleQuestions?: boolean;
  allQuestions?: Array<{
    questionNumber: string;
    marks: number;
    confidence: number;
  }>;
}

interface ExamPaperTabProps {
  detectedQuestion: ExtendedDetectedQuestion | null;
  studentScore?: StudentScore;
}

const ExamPaperTab: React.FC<ExamPaperTabProps> = ({ detectedQuestion, studentScore }) => {
  if (!detectedQuestion || !detectedQuestion.found) {
    return null;
  }

  const formatExamInfo = () => {
    const parts = [];
    
    if (detectedQuestion.examBoard) {
      parts.push(detectedQuestion.examBoard);
    }
    
    if (detectedQuestion.subject) {
      parts.push(detectedQuestion.subject);
    }
    
    if (detectedQuestion.examCode) {
      parts.push(detectedQuestion.examCode);
    }
    
    if (detectedQuestion.year) {
      parts.push(`(${detectedQuestion.year})`);
    }
    
    if (detectedQuestion.tier) {
      // Don't add "Tier" prefix if tier already contains "Tier" (e.g., "Foundation Tier")
      const tierDisplay = detectedQuestion.tier.toLowerCase().includes('tier') 
        ? detectedQuestion.tier 
        : `Tier ${detectedQuestion.tier}`;
      parts.push(tierDisplay);
    }
    
    return parts.join(' ');
  };

  const formatQuestionInfo = () => {
    // Check for new structure with questions array first
    if (detectedQuestion.multipleQuestions && (detectedQuestion as any).questions) {
      const questions = (detectedQuestion as any).questions;
      return questions.map((q: any) => `Q${q.questionNumber}`).join(', ');
    }
    
    // Check for old structure with allQuestions
    if (detectedQuestion.multipleQuestions && (detectedQuestion as any).allQuestions) {
      const questionNumbers = (detectedQuestion as any).allQuestions.map((q: any) => `Q${q.questionNumber}`).join(', ');
      return questionNumbers;
    }
    
    // Single question
    if (detectedQuestion.questionNumber) {
      let questionInfo = `Q${detectedQuestion.questionNumber}`;
      if (detectedQuestion.subQuestionNumber) {
        questionInfo += `(${detectedQuestion.subQuestionNumber})`;
      }
      return questionInfo;
    }
    return null;
  };

  const questionInfo = formatQuestionInfo();

  return (
    <div className="exam-paper-tab">
      <div className="exam-paper-tab-content">
        <span className="tab-item">Exam Paper</span>
        <span className="tab-item">{formatExamInfo()}</span>
        {questionInfo && (
          <span className="tab-item">{questionInfo}</span>
        )}
        {detectedQuestion.marks && (
          <span className="tab-item marks">
            {(() => {
              // Handle new structure with questions array
              if (detectedQuestion.multipleQuestions && (detectedQuestion as any).questions) {
                const questions = (detectedQuestion as any).questions;
                return `${questions.map((q: any) => `${q.marks}`).join(' + ')} = ${detectedQuestion.marks} marks`;
              }
              
              // Handle old structure with allQuestions
              if (detectedQuestion.multipleQuestions && (detectedQuestion as any).allQuestions) {
                const allQuestions = (detectedQuestion as any).allQuestions;
                return `${allQuestions.map((q: any) => `${q.marks}`).join(' + ')} = ${detectedQuestion.marks} marks`;
              }
              
              // Single question
              return `${detectedQuestion.marks} marks`;
            })()}
          </span>
        )}
        {studentScore && studentScore.scoreText && (
          <span className="tab-item student-score">{studentScore.scoreText}</span>
        )}
      </div>
    </div>
  );
};

export default ExamPaperTab;
