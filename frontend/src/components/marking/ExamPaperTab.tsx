/**
 * Exam Paper Tab Component
 * Displays exam paper details as a tab above AI response messages
 */
import React from 'react';
import './ExamPaperTab.css';

interface ExamPaperTabProps {
  detectedQuestion: {
    found: boolean;
    examBoard?: string;
    examCode?: string;
    paperTitle?: string;
    subject?: string;
    tier?: string;
    year?: string;
    questionNumber?: string;
    subQuestionNumber?: string;
  } | null;
}

const ExamPaperTab: React.FC<ExamPaperTabProps> = ({ detectedQuestion }) => {
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
      </div>
    </div>
  );
};

export default ExamPaperTab;
