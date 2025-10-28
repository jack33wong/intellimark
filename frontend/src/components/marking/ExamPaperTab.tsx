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

  // Handle multiple exam papers case
  if (detectedQuestion.multipleExamPapers && detectedQuestion.examPapers) {
    return (
      <div className="exam-paper-tab">
        <div className="exam-paper-tab-content">
          {detectedQuestion.examPapers.map((examPaper, index) => (
            <div key={index} className="exam-paper-line">
              <span className="tab-item">
                {examPaper.examBoard} {examPaper.subject} {examPaper.examCode} ({examPaper.year}) {examPaper.tier}
              </span>
              <span className="tab-item">
                Q{examPaper.questions.map(q => q.questionNumber.split('_')[0]).join(', Q')}
              </span>
              <span className="tab-item marks">
                {examPaper.questions.map(q => q.marks).join(' + ')} = {examPaper.totalMarks} marks
              </span>
            </div>
          ))}
          {studentScore && studentScore.scoreText && (
            <span className="tab-item student-score">{studentScore.scoreText}</span>
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
      
      if (firstExamPaper.year) {
        parts.push(`(${firstExamPaper.year})`);
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

  const formatQuestionInfo = () => {
    // Extract all questions from examPapers
    if (detectedQuestion.examPapers && detectedQuestion.examPapers.length > 0) {
      const allQuestions = detectedQuestion.examPapers.flatMap(ep => ep.questions);
      return allQuestions.map(q => `Q${q.questionNumber}`).join(', ');
    }
    
    return '';
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
        {detectedQuestion.totalMarks && (
          <span className="tab-item marks">
            {(() => {
              // Extract all questions from examPapers
              if (detectedQuestion.examPapers && detectedQuestion.examPapers.length > 0) {
                const allQuestions = detectedQuestion.examPapers.flatMap(ep => ep.questions);
                return `${allQuestions.map(q => `${q.marks}`).join(' + ')} = ${detectedQuestion.totalMarks} marks`;
              }
              
              return `${detectedQuestion.totalMarks} marks`;
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
