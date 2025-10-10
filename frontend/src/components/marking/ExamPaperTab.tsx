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
          <span className="tab-item marks">{detectedQuestion.marks}</span>
        )}
        {studentScore && studentScore.scoreText && (
          <span className="tab-item student-score">{studentScore.scoreText}</span>
        )}
      </div>
    </div>
  );
};

export default ExamPaperTab;
