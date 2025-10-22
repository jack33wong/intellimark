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
      parts.push(`Tier ${detectedQuestion.tier}`);
    }
    
    return parts.join(' ');
  };

  const formatQuestionInfo = () => {
    if (detectedQuestion.questionNumber) {
      // Handle multiple questions
      if (detectedQuestion.multipleQuestions && detectedQuestion.allQuestions) {
        const questionNumbers = detectedQuestion.allQuestions.map(q => `Q${q.questionNumber}`).join(', ');
        return questionNumbers;
      } else {
        // Single question
        let questionInfo = `Q${detectedQuestion.questionNumber}`;
        if (detectedQuestion.subQuestionNumber) {
          questionInfo += `(${detectedQuestion.subQuestionNumber})`;
        }
        return questionInfo;
      }
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
            {detectedQuestion.multipleQuestions && detectedQuestion.allQuestions
              ? `${detectedQuestion.marks} marks total (${detectedQuestion.allQuestions.map(q => `${q.marks}`).join('+')})`
              : `${detectedQuestion.marks} marks`
            }
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
