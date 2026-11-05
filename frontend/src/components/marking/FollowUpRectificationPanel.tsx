import React, { useState, useEffect, useRef } from 'react';
import { Paperclip, Link2, RefreshCw, X, Check, Brain, Sparkles } from 'lucide-react';
import { usePaperSearch } from '../../hooks/usePaperSearch';
import apiClient from '../../services/apiClient';
import '../chat/UnifiedChatInput.css';

interface PaperQuestionItem {
  questionNumber: string;
  marks: number;
  type?: string;
}

interface FollowUpRectificationPanelProps {
  message: any;
  session: any;
  content: string;
  isProcessing: boolean;
  onAttachFilesForRemark: (files: FileList) => void;
  onRemarkOfficialPaper: (payload: { paperTitle: string; questionNumber?: string | null }) => Promise<void>;
}

export const FollowUpRectificationPanel: React.FC<FollowUpRectificationPanelProps> = ({
  message,
  session,
  content,
  isProcessing,
  onAttachFilesForRemark,
  onRemarkOfficialPaper
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPaperDrawerOpen, setIsPaperDrawerOpen] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null);
  const [paperQuestions, setPaperQuestions] = useState<PaperQuestionItem[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedQuestionNumber, setSelectedQuestionNumber] = useState<string>('ALL');
  const [isSubmittingRemark, setIsSubmittingRemark] = useState(false);

  // 1. STRICT GUARD: Never show rectification on non-educational / junk / cover-page rejections
  const isNonAcademicOrJunkRejection = React.useMemo(() => {
    const text = (content || '').toLowerCase();
    if (
      text.includes('not educational exam content') ||
      text.includes('please upload an academic exam question') ||
      text.includes('not maths related image') ||
      text.includes('uploaded an exam cover page') ||
      text.includes('unreadable pdf format') ||
      text.includes('blurry, unreadable, or does not contain educational content') ||
      text.includes('no student work was detected') ||
      text.includes('non-academic') ||
      text.includes('parking')
    ) {
      return true;
    }
    const warning = (message as any)?.warning || session?.warning;
    if (
      (warning === 'CONTENT_REJECTED' && !(message as any)?.requiresMarkingScheme) ||
      warning === 'NOT_MATHS_CONTENT' ||
      warning === 'COVER_PAGE_ONLY'
    ) {
      return true;
    }
    return false;
  }, [content, message, session]);

  // 2. Detect current message grading state
  const requiresMarkingScheme = Boolean(
    !isNonAcademicOrJunkRejection && (
      (message as any)?.requiresMarkingScheme === true ||
      /Marking Scheme Required|Attach Marking Scheme|Unsupported subject/i.test(content || '')
    )
  );

  const parsedSummary = React.useMemo(() => {
    const raw = (message as any)?.performanceSummary;
    if (!raw || typeof raw !== 'string' || !raw.trim().startsWith('{')) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, [message]);

  const initialSubject = React.useMemo<'maths' | 'english' | null>(() => {
    if (parsedSummary?.subjectKey === 'ENGLISH_LANGUAGE' || /english/i.test(parsedSummary?.examInfo?.subject || '')) {
      return 'english';
    }
    if (parsedSummary?.subjectKey === 'MATHS') {
      return 'maths';
    }
    return null;
  }, [parsedSummary]);

  const hasCustomSchemeApplied = Boolean(
    parsedSummary?.examInfo?.examCode === 'Uploaded' ||
    parsedSummary?.examInfo?.examBoard === 'Custom'
  );

  const hasOfficialExamMatch = Boolean(
    parsedSummary?.examInfo?.examCode &&
    parsedSummary?.examInfo?.examCode !== 'Generic Question' &&
    parsedSummary?.examInfo?.examCode !== 'Uploaded'
  );

  const isGenericMarking = !requiresMarkingScheme && !hasOfficialExamMatch && !hasCustomSchemeApplied && Boolean(
    parsedSummary ||
    (message as any)?.studentScore ||
    (message as any)?.isMarkingResult ||
    (message as any)?.detectedQuestion?.isGeneric
  );

  const totalMarkedQuestions = parsedSummary?.score?.questionsTotal || 1;

  const {
    metadata,
    searchQuery,
    setSearchQuery,
    selectedTags,
    selectedSubject,
    setSelectedSubject,
    toggleFilterTag,
    filteredResults,
    formatPaperDisplayLabel
  } = usePaperSearch(initialSubject, isPaperDrawerOpen);

  // Sync subject filter when drawer opens
  useEffect(() => {
    if (isPaperDrawerOpen && initialSubject && !selectedSubject) {
      setSelectedSubject(initialSubject);
    }
  }, [isPaperDrawerOpen, initialSubject, selectedSubject, setSelectedSubject]);

  // Fetch dynamic question pills when user selects a paper from dropdown
  useEffect(() => {
    if (!selectedPaper) {
      setPaperQuestions([]);
      return;
    }
    let active = true;
    setLoadingQuestions(true);
    apiClient
      .get('/api/config/paper-questions', { params: { paperTitle: selectedPaper } })
      .then((res) => {
        if (!active) return;
        const qs: PaperQuestionItem[] = res.data?.questions || [];
        setPaperQuestions(qs);
        // Smart auto-selection: if single-question upload and totalMarks matches a specific question, pre-select it; otherwise default to 'ALL'
        if (totalMarkedQuestions === 1 && qs.length > 0) {
          const uploadedMax = parsedSummary?.score?.totalMarks;
          const matchingQ = qs.find(q => Number(q.marks) === Number(uploadedMax));
          setSelectedQuestionNumber(matchingQ ? String(matchingQ.questionNumber) : 'ALL');
        } else {
          setSelectedQuestionNumber('ALL');
        }
      })
      .catch((err) => {
        console.error('Failed to load paper questions:', err);
        if (active) setPaperQuestions([]);
      })
      .finally(() => {
        if (active) setLoadingQuestions(false);
      });
    return () => { active = false; };
  }, [selectedPaper, totalMarkedQuestions, parsedSummary?.score?.totalMarks]);

  if (isNonAcademicOrJunkRejection || message.isProcessing) {
    return null;
  }

  // Only render on marking messages or requiresMarkingScheme messages
  if (!requiresMarkingScheme && !isGenericMarking && !hasOfficialExamMatch) {
    return null;
  }

  const handlePaperClick = (paperStr: string) => {
    setSelectedPaper(paperStr);
    setSearchQuery(paperStr);
  };

  const handleConfirmRemark = async () => {
    if (!selectedPaper || isSubmittingRemark || isProcessing) return;
    setIsSubmittingRemark(true);
    try {
      await onRemarkOfficialPaper({
        paperTitle: selectedPaper,
        questionNumber: selectedQuestionNumber === 'ALL' ? null : selectedQuestionNumber
      });
      setIsPaperDrawerOpen(false);
    } finally {
      setIsSubmittingRemark(false);
    }
  };

  // 0. STRICT MESSAGE TYPE GUARD: Never show on follow-up text chat responses or question-solver responses
  if (message.type === 'chat' || message.type === 'question_response') {
    return null;
  }

  if (isNonAcademicOrJunkRejection || (!requiresMarkingScheme && !isGenericMarking && !hasOfficialExamMatch && !hasCustomSchemeApplied)) {
    return null;
  }

  return (
    <div className="followup-rectification-wrapper" style={{ marginTop: '14px', marginBottom: '18px', paddingLeft: '12px', paddingRight: '12px' }}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onAttachFilesForRemark(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* CASE 1: Other Subject Requiring a Marking Scheme */}
      {requiresMarkingScheme && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '9px 16px',
              background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(79, 70, 229, 0.25)',
              opacity: isProcessing ? 0.6 : 1
            }}
          >
            <Paperclip size={16} />
            <span>Attach Marking Scheme (Free Quota)</span>
          </button>
        </div>
      )}

      {/* CASE 2: Generic Rubric Used (Unrecognized Past Paper or Answer-Only Upload) */}
      {isGenericMarking && !isPaperDrawerOpen && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          <div style={{ fontSize: '13.5px', color: 'var(--text-primary, #f3f4f6)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles color="#f59e0b" size={15} />
            <span>
              <strong>Marked with General Rubric.</strong> Is this from an official past paper, or do you have the question / marking scheme? Re-mark for 100% accuracy (Free):
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setIsPaperDrawerOpen(true)}
              style={{
                padding: '8px 14px',
                background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                fontSize: '13px',
                fontWeight: 600
              }}
            >
              <Link2 size={15} />
              <span>Select Official Past Paper / Question</span>
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '8px 14px',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: '8px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                fontSize: '13px',
                fontWeight: 600
              }}
            >
              <Paperclip size={15} />
              <span>Upload Mark Scheme / Question Paper (Free)</span>
            </button>
          </div>
        </div>
      )}

      {/* CASE 3: Official Paper Matched or Custom Scheme Applied (Subtle link in case AI guessed wrong paper/question from footer) */}
      {(hasOfficialExamMatch || hasCustomSchemeApplied) && !isPaperDrawerOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => setIsPaperDrawerOpen(true)}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: 'var(--text-secondary, #9ca3af)',
              border: '1px solid rgba(156, 163, 175, 0.3)',
              borderRadius: '6px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              fontWeight: 500
            }}
          >
            <Link2 size={13} />
            <span>Wrong paper or question detected? Amend Official Paper</span>
          </button>
        </div>
      )}

      {/* EXPANDED INLINE PAPER SEARCH & QUESTION SELECTOR (Reusing UnifiedChatInput styling) */}
      {isPaperDrawerOpen && (
        <div
          style={{
            marginTop: '8px',
            padding: '14px 16px',
            borderRadius: '12px',
            background: 'var(--bg-secondary, #1e293b)',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Link2 color="#60a5fa" size={15} />
              <span>LINK OFFICIAL PAST PAPER &amp; AMEND QUESTION</span>
            </div>
            <button
              type="button"
              onClick={() => setIsPaperDrawerOpen(false)}
              style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
            >
              <span>Close</span>
              <X size={14} />
            </button>
          </div>

          {/* Subject & Quick Filter Chips from UnifiedChatInput */}
          <div className="autocomplete-chips-section" style={{ padding: 0 }}>
            <div className="autocomplete-chips-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <button
                type="button"
                className={`filter-chip qualification ${selectedSubject === 'maths' ? 'active' : ''}`}
                onClick={() => setSelectedSubject(selectedSubject === 'maths' ? null : 'maths')}
              >
                📐 Maths
              </button>
              <button
                type="button"
                className={`filter-chip qualification ${selectedSubject === 'english' ? 'active' : ''}`}
                onClick={() => setSelectedSubject(selectedSubject === 'english' ? null : 'english')}
              >
                ✍️ English Language
              </button>

              {metadata.qualifications
                .filter((qual: string) => !(selectedSubject === 'english' && /a-level/i.test(qual)))
                .map((qual: string) => (
                  <button
                    key={qual}
                    type="button"
                    className={`filter-chip qualification ${selectedTags.includes(qual) ? 'active' : ''}`}
                    onClick={() => toggleFilterTag(qual, metadata.qualifications)}
                  >
                    {qual}
                  </button>
                ))}

              {metadata.boards.map((board: string) => (
                <button
                  key={board}
                  type="button"
                  className={`filter-chip board ${selectedTags.includes(board) ? 'active' : ''}`}
                  onClick={() => toggleFilterTag(board, metadata.boards)}
                >
                  {board}
                </button>
              ))}

              {!selectedTags.includes('A-Level') && selectedSubject !== 'english' && metadata.tiers.map((tier: string) => (
                <button
                  key={tier}
                  type="button"
                  className={`filter-chip tier ${selectedTags.includes(tier) ? 'active' : ''}`}
                  onClick={() => toggleFilterTag(tier, metadata.tiers)}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>

          {/* Search Input */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (selectedPaper && e.target.value !== selectedPaper) {
                  setSelectedPaper(null);
                }
              }}
              placeholder="Search exam board, code, or series (e.g. AQA 8700/1 June 2023, 1MA1/2H)..."
              style={{
                width: '100%',
                padding: '9px 32px 9px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#f8fafc',
                fontSize: '13.5px'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedPaper(null);
                }}
                style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Matching Paper Suggestions */}
          {!selectedPaper && filteredResults.length > 0 && (
            <div className="autocomplete-results-list" style={{ maxHeight: '180px', overflowY: 'auto', borderRadius: '8px', border: '1px solid rgba(148, 163, 184, 0.2)' }}>
              {filteredResults.map((result: string) => (
                <div
                  key={result}
                  className="autocomplete-item"
                  onClick={() => handlePaperClick(result)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px' }}
                >
                  <Brain className="suggestion-icon" size={13} />
                  <span className="suggestion-text" style={{ flex: 1, fontSize: '13px' }}>{formatPaperDisplayLabel(result)}</span>
                  {selectedPaper === result && <Check className="check-icon" size={14} />}
                </div>
              ))}
            </div>
          )}

          {/* Step 2: Dynamic Question Pills once a paper is chosen */}
          {selectedPaper && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
              <div style={{ fontSize: '12.5px', color: '#cbd5e1', fontWeight: 600 }}>
                Target Question (for single-question / answer-only uploads, select the specific question):
              </div>
              {loadingQuestions ? (
                <div style={{ fontSize: '12.5px', color: '#94a3b8' }}>Loading questions from paper...</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedQuestionNumber('ALL')}
                    style={{
                      padding: '5px 11px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: selectedQuestionNumber === 'ALL' ? '1px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.3)',
                      background: selectedQuestionNumber === 'ALL' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(15, 23, 42, 0.4)',
                      color: selectedQuestionNumber === 'ALL' ? '#60a5fa' : '#cbd5e1'
                    }}
                  >
                    ● All Detected Questions
                  </button>
                  {paperQuestions.map((q) => {
                    const isSelected = String(selectedQuestionNumber) === String(q.questionNumber);
                    return (
                      <button
                        key={q.questionNumber}
                        type="button"
                        onClick={() => setSelectedQuestionNumber(String(q.questionNumber))}
                        style={{
                          padding: '5px 11px',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: isSelected ? '1px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.3)',
                          background: isSelected ? 'rgba(59, 130, 246, 0.25)' : 'rgba(15, 23, 42, 0.4)',
                          color: isSelected ? '#60a5fa' : '#cbd5e1'
                        }}
                      >
                        Q{q.questionNumber} ({q.marks}m)
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Action Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={() => setIsPaperDrawerOpen(false)}
              style={{
                padding: '7px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                background: 'transparent',
                color: '#cbd5e1',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedPaper || isSubmittingRemark || isProcessing}
              onClick={handleConfirmRemark}
              style={{
                padding: '7px 16px',
                borderRadius: '8px',
                border: 'none',
                background: selectedPaper ? 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' : 'rgba(148, 163, 184, 0.2)',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: !selectedPaper || isSubmittingRemark ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <RefreshCw className={isSubmittingRemark ? 'animate-spin' : ''} size={14} />
              <span>{isSubmittingRemark ? 'Re-Marking...' : 'Re-Mark Now (Free)'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
