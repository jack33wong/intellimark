/**
 * MainLayout Component (TypeScript)
 * This is the definitive version with the fix for the re-mounting bug.
 */
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
import SessionManagement from './SessionManagement';
import FollowUpChatInput from '../chat/FollowUpChatInput';
import { ChatMessage } from '../focused';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import { ensureStringContent } from '../../utils/contentUtils';
import './css/ChatInterface.css';
import './css/ImageUploadInterface.css';

const MainLayout: React.FC = () => {
  const {
    isProcessing,
    selectedModel,
    onModelChange,
    chatMessages,
    chatContainerRef,
    showScrollButton,
    scrollToBottom,
    handleImageLoad,
    getImageSrc,
    hasNewResponse,
    scrollToNewResponse,
    currentSession,
    handleImageAnalysis,
    onAnalyzeMultiImage,
    onFollowUpMultiImage,
    onSendMessage,
    addMessage,
    startAIThinking,
  } = useMarkingPage();

  const isFollowUp = (chatMessages || []).length > 0;

  return (
    <div className={`mark-homework-page ${isFollowUp ? 'chat-mode' : 'initial-mode'}`}>
      <div className="mark-homework-main-content">
        <div className="chat-container" ref={chatContainerRef}>
          {currentSession && (
            // 👇 FIX: Add a stable `key`. This prevents the component from being
            // unmounted and remounted, which was resetting the dropdown state.
            <SessionManagement key={currentSession.id} />
          )}

          <div className="chat-messages">
            <div className="main-layout">
              <SessionHeader />
              <div className="tab-container">
                <div className="tab-headers">
                  <button
                    className={`tab-header ${view === 'annotated' ? 'active' : ''}`}
                    onClick={() => onViewChange('annotated')}
                  >
                    Annotated Output
                  </button>
                  <button
                    className={`tab-header ${view === 'exam' ? 'active' : ''}`}
                    onClick={() => onViewChange('exam')}
                  >
                    Exam Paper
                  </button>
                </div>

                <div className="tab-content">
                  {view === 'annotated' && (
                    <>
                      <SessionFilters
                        filterView={filterView}
                        onFilterViewChange={onFilterViewChange}
                      />
                      {currentSession ? (
                        <AnnotatedOutput
                          session={currentSession}
                          isLoading={resultsLoading}
                        />
                      ) : (
                        <div className="no-session">No session loaded</div>
                      )}
                    </>
                  )}

                  {view === 'exam' && (
                    <ExamPaperTab session={currentSession} />
                  )}
                </div>
              </div>
            </div>
            );
};

            export default MainLayout;

