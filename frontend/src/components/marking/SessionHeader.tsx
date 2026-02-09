/**
 * Session Header Component (TypeScript)
 * This is the definitive version with the fix for the auto-closing dropdown.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
import { useAuth } from '../../contexts/AuthContext';
import { Menu } from 'lucide-react';
import './css/SessionManagement.css';

const SessionHeader: React.FC = () => {
  const { user } = useAuth();
  const {
    sessionTitle,
    isFavorite,
    onFavoriteToggle,
    rating,
    onRatingChange,
    onTitleUpdate,
    hoveredRating,
    setHoveredRating,
    showInfoDropdown,
    onToggleInfoDropdown,
    currentSession,
    isProcessing,
    setSidebarOpen,
  } = useMarkingPage();

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null); // Ref for the toggle button
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(sessionTitle);

  const getModelUsed = (): string => {
    const stats = currentSession?.sessionStats;

    // Fail fast if old sessionMetadata structure is detected
    if (currentSession?.sessionMetadata) {
      console.error('❌ [DATA STRUCTURE ERROR] Old sessionMetadata structure detected');
      console.error('❌ [ERROR DETAILS] sessionMetadata:', currentSession.sessionMetadata);
      throw new Error('Old sessionMetadata data structure detected. Please clear database and create new sessions.');
    }

    return stats?.lastModelUsed || 'N/A';
  };

  const getProcessingTime = (): string => {
    const timeMs = currentSession?.sessionStats?.totalProcessingTimeMs;
    return timeMs ? `${(timeMs / 1000).toFixed(1)}s` : 'N/A';
  };

  const getTokenData = () => {
    const stats = currentSession?.sessionStats;
    if (!stats) return null;
    if (stats.totalLlmTokens !== undefined || stats.totalMathpixCalls !== undefined) {
      return [stats.totalLlmTokens || 0, stats.totalMathpixCalls || 0];
    }
    return null;
  };

  const getImageSize = (): string => {
    const stats = currentSession?.sessionStats;
    if (!stats?.imageSize || stats.imageSize === 0) return 'N/A';
    const sizeKB = stats.imageSize / 1024;
    if (sizeKB >= 1024) {
      return `${(sizeKB / 1024).toFixed(1)} MB`;
    }
    return `${sizeKB.toFixed(1)} KB`;
  };

  const getConfidence = (): string => {
    const stats = currentSession?.sessionStats;
    if (!stats?.averageConfidence) return 'N/A';
    return `${(stats.averageConfidence * 100).toFixed(1)}%`;
  };

  const getAnnotations = (): string => {
    const stats = currentSession?.sessionStats;
    return stats?.totalAnnotations?.toString() || 'N/A';
  };

  const handleEditTitle = () => {
    setIsEditingTitle(true);
    setEditedTitle(sessionTitle);
  };

  const handleSaveTitle = async () => {
    if (editedTitle.trim() === '' || editedTitle === sessionTitle) {
      setIsEditingTitle(false);
      return;
    }

    try {
      await onTitleUpdate(editedTitle.trim());
      setIsEditingTitle(false);
    } catch (error) {
      console.error('Error updating session title:', error);
      setIsEditingTitle(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedTitle(sessionTitle);
    setIsEditingTitle(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const getDetectedQuestion = () => {
    // Check session-level detectedQuestion first
    let detectedQuestion = currentSession?.detectedQuestion;

    // Fallback: Find the first message with detectedQuestion data
    if (!detectedQuestion) {
      const messageWithQuestion = currentSession?.messages?.find((msg: any) =>
        msg.detectedQuestion && msg.detectedQuestion.found
      );
      detectedQuestion = messageWithQuestion?.detectedQuestion;
    }

    // Fail fast if old data structure is detected
    if (detectedQuestion && detectedQuestion.message) {
      console.error('❌ [DATA STRUCTURE ERROR] Old detectedQuestion structure detected with "message" field');
      console.error('❌ [ERROR DETAILS] detectedQuestion:', detectedQuestion);
      throw new Error('Old detectedQuestion data structure detected. Please clear database and create new sessions.');
    }

    // Validate new structure (with examPapers array)
    if (detectedQuestion && detectedQuestion.found) {
      // New structure: fields are in examPapers[]
      if (detectedQuestion.examPapers && Array.isArray(detectedQuestion.examPapers) && detectedQuestion.examPapers.length > 0) {
        const firstExamPaper = detectedQuestion.examPapers[0];
        // Check for required fields, but allow 'year' as fallback for 'examSeries' during migration
        const requiredFields = ['examBoard', 'examCode', 'paperTitle', 'subject'];
        const missingFields = requiredFields.filter(field => !firstExamPaper.hasOwnProperty(field));

        // Check for examSeries or year (for migration compatibility)
        const hasExamSeries = firstExamPaper.hasOwnProperty('examSeries') || firstExamPaper.hasOwnProperty('year');

        if (missingFields.length > 0 || !hasExamSeries) {
          const allMissing = hasExamSeries ? missingFields : [...missingFields, 'examSeries (or year)'];
          console.error('❌ [DATA STRUCTURE ERROR] detectedQuestion.examPapers[0] missing required fields:', allMissing);
          console.error('❌ [ERROR DETAILS] firstExamPaper:', firstExamPaper);
          throw new Error(`detectedQuestion.examPapers[0] missing required fields: ${allMissing.join(', ')}. Please clear database and create new sessions.`);
        }
      }
      // Old flat structure: fields are at top level (for backward compatibility with question-only mode)
      else {
        const requiredFields = ['examBoard', 'examCode', 'paperTitle', 'subject'];
        const missingFields = requiredFields.filter(field => !detectedQuestion.hasOwnProperty(field));

        // Check for examSeries or year (for migration compatibility)
        const hasExamSeries = detectedQuestion.hasOwnProperty('examSeries') || detectedQuestion.hasOwnProperty('year');

        if (missingFields.length > 0 || !hasExamSeries) {
          const allMissing = hasExamSeries ? missingFields : [...missingFields, 'examSeries (or year)'];
          console.error('❌ [DATA STRUCTURE ERROR] detectedQuestion missing required fields:', allMissing);
          console.error('❌ [ERROR DETAILS] detectedQuestion:', detectedQuestion);
          throw new Error(`detectedQuestion missing required fields: ${allMissing.join(', ')}. Please clear database and create new sessions.`);
        }
      }
    }

    // Also check for old metadata structure in messages
    const messageWithOldMetadata = currentSession?.messages?.find((msg: any) => msg.metadata);
    if (messageWithOldMetadata) {
      console.error('❌ [DATA STRUCTURE ERROR] Old metadata structure detected in message');
      console.error('❌ [ERROR DETAILS] message:', messageWithOldMetadata);
      throw new Error('Old metadata data structure detected in messages. Please clear database and create new sessions.');
    }

    return detectedQuestion;
  };

  const tokens = getTokenData();
  const modelUsed = getModelUsed();
  const processingTime = getProcessingTime();
  // Grade is only available from the message (calculated during marking pipeline)
  // No API fallback - if grade is not in message, it won't be displayed
  const messageWithGrade = currentSession?.messages?.find((m: any) => m.grade);
  const grade = messageWithGrade?.grade || null;

  const renderStars = () => {
    return Array.from({ length: 5 }, (_, index) => {
      const starValue = index + 1;
      const isFilled = starValue <= (hoveredRating || rating);
      return (
        <span
          key={starValue}
          className={`star ${isFilled ? 'filled' : ''}`}
          onClick={() => onRatingChange(starValue)}
          onMouseEnter={() => setHoveredRating(starValue)}
          onMouseLeave={() => setHoveredRating(0)}
        >★</span>
      );
    });
  };

  // 👇 FIX: The useEffect for handling "click outside" is now architecturally correct.
  // It correctly handles dependencies and event propagation to prevent auto-closing.
  useEffect(() => {
    if (!showInfoDropdown) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      // If the click is on the button that opens the dropdown, do nothing.
      if (buttonRef.current && buttonRef.current.contains(event.target as Node)) {
        return;
      }
      // If the click is outside the dropdown content, close it.
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onToggleInfoDropdown();
      }
    };

    // Use a timeout to ensure the listener is added after the current event cycle.
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
    // This effect should ONLY run when the dropdown's visibility changes.
  }, [showInfoDropdown, onToggleInfoDropdown]);

  const displaySession = currentSession;

  // Helper to render the formatted title with colored parts
  const renderFormattedTitle = () => {
    // Only show "Thinking" dots if we are strictly processing AND don't have a valid question match yet.
    // If we have a detected question, show the title even if background processing (like credit deduction) is happening.
    const hasDetectedQuestion = currentSession?.detectedQuestion?.found;

    if (isProcessing && !hasDetectedQuestion) {
      return (
        <span className="processing-dots">
          {displaySession?.id?.startsWith('temp-') ? 'Analyzing' : 'Thinking'}
        </span>
      );
    }

    const detectedQuestion = getDetectedQuestion();

    // Get score and grade from messages
    const messageWithScore = currentSession?.messages?.find((m: any) => m.studentScore);
    const studentScore = messageWithScore?.studentScore;
    const gradeMessage = currentSession?.messages?.find((m: any) => m.grade);
    const gradeValue = gradeMessage?.grade || grade;

    if (detectedQuestion && detectedQuestion.found) {
      let examBoard, subject, examCode, examSeries, tier;

      if (detectedQuestion.examPapers && Array.isArray(detectedQuestion.examPapers) && detectedQuestion.examPapers.length > 0) {
        const firstExamPaper = detectedQuestion.examPapers[0];
        examBoard = firstExamPaper.examBoard;
        subject = firstExamPaper.subject;
        examCode = firstExamPaper.examCode;
        examSeries = firstExamPaper.examSeries || firstExamPaper.year;
        tier = firstExamPaper.tier;
      } else {
        examBoard = detectedQuestion.examBoard;
        subject = detectedQuestion.subject;
        examCode = detectedQuestion.examCode;
        examSeries = detectedQuestion.examSeries || detectedQuestion.year;
        tier = detectedQuestion.tier;
      }

      // FIX: If this is a generic question (mock match), do NOT use the detailed title logic.
      // Instead, fall back to the pre-generated sessionTitle (which handles non-past paper titles nicely).
      if (examCode === 'Generic Question' || examBoard === 'Unknown') {
        return sessionTitle;
      }

      const mainTitle = (examBoard && subject && examCode)
        ? `${examBoard} ${subject} ${examCode}`
        : sessionTitle;

      const subtitleParts = [];
      if (examSeries) subtitleParts.push(examSeries);
      if (tier) subtitleParts.push(tier);

      if (subtitleParts.length > 0) {
        return (
          <>
            <span className="title-main">{mainTitle}</span>
            <span className="title-separator"> • </span>
            <span className="title-secondary">{subtitleParts.join(' • ')}</span>

            {/* Score and Grade badges inline with title */}
            {studentScore && studentScore.scoreText && (
              <>
                <span className="title-separator"> • </span>
                <span className="title-badge score-badge">
                  <span className="badge-label">Score:</span>
                  <span className="badge-value">{studentScore.scoreText}</span>
                </span>
              </>
            )}
            {gradeValue && (
              <>
                <span className="title-separator"> • </span>
                <span className="title-badge grade-badge">
                  <span className="badge-label">Grade:</span>
                  <span className="badge-value">{gradeValue}</span>
                </span>
              </>
            )}
          </>
        );
      }

      return mainTitle;
    }
    return sessionTitle;
  };

  return (
    <div className="session-header">
      <div className="session-title-section">
        {setSidebarOpen && (
          <button
            className="mobile-sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>
        )}
        <h1 className="session-title">
          {renderFormattedTitle()}
        </h1>
      </div>

      {displaySession && !displaySession.id.startsWith('temp-') && (
        <div className="session-actions">
          {user && (
            <button
              className={`header-btn favorite-btn ${isFavorite ? 'favorited' : ''}`}
              onClick={onFavoriteToggle}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          )}

          <div className="info-dropdown-container">
            <button
              ref={buttonRef} // Attach ref to the button
              className="header-btn info-btn"
              onClick={onToggleInfoDropdown}
              title="Task Details"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
              </svg>
            </button>

            {showInfoDropdown && (
              <div className="info-dropdown" ref={dropdownRef}>
                <div className="info-dropdown-content">
                  <div className="dropdown-header"><h3>Task Details</h3></div>
                  <div className="dropdown-main-content">
                    <div className="label-value-item">
                      <span className="label">Title:</span>
                      <div className="title-edit-container">
                        {isEditingTitle ? (
                          <input
                            type="text"
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            onKeyDown={handleKeyPress}
                            onBlur={handleSaveTitle}
                            className="title-edit-input"
                            autoFocus
                          />
                        ) : (
                          <span className="value">{sessionTitle}</span>
                        )}
                        {!isEditingTitle && (
                          <button
                            onClick={handleEditTitle}
                            className="edit-title-btn"
                            title="Edit title"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--icon-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-pen-line clickable hover:opacity-80 flex-shrink-0">
                              <path d="M12 20h9"></path>
                              <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"></path>
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const detectedQuestion = getDetectedQuestion();
                    if (detectedQuestion && detectedQuestion.found) {
                      // Extract fields from new structure (examPapers[]) or use old flat structure
                      let examBoard, subject, examCode, examSeries, tier;

                      if (detectedQuestion.examPapers && Array.isArray(detectedQuestion.examPapers) && detectedQuestion.examPapers.length > 0) {
                        // New structure: extract from first exam paper
                        const firstExamPaper = detectedQuestion.examPapers[0];
                        examBoard = firstExamPaper.examBoard;
                        subject = firstExamPaper.subject;
                        examCode = firstExamPaper.examCode;
                        // Support both examSeries and year during migration
                        examSeries = firstExamPaper.examSeries || firstExamPaper.year;
                        tier = firstExamPaper.tier;
                      } else {
                        // Old flat structure (for backward compatibility)
                        examBoard = detectedQuestion.examBoard;
                        subject = detectedQuestion.subject;
                        examCode = detectedQuestion.examCode;
                        // Support both examSeries and year during migration
                        examSeries = detectedQuestion.examSeries || detectedQuestion.year;
                        tier = detectedQuestion.tier;
                      }

                      return (
                        <div className="exam-paper-section">
                          <div className="label-value-item">
                            <span className="label">Board:</span>
                            <span className="value">{examBoard || 'N/A'}</span>
                          </div>
                          <div className="label-value-item">
                            <span className="label">Subject:</span>
                            <span className="value">{subject || 'N/A'}</span>
                          </div>
                          <div className="label-value-item">
                            <span className="label">Paper Code:</span>
                            <span className="value">{examCode || 'N/A'}</span>
                          </div>
                          <div className="label-value-item">
                            <span className="label">Exam Series:</span>
                            <span className="value">{examSeries || 'N/A'}</span>
                          </div>
                          {tier && (
                            <div className="label-value-item">
                              <span className="label">Tier:</span>
                              <span className="value">{tier}</span>
                            </div>
                          )}
                          {grade && (
                            <div className="label-value-item">
                              <span className="label">Grade:</span>
                              <span className="value grade-value">{grade}</span>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="agent-speed-section">
                    <div className="agent-info">
                      <span className="label">Model Used</span>
                      <span className="value">{modelUsed}</span>
                    </div>
                    <div className="speed-info">
                      <span className="label">Processing Time</span>
                      <span className="value">{processingTime}</span>
                    </div>
                  </div>
                  {(() => {
                    const sessionStats = currentSession?.sessionStats;
                    const totalCost = sessionStats?.totalCost;
                    const costBreakdown = sessionStats?.costBreakdown;

                    // Debug: Log cost data to check if it exists
                    if (process.env.NODE_ENV === 'development') {

                    }

                    // Show cost section if totalCost exists and is greater than 0
                    if (totalCost !== undefined && totalCost !== null && totalCost > 0) {
                      const creditsSpent = totalCost * 100;
                      const llmCredits = (costBreakdown?.llmCost || 0) * 100;
                      const mathpixCredits = (costBreakdown?.mathpixCost || 0) * 100;

                      return (
                        <div className="cost-section">
                          <div className="label-value-item">
                            <span className="label">Credits Spent:</span>
                            <span className="value">{creditsSpent.toFixed(2)}</span>
                          </div>
                          {costBreakdown && (
                            <div className="cost-breakdown">
                              <div className="label-value-item">
                                <span className="label">LLM Credits:</span>
                                <span className="value">{llmCredits.toFixed(2)}</span>
                              </div>
                              <div className="label-value-item">
                                <span className="label">Mathpix Credits:</span>
                                <span className="value">{mathpixCredits.toFixed(2)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div className="dropdown-rating-section">
                    <div className="rating-container">
                      <div className="rating-label"><span className="label">Rate this task:</span></div>
                      <div className="rating-stars">{renderStars()}</div>
                    </div>
                  </div>
                  <div className="dropdown-footer">
                    <div className="token-count">
                      <span className="label">LLM Tokens</span>
                      <span className="value">{tokens ? tokens[0]?.toLocaleString() : 'N/A'}</span>
                    </div>
                    <div className="mathpix-count">
                      <span className="label">Mathpix Calls</span>
                      <span className="value">{tokens ? tokens[1] : 'N/A'}</span>
                    </div>
                    <div className="image-size">
                      <span className="label">Image Size</span>
                      <span className="value">{getImageSize()}</span>
                    </div>
                    <div className="confidence">
                      <span className="label">Confidence</span>
                      <span className="value">{getConfidence()}</span>
                    </div>
                    <div className="annotations">
                      <span className="label">Annotations</span>
                      <span className="value">{getAnnotations()}</span>
                    </div>
                    <div className="last-update">
                      <span className="label">Last Update:</span>
                      <span className="value">{currentSession?.updatedAt ? new Date(currentSession.updatedAt).toLocaleString() : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionHeader;

