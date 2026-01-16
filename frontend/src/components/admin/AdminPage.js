import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Trash2,
  Database,
  ClipboardList,
  Search,
  Award,
  BarChart,
  RefreshCw,
  CreditCard
} from 'lucide-react';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
import { useAuth } from '../../contexts/AuthContext';
import ApiClient from '../../services/apiClient';
import MarkdownMathRenderer from '../marking/MarkdownMathRenderer';
import './AdminPage.css';

// Utility functions
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Invalid Date';
  }
};

const formatMode = (mode) => {
  if (!mode) return 'Unknown';
  // Capitalize first letter and handle hyphenated modes
  return mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-/g, ' ');
};

/**
 * Normalize exam board name for comparison
 */
const normalizeExamBoard = (board) => {
  if (!board) return '';
  const normalized = board.toLowerCase().trim();
  // Map common variations
  if (normalized.includes('edexcel')) return 'Pearson Edexcel';
  if (normalized.includes('aqa')) return 'AQA';
  if (normalized.includes('ocr')) return 'OCR';
  if (normalized.includes('wjec')) return 'WJEC';
  if (normalized.includes('eduqas')) return 'Eduqas';
  return board; // Return original if no match
};

/**
 * Normalize exam series mapping (e.g., "May 2024" to "June 2024" for Edexcel)
 */
const normalizeExamSeries = (series, board) => {
  if (!series) return '';
  const normalizedSeries = series.trim();
  const normalizedBoard = board ? normalizeExamBoard(board) : '';

  // Pearson Edexcel: map "May [Year]", "June [Year]" to "Summer [Year]"
  if (normalizedBoard === 'Pearson Edexcel') {
    if (/^(May|June|Summer)\s+\d{4}$/i.test(normalizedSeries)) {
      return normalizedSeries.replace(/^(May|June|Summer)/i, 'Summer');
    }
  }

  // OCR: map "May [Year]" to "June [Year]" (Series is often stored as June in schemes)
  if (normalizedBoard === 'OCR') {
    if (/^May\s+\d{4}$/i.test(normalizedSeries)) {
      return normalizedSeries.replace(/^May/i, 'June');
    }
  }

  return normalizedSeries;
};

/**
 * Helper to get marks for a single question or sub-question (recursively)
 */
const getQuestionMarksRecursive = (q) => {
  const pMark = parseFloat(q.marks) || parseFloat(q.max_marks) || parseFloat(q.total_marks) || 0;
  const subQs = q.subQuestions || q.sub_questions || [];

  if (subQs.length === 0) return pMark;

  const subSum = subQs.reduce((total, sq) => total + getQuestionMarksRecursive(sq), 0);

  // Return the higher of parent vs sub-sum to be robust against partial scraping
  return Math.max(pMark, subSum);
};

/**
 * Calculate total marks for an exam paper
 * Returns { total, audit: { qNum: marks } }
 */
const calculateExamTotalMarksDetailed = (questions) => {
  if (!Array.isArray(questions)) return { total: 0, audit: {} };
  const audit = {};
  const total = questions.reduce((sum, q, idx) => {
    const qNum = String(q.number || q.questionNumber || q.question_number || (idx + 1));
    const marks = getQuestionMarksRecursive(q);
    audit[qNum] = marks;
    return sum + marks;
  }, 0);
  return { total, audit };
};

const calculateExamTotalMarks = (questions) => calculateExamTotalMarksDetailed(questions).total;



// Format marking scheme as Markdown
const formatMarkingSchemeAsMarkdown = (marks) => {
  if (!marks || !Array.isArray(marks)) {
    return 'No marks available';
  }

  return marks.map((mark, index) => {
    const markCode = mark.mark || `M${index + 1}`;
    let answer = mark.answer || '';

    // Convert LaTeX math expressions to Markdown format
    // Convert \frac{a}{b} to $\frac{a}{b}$
    answer = answer.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$\\frac{$1}{$2}$');
    // Convert \sqrt{x} to $\sqrt{x}$
    answer = answer.replace(/\\sqrt\{([^}]+)\}/g, '$\\sqrt{$1}$');
    // Convert \pi, \alpha, \beta, etc. to $\pi$, $\alpha$, $\beta$
    answer = answer.replace(/\\[a-zA-Z]+/g, (match) => `$${match}$`);
    // Convert standalone numbers in math context to $number$
    answer = answer.replace(/(?<!\$)\b(\d+(?:\.\d+)?)\b(?!\$)/g, (match, number) => {
      // Only convert if it's in a mathematical context (surrounded by math symbols)
      const before = answer.substring(0, answer.indexOf(match));
      const after = answer.substring(answer.indexOf(match) + match.length);
      const mathContext = /[+\-*/=<>(){}[\]]/.test(before.slice(-1)) || /[+\-*/=<>(){}[\]]/.test(after[0]);
      return mathContext ? `$${number}$` : number;
    });

    const comments = mark.comments ? ` (${mark.comments})` : '';
    return `• **${markCode}** ${answer}${comments}`;
  }).join('\n');
};

/**
 * AdminPage component for managing AI model JSON data
 * @returns {JSX.Element} The admin page component
 */
function AdminPage() {
  // Get auth context
  const { getAuthToken } = useAuth();

  // State management
  const [activeTab, setActiveTab] = useState('usage'); // Default to Usage tab
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jsonEntries, setJsonEntries] = useState([]);
  const [expandedJsonId, setExpandedJsonId] = useState(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [examBoardFilter, setExamBoardFilter] = useState('Pearson Edexcel');

  // JSON upload state
  const [jsonForm, setJsonForm] = useState({
    jsonData: ''
  });

  // Marking scheme state
  const [markingSchemeEntries, setMarkingSchemeEntries] = useState([]);
  const [expandedMarkingSchemeId, setExpandedMarkingSchemeId] = useState(null);
  const [markingSchemeForm, setMarkingSchemeForm] = useState({
    markingSchemeData: ''
  });

  // Grade boundaries state
  const [gradeBoundaryEntries, setGradeBoundaryEntries] = useState([]);
  const [expandedGradeBoundaryId, setExpandedGradeBoundaryId] = useState(null);
  const [gradeBoundaryForm, setGradeBoundaryForm] = useState({
    gradeBoundaryData: ''
  });
  const [isDeletingAllGradeBoundaries, setIsDeletingAllGradeBoundaries] = useState(false);

  // Query tab state
  const [isClearingSessions, setIsClearingSessions] = useState(false);

  // Edit Mode State for Exam Papers
  const [isEditing, setIsEditing] = useState(false);
  const [editedExamData, setEditedExamData] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRawEditMode, setIsRawEditMode] = useState(false);
  const [rawJsonBuffer, setRawJsonBuffer] = useState('');

  // Edit Mode State for Marking Schemes
  const [isMarkingSchemeEditing, setIsMarkingSchemeEditing] = useState(false);
  const [editingMarkingSchemeId, setEditingMarkingSchemeId] = useState(null);
  const [isMarkingSchemeRawEditMode, setIsMarkingSchemeRawEditMode] = useState(false);
  const [markingSchemeRawJsonBuffer, setMarkingSchemeRawJsonBuffer] = useState('');
  const [editedMarkingSchemeData, setEditedMarkingSchemeData] = useState(null);


  // Usage tab state
  const [usageData, setUsageData] = useState([]);
  const [usageSummary, setUsageSummary] = useState({
    totalCost: 0,
    totalModelCost: 0,
    totalMathpixCost: 0,
    totalUsers: 0,
    totalSessions: 0,
    totalApiRequests: 0
  });
  const [usageFilter, setUsageFilter] = useState('day');
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [isClearingUsage, setIsClearingUsage] = useState(false);
  const [expandedAdminSessions, setExpandedAdminSessions] = useState(new Set());

  // Subscriptions tab state
  const [searchUserId, setSearchUserId] = useState('');
  const [userSubscription, setUserSubscription] = useState(null);
  const [userCredits, setUserCredits] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [subscriptionsList, setSubscriptionsList] = useState([]);
  const [subscriptionsPage, setSubscriptionsPage] = useState(1);
  const [subscriptionsPagination, setSubscriptionsPagination] = useState({ total: 0, totalPages: 0 });
  const [loadingList, setLoadingList] = useState(false);
  const [subscriptionFilter, setSubscriptionFilter] = useState('active'); // Filter: 'active' or 'all'

  // Constants removed - using ApiClient instead

  // Form validation
  const isJsonFormValid = useCallback(() => {
    return jsonForm.jsonData;
  }, [jsonForm]);

  const isMarkingSchemeFormValid = useCallback(() => {
    return markingSchemeForm.markingSchemeData.trim().length > 0;
  }, [markingSchemeForm.markingSchemeData]);

  const isGradeBoundaryFormValid = useCallback(() => {
    return gradeBoundaryForm.gradeBoundaryData.trim().length > 0;
  }, [gradeBoundaryForm.gradeBoundaryData]);

  // Reset forms to initial state
  const resetJsonForm = useCallback(() => {
    setJsonForm({
      jsonData: ''
    });
  }, []);

  const resetMarkingSchemeForm = useCallback(() => {
    setMarkingSchemeForm({
      markingSchemeData: ''
    });
  }, []);

  const resetGradeBoundaryForm = useCallback(() => {
    setGradeBoundaryForm({
      gradeBoundaryData: ''
    });
  }, []);

  // Load JSON entries from fullExamPapers
  const loadJsonEntries = useCallback(async () => {
    try {
      const authToken = await getAuthToken();
      const { data } = await ApiClient.get('/api/admin/json/collections/fullExamPapers');
      const entries = Array.isArray(data.entries) ? data.entries : [];

      // Sort entries by exam board, exam series, subject
      const sortedEntries = entries.sort((a, b) => {
        const examDataA = a.data || a;
        const examMetaA = examDataA.exam || examDataA.metadata || {};
        const examDataB = b.data || b;
        const examMetaB = examDataB.exam || examDataB.metadata || {};

        const boardA = (examMetaA.board || examMetaA.exam_board || '').toLowerCase();
        const boardB = (examMetaB.board || examMetaB.exam_board || '').toLowerCase();
        if (boardA !== boardB) return boardA.localeCompare(boardB);

        const seriesA = (examMetaA.exam_series || '').toLowerCase();
        const seriesB = (examMetaB.exam_series || '').toLowerCase();
        if (seriesA !== seriesB) return seriesA.localeCompare(seriesB);

        const subjectA = (examMetaA.subject || examMetaA.qualification || '').toLowerCase();
        const subjectB = (examMetaB.subject || examMetaB.qualification || '').toLowerCase();
        return subjectA.localeCompare(subjectB);
      });

      setJsonEntries(sortedEntries);
      setLoading(false); // Set loading to false when data is loaded (even if empty)
    } catch (e) {
      setError(`Failed to load JSON entries: ${e.message}`);
      setLoading(false); // Set loading to false on error
      setTimeout(() => setError(null), 4000);
    }
  }, [getAuthToken]);

  // Helper function to check if marking scheme exists for an exam paper
  const hasMarkingScheme = useCallback((examPaper) => {
    const examData = examPaper.data || examPaper;
    const examMeta = examData.exam || examData.metadata || {};
    const board = examMeta.board || examMeta.exam_board || '';
    const examSeries = examMeta.exam_series || '';
    const code = examMeta.code || examMeta.exam_code || '';

    if (!board || !examSeries || !code) return false;

    // Normalize target
    const targetBoard = normalizeExamBoard(board);
    const targetSeries = normalizeExamSeries(examSeries, targetBoard).toLowerCase();
    const targetCode = code.trim().toLowerCase();

    return markingSchemeEntries.some(entry => {
      const schemeData = entry.data || entry;
      const examDetails = schemeData.examDetails || schemeData.exam || {};

      const schemeBoardRaw = examDetails.exam_board || examDetails.board || '';
      const schemeBoard = normalizeExamBoard(schemeBoardRaw);

      const schemeSeriesRaw = examDetails.exam_series || examDetails.date || '';
      const schemeSeries = normalizeExamSeries(schemeSeriesRaw, schemeBoard).toLowerCase();

      const schemeCode = (examDetails.exam_code || examDetails.code || examDetails.paperCode || '').trim().toLowerCase();

      // Loose series match for existing logic support
      const seriesMatch = schemeSeries === targetSeries ||
        schemeSeries === targetSeries.replace(/^june\s+/i, '');

      return schemeBoard === targetBoard && seriesMatch && schemeCode === targetCode;
    });
  }, [markingSchemeEntries]);

  // Helper function to check if grade boundary exists for an exam paper
  const hasGradeBoundary = useCallback((examPaper) => {
    const examData = examPaper.data || examPaper;
    const examMeta = examData.exam || examData.metadata || {};

    const normalize = (str) => (str || '').toLowerCase().trim();

    const rawBoard = examMeta.board || examMeta.exam_board;
    const targetBoard = normalizeExamBoard(rawBoard);

    const rawSeries = examMeta.exam_series;
    const targetSeries = normalize(normalizeExamSeries(rawSeries, targetBoard));

    const targetSubject = normalize(examMeta.subject || examMeta.qualification);
    const targetCode = normalize(examMeta.code || examMeta.exam_code);

    if (!targetBoard || !targetSeries || !targetCode) return false;

    return gradeBoundaryEntries.some(entry => {
      const boundaryData = entry.data || entry;
      const boundaryBoardRaw = boundaryData.exam_board;
      const boundaryBoard = normalizeExamBoard(boundaryBoardRaw);

      const boundarySeriesRaw = boundaryData.exam_series;
      const boundarySeries = normalize(normalizeExamSeries(boundarySeriesRaw, boundaryBoard));

      // 1. Board Match
      const boardMatch = boundaryBoard === targetBoard ||
        boundaryBoard.includes(targetBoard) ||
        targetBoard.includes(boundaryBoard);

      if (!boardMatch) return false;

      // 2. Series Match (Exact normalized)
      if (boundarySeries !== targetSeries) return false;

      // 3. Subject/Code Match
      const subjects = boundaryData.subjects || [];
      return subjects.some(subj => {
        const subjectName = normalize(subj.name);
        const subjectCode = normalize(subj.code);

        // Extract subject code from exam code (e.g., "1MA1/1H" -> "1MA1")
        const examCodePrefix = targetCode.split('/')[0];

        // Check if subject code matches prefix (e.g. "1ma1" === "1ma1")
        const codeMatch = subjectCode && (subjectCode === examCodePrefix || targetCode.startsWith(subjectCode));

        return codeMatch ||
          subjectName.includes(targetSubject) ||
          targetSubject.includes(subjectName);
      });
    });
  }, [gradeBoundaryEntries]);

  // Load marking scheme entries
  const loadMarkingSchemeEntries = useCallback(async () => {
    try {
      const authToken = await getAuthToken();
      const { data } = await ApiClient.get('/api/admin/json/collections/markingSchemes');
      const entries = data.entries || [];

      // Sort entries by exam board, exam series
      const sortedEntries = entries.sort((a, b) => {
        const examDetailsA = a.examDetails || a.markingSchemeData?.examDetails || {};
        const examDetailsB = b.examDetails || b.markingSchemeData?.examDetails || {};

        const boardA = (examDetailsA.board || examDetailsA.exam_board || '').toLowerCase();
        const boardB = (examDetailsB.board || examDetailsB.exam_board || '').toLowerCase();
        if (boardA !== boardB) return boardA.localeCompare(boardB);

        const seriesA = (examDetailsA.exam_series || examDetailsA.date || '').toLowerCase();
        const seriesB = (examDetailsB.exam_series || examDetailsB.date || '').toLowerCase();
        return seriesA.localeCompare(seriesB);
      });

      setMarkingSchemeEntries(sortedEntries);
    } catch (error) {
      console.error('Error loading marking scheme entries:', error);
      setMarkingSchemeEntries([]);
    }
  }, [getAuthToken]);

  // Load grade boundary entries
  const loadGradeBoundaryEntries = useCallback(async () => {
    try {
      const authToken = await getAuthToken();
      const { data } = await ApiClient.get('/api/admin/json/collections/gradeBoundaries');
      setGradeBoundaryEntries(data.entries || []);
    } catch (error) {
      console.error('Error loading grade boundary entries:', error);
      setGradeBoundaryEntries([]);
    }
  }, [getAuthToken]);

  // User filters state
  const [userFilters, setUserFilters] = useState({
    userId: '',
    startDate: '',
    endDate: ''
  });

  // Expanded usage sessions state


  // Load usage data
  const loadUsageData = useCallback(async (filter = 'all') => {
    try {
      setLoadingUsage(true);
      const authToken = await getAuthToken();
      const { data } = await ApiClient.get(
        `/api/admin/usage?filter=${filter}`
      );

      if (data.success) {
        setUsageData(data.usage || []);
        setUsageSummary(data.summary || {
          totalCost: 0,
          totalModelCost: 0,
          totalMathpixCost: 0,
          totalUsers: 0,
          totalSessions: 0,
          totalApiRequests: 0
        });
      }
    } catch (e) {
      setError(`Failed to load usage data: ${e.message}`);
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoadingUsage(false);
    }
  }, [getAuthToken]);

  // Delete all JSON entries
  const deleteAllJsonEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL exam paper data? This action cannot be undone.')) {
      return;
    }

    setIsDeletingAll(true);
    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete('/api/admin/json/collections/fullExamPapers/clear-all');
      console.log('All entries deleted:', result.message);
      setJsonEntries([]);
      setError(`✅ All exam paper data has been deleted successfully.`);
      setTimeout(() => setError(null), 5000);
    } catch (error) {
      console.error('Error deleting all entries:', error);
      setError(`Error deleting all entries: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsDeletingAll(false);
    }
  }, [getAuthToken]);

  // Delete individual JSON entry
  const deleteJsonEntry = useCallback(async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this exam paper? This action cannot be undone.')) {
      return;
    }

    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete(`/api/admin/json/collections/fullExamPapers/${entryId}`);
      console.log('Entry deleted:', result.message);
      setJsonEntries(prev => prev.filter(entry => entry.id !== entryId));
      setError(`✅ Exam paper deleted successfully.`);
      setTimeout(() => setError(null), 3000);
    } catch (error) {
      console.error('Error deleting entry:', error);
      setError(`Error deleting entry: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [getAuthToken]);

  // Handle Edit Mode
  const enableEditMode = useCallback((entry) => {
    const examData = entry.data || entry;
    // Deep copy to avoid mutating original state directly
    setEditedExamData(JSON.parse(JSON.stringify(examData)));
    setEditingId(entry.id);
    setIsEditing(true);
    setExpandedJsonId(entry.id); // Ensure it's expanded
  }, []);

  const cancelEditMode = useCallback(() => {
    setIsEditing(false);
    setEditedExamData(null);
    setEditingId(null);
    setIsRawEditMode(false);
    setRawJsonBuffer('');
  }, []);

  // Marking Scheme Edit Helpers
  const enableMarkingSchemeEditMode = useCallback((entry) => {
    const schemeData = entry.markingSchemeData || entry;
    setEditedMarkingSchemeData(JSON.parse(JSON.stringify(schemeData)));
    setEditingMarkingSchemeId(entry.id);
    setIsMarkingSchemeEditing(true);
    setExpandedMarkingSchemeId(entry.id);
  }, []);

  const cancelMarkingSchemeEditMode = useCallback(() => {
    setIsMarkingSchemeEditing(false);
    setEditedMarkingSchemeData(null);
    setEditingMarkingSchemeId(null);
    setIsMarkingSchemeRawEditMode(false);
    setMarkingSchemeRawJsonBuffer('');
  }, []);

  const toggleMarkingSchemeRawEditMode = useCallback(() => {
    if (!isMarkingSchemeRawEditMode) {
      setMarkingSchemeRawJsonBuffer(JSON.stringify(editedMarkingSchemeData, null, 2));
      setIsMarkingSchemeRawEditMode(true);
    } else {
      try {
        const parsed = JSON.parse(markingSchemeRawJsonBuffer);
        setEditedMarkingSchemeData(parsed);
        setIsMarkingSchemeRawEditMode(false);
      } catch (e) {
        setError(`Invalid JSON: ${e.message}`);
        setTimeout(() => setError(null), 3000);
      }
    }
  }, [isMarkingSchemeRawEditMode, editedMarkingSchemeData, markingSchemeRawJsonBuffer]);

  const toggleRawEditMode = useCallback(() => {
    if (!isRawEditMode) {
      // Switching TO Raw
      setRawJsonBuffer(JSON.stringify(editedExamData, null, 2));
      setIsRawEditMode(true);
    } else {
      // Switching FROM Raw
      try {
        const parsed = JSON.parse(rawJsonBuffer);
        setEditedExamData(parsed);
        setIsRawEditMode(false);
      } catch (e) {
        setError(`Invalid JSON: ${e.message}`);
        setTimeout(() => setError(null), 3000);
      }
    }
  }, [isRawEditMode, editedExamData, rawJsonBuffer]);

  const handleMetadataChange = useCallback((field, value) => {
    setEditedExamData(prev => {
      const updated = { ...prev };
      // Handle both nested and flat structures
      if (updated.exam) {
        updated.exam = { ...updated.exam, [field]: value };
      } else if (updated.metadata) {
        updated.metadata = { ...updated.metadata, [field]: value };
      } else {
        // Fallback or create metadata if missing (unlikely for valid entries)
        updated.metadata = { [field]: value };
      }
      return updated;
    });
  }, []);

  const handleQuestionFieldChange = useCallback((qIndex, field, value) => {
    setEditedExamData(prev => {
      const updated = { ...prev };
      if (updated.questions && updated.questions[qIndex]) {
        updated.questions[qIndex] = { ...updated.questions[qIndex], [field]: value };
      }
      return updated;
    });
  }, []);

  const handleSubQuestionFieldChange = useCallback((qIndex, sIndex, field, value) => {
    setEditedExamData(prev => {
      const updated = { ...prev };
      if (updated.questions && updated.questions[qIndex]) {
        const subQs = updated.questions[qIndex].subQuestions || updated.questions[qIndex].sub_questions;
        if (subQs && subQs[sIndex]) {
          subQs[sIndex] = { ...subQs[sIndex], [field]: value };
        }
      }
      return updated;
    });
  }, []);

  const handleMarkChange = useCallback((questionIndex, newMarks) => {
    handleQuestionFieldChange(questionIndex, 'marks', newMarks);
  }, [handleQuestionFieldChange]);

  const handleSubQuestionMarkChange = useCallback((questionIndex, subQuestionIndex, newMarks) => {
    handleSubQuestionFieldChange(questionIndex, subQuestionIndex, 'marks', newMarks);
  }, [handleSubQuestionFieldChange]);

  const addSubQuestion = useCallback((qIndex) => {
    setEditedExamData(prev => {
      const updated = { ...prev };
      if (updated.questions && updated.questions[qIndex]) {
        const q = updated.questions[qIndex];
        const subQs = [...(q.subQuestions || q.sub_questions || [])];

        // Determine next part letter (a, b, c...)
        const nextPartLetter = String.fromCharCode(97 + subQs.length);

        subQs.push({
          part: nextPartLetter,
          text: '',
          marks: '0'
        });

        // Maintain original key (subQuestions or sub_questions)
        if (q.subQuestions) q.subQuestions = subQs;
        else if (q.sub_questions) q.sub_questions = subQs;
        else q.subQuestions = subQs; // Default to camelCase
      }
      return updated;
    });
  }, []);

  const removeSubQuestion = useCallback((qIndex, sIndex) => {
    setEditedExamData(prev => {
      const updated = { ...prev };
      if (updated.questions && updated.questions[qIndex]) {
        const q = updated.questions[qIndex];
        const subQs = [...(q.subQuestions || q.sub_questions || [])];
        subQs.splice(sIndex, 1);

        if (q.subQuestions) q.subQuestions = subQs;
        else if (q.sub_questions) q.sub_questions = subQs;
      }
      return updated;
    });
  }, []);

  const removeQuestion = useCallback((qIndex) => {
    setEditedExamData(prev => {
      const updated = { ...prev };
      if (updated.questions) {
        const questions = [...updated.questions];
        questions.splice(qIndex, 1);
        updated.questions = questions;
      }
      return updated;
    });
  }, []);

  /**
   * Extract all question/sub-question numbers and copy to clipboard (V10 Admin)
   */
  const extractAndCopyQuestionNumbers = useCallback((entry) => {
    try {
      const examData = entry.data || entry;
      const questions = examData.questions || [];
      const list = [];

      questions.forEach((q, qIndex) => {
        const parentNum = (q.number || q.question_number || q.questionNumber || (qIndex + 1)).toString().trim();
        const subQs = q.subQuestions || q.sub_questions || [];

        if (subQs.length > 0) {
          subQs.forEach((sq, sIndex) => {
            const part = (sq.part || sq.question_part || sq.subQuestionNumber || String.fromCharCode(97 + sIndex)).toString().trim();
            // Combine parent + part if it doesn't already include it (e.g. "1" + "a" = "1a")
            const fullNum = (part.toLowerCase().startsWith(parentNum.toLowerCase())) ? part : `${parentNum}${part}`;
            list.push(fullNum);
          });
        } else {
          list.push(parentNum);
        }
      });

      // Join with newlines (Preserve document order)
      const textToCopy = list.join('\n');

      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          console.log('Question numbers copied to clipboard');
          setError('📋 Question list copied to clipboard');
          setTimeout(() => setError(null), 2000);
        }).catch(err => {
          console.error('Failed to copy question numbers:', err);
        });
      }
    } catch (error) {
      console.error('Error in extractAndCopyQuestionNumbers:', error);
    }
  }, [setError]);

  const saveExamPaperChanges = useCallback(async () => {
    if (!editingId) return;

    let finalData = editedExamData;

    // If in raw mode, parse the buffer first
    if (isRawEditMode) {
      try {
        finalData = JSON.parse(rawJsonBuffer);
      } catch (e) {
        setError(`Cannot save: Invalid JSON structure. ${e.message}`);
        setTimeout(() => setError(null), 5000);
        return;
      }
    }

    if (!finalData) return;

    setIsSaving(true);
    try {
      const authToken = await getAuthToken();
      await ApiClient.patch(`/api/admin/json/collections/fullExamPapers/${editingId}`, finalData);

      // Update local state
      setJsonEntries(prev => prev.map(entry => {
        if (entry.id === editingId) {
          if (entry.data) {
            return { ...entry, data: { ...entry.data, ...finalData } };
          }
          return { ...entry, ...finalData };
        }
        return entry;
      }));

      setError('✅ Changes saved successfully');
      setIsEditing(false);
      setEditedExamData(null);
      setEditingId(null);
      setIsRawEditMode(false);
      setRawJsonBuffer('');
      setTimeout(() => setError(null), 3000);
    } catch (error) {
      console.error('Error saving changes:', error);
      setError(`Failed to save changes: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [editedExamData, editingId, getAuthToken, isRawEditMode, rawJsonBuffer]);

  const saveMarkingSchemeChanges = useCallback(async () => {
    if (!editingMarkingSchemeId) return;

    let finalData = editedMarkingSchemeData;

    if (isMarkingSchemeRawEditMode) {
      try {
        finalData = JSON.parse(markingSchemeRawJsonBuffer);
      } catch (e) {
        setError(`Cannot save: Invalid JSON structure. ${e.message}`);
        setTimeout(() => setError(null), 5000);
        return;
      }
    }

    if (!finalData) return;

    setIsSaving(true);
    try {
      const authToken = await getAuthToken();
      await ApiClient.patch(`/api/admin/json/collections/markingSchemes/${editingMarkingSchemeId}`, finalData);

      // Update local state
      setMarkingSchemeEntries(prev => prev.map(entry => {
        if (entry.id === editingMarkingSchemeId) {
          // Flatten if needed or keep structure
          return { ...entry, ...finalData, markingSchemeData: finalData };
        }
        return entry;
      }));

      setError('✅ Marking scheme saved successfully');
      setIsMarkingSchemeEditing(false);
      setEditedMarkingSchemeData(null);
      setEditingMarkingSchemeId(null);
      setIsMarkingSchemeRawEditMode(false);
      setMarkingSchemeRawJsonBuffer('');
      setTimeout(() => setError(null), 3000);
    } catch (error) {
      console.error('Error saving marking scheme:', error);
      setError(`Failed to save marking scheme: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [editedMarkingSchemeData, editingMarkingSchemeId, getAuthToken, isMarkingSchemeRawEditMode, markingSchemeRawJsonBuffer]);

  // Validation Helper
  const getValidationErrors = useCallback((data) => {
    const errors = {
      totalMismatch: false,
      questionMismatches: {}, // Map of question index -> {parent, sub}
      audit: {}
    };
    if (!data || !data.questions) return errors;

    const { total: totalMarks, audit } = calculateExamTotalMarksDetailed(data.questions);
    errors.audit = audit;

    // Check total marks (Board-specific GCSE Maths check)
    const subject = (data.metadata?.subject || data.exam?.subject || '').toLowerCase();
    const board = normalizeExamBoard(data.metadata?.board || data.exam?.board || data.metadata?.exam_board || data.exam?.exam_board || '');
    const qual = (data.metadata?.qualification || data.exam?.qualification || '');

    const isGCSEMaths = subject.includes('math') && qual.includes('GCSE');

    if (isGCSEMaths) {
      // OCR J560 is 100 marks, Edexcel 1MA1 and AQA 8300 are 80 marks
      const expectedMarks = board === 'OCR' ? 100 : 80;
      if (totalMarks !== expectedMarks) {
        errors.totalMismatch = true;
        errors.expectedMarks = expectedMarks;
      }
    }

    data.questions.forEach((q, idx) => {
      const subQs = q.subQuestions || q.sub_questions || [];
      if (subQs.length > 0) {
        const subSum = subQs.reduce((s, sq) => s + getQuestionMarksRecursive(sq), 0);
        const pMark = parseFloat(q.marks) || parseFloat(q.max_marks) || parseFloat(q.total_marks) || 0;
        // Only flag if parent has non-zero marks that conflict with sub-sum
        // If parent is 0, we assume it's just a header/container (valid)
        if (pMark > 0 && pMark !== subSum && subSum > 0) {
          errors.questionMismatches[idx] = { parent: pMark, sub: subSum };
        }
      }
    });

    return errors;
  }, []);

  // Delete all marking scheme entries
  const deleteAllMarkingSchemeEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL marking scheme data? This action cannot be undone.')) {
      return;
    }

    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete('/api/admin/json/collections/markingSchemes/clear-all');
      console.log('All marking schemes deleted:', result.message);
      setMarkingSchemeEntries([]);
      setError(`✅ All marking schemes deleted successfully.`);
      setTimeout(() => setError(null), 3000);
    } catch (error) {
      console.error('Error deleting all marking schemes:', error);
      setError(`Error deleting all marking schemes: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [getAuthToken]);

  // Delete individual marking scheme entry
  const deleteMarkingSchemeEntry = useCallback(async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this marking scheme? This action cannot be undone.')) {
      return;
    }

    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete(`/api/admin/json/collections/markingSchemes/${entryId}`);
      console.log('Marking scheme deleted:', result.message);
      setMarkingSchemeEntries(prev => prev.filter(entry => entry.id !== entryId));
      setError(`✅ Marking scheme deleted successfully.`);
      setTimeout(() => setError(null), 3000);
    } catch (error) {
      console.error('Error deleting marking scheme:', error);
      setError(`Error deleting marking scheme: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [getAuthToken]);

  /**
   * Compare Exam Paper and Marking Scheme structure
   * Returns an array of mismatch descriptions or empty array if match
   */
  const checkStructureMismatch = (examPaper, markingScheme) => {
    const questions1 = examPaper.questions || [];
    const questions2 = markingScheme.questions || [];
    const mismatches = [];

    // Helper to build a structure map: "1" -> ["a", "b"], "2" -> []
    const buildMap = (qs) => {
      const map = {};
      if (!Array.isArray(qs)) return map;

      qs.forEach(q => {
        const qNum = String(q.number || q.questionNumber || q.question_number || '').trim();
        if (!qNum) return;

        const subQs = q.subQuestions || q.sub_questions || [];
        if (Array.isArray(subQs)) {
          map[qNum] = subQs.map(sq => String(sq.part || sq.question_part || sq.subQuestionNumber || '').trim()).filter(Boolean);
        } else {
          map[qNum] = [];
        }
      });
      return map;
    };

    const map1 = buildMap(questions1);
    const map2 = buildMap(questions2);

    // Flatten both maps to a set of canonical IDs (e.g. "1", "1a", "2")
    const flattenMap = (map) => {
      const flat = new Set();
      // Normalize key helper: 
      // 1. Remove "Question"/"Q" prefix (e.g. "Question 1" -> "1", "Q1" -> "1")
      // 2. Remove all non-alphanumeric characters (e.g. "1(a)" -> "1a", "1.a" -> "1a")
      // 3. Lowercase
      const normalizeKey = (k) => {
        let norm = k.toLowerCase().trim();
        norm = norm.replace(/^q(?:uestion)?\.?\s*(\d)/, '$1');
        return norm.replace(/[^a-z0-9]/g, '');
      };

      Object.keys(map).forEach(key => {
        const subs = map[key];
        const normMain = normalizeKey(key);

        if (subs && subs.length > 0) {
          subs.forEach(s => flat.add(`${normMain}${normalizeKey(s)}`));
        } else {
          flat.add(normMain);
        }
      });
      return flat;
    };

    const set1 = flattenMap(map1);
    const set2 = flattenMap(map2);

    // Compare sets


    // Compare sets
    const allKeys = new Set([...set1, ...set2]);
    const sortedKeys = Array.from(allKeys).sort((a, b) => {
      // Try numeric sort logic if possible (extract numbers)
      const getNum = (str) => parseFloat(str.match(/^\d+/)?.[0] || '0');
      const numA = getNum(a);
      const numB = getNum(b);
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });

    sortedKeys.forEach(key => {
      if (!set1.has(key)) {
        // If missing in Exam Paper, check if it's an "alt" question in Marking Scheme
        // "alt" questions are design choices and not mismatches
        if (!key.toLowerCase().endsWith('alt')) {
          mismatches.push(`Question ${key}: Missing in Exam Paper`);
        }
      } else if (!set2.has(key)) {
        // Check if maybe the main question exists in set2 but we are looking for a part?
        // e.g. key is "1a", set2 has "1".
        // Some schemes just say "1".
        const mainKey = key.match(/^\d+/)?.[0];
        if (mainKey && set2.has(mainKey) && !key.match(/^\d+$/)) {
          // Approximate match: Scheme has "1", we have "1a". 
          // Don't flag as missing if scheme has the parent, assuming it might cover parts.
          // BUT user wants precise checking. 
          // Let's flag it but maybe softer? No, strict for now.
          mismatches.push(`Question ${key}: Missing in Marking Scheme`);
        } else {
          mismatches.push(`Question ${key}: Missing in Marking Scheme`);
        }
      }
    });

    return mismatches;
  };

  // Delete all grade boundary entries
  const deleteAllGradeBoundaryEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL grade boundaries? This action cannot be undone.')) {
      return;
    }

    setIsDeletingAllGradeBoundaries(true);
    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete('/api/admin/json/collections/gradeBoundaries/clear-all');
      console.log('All grade boundaries deleted:', result.message);
      setGradeBoundaryEntries([]);
      setError(`✅ All grade boundaries deleted successfully.`);
      setTimeout(() => setError(null), 5000);
    } catch (error) {
      console.error('Error deleting all grade boundaries:', error);
      setError(`Error deleting all grade boundaries: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsDeletingAllGradeBoundaries(false);
    }
  }, [getAuthToken]);

  // Delete individual grade boundary entry
  const deleteGradeBoundaryEntry = useCallback(async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this grade boundary? This action cannot be undone.')) {
      return;
    }

    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete(`/api/admin/json/collections/gradeBoundaries/${entryId}`);
      console.log('Grade boundary deleted:', result.message);
      setGradeBoundaryEntries(prev => prev.filter(entry => entry.id !== entryId));
      setError(`✅ Grade boundary deleted successfully.`);
      setTimeout(() => setError(null), 3000);
    } catch (error) {
      console.error('Error deleting grade boundary:', error);
      setError(`Error deleting grade boundary: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [getAuthToken]);

  // Upload JSON data
  const uploadJsonData = useCallback(async () => {
    if (!isJsonFormValid()) {
      setError('Please enter valid JSON data');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.post('/api/admin/json/collections/fullExamPapers', JSON.parse(jsonForm.jsonData));
      setJsonEntries(prev => [result.entry, ...prev]);
      resetJsonForm();
      setError(`✅ JSON data uploaded successfully to fullExamPapers collection.`);
      setTimeout(() => setError(null), 5000);
    } catch (error) {
      console.error('Error uploading JSON:', error);
      setError(`Error uploading JSON: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [jsonForm, getAuthToken, resetJsonForm, isJsonFormValid]);

  // Upload marking scheme data
  const uploadMarkingSchemeData = useCallback(async () => {
    if (!isMarkingSchemeFormValid()) {
      setError('Please enter valid marking scheme data');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      // Validate JSON format first
      let parsedData;
      try {
        // Auto-remove [cite] placeholders (e.g., [cite_start], [cite: 271])
        const rawData = markingSchemeForm.markingSchemeData.replace(/\[cite[^\]]*\]/g, '');
        parsedData = JSON.parse(rawData);
      } catch (e) {
        setError('Invalid JSON format. Please check your syntax.');
        setTimeout(() => setError(null), 5000);
        return;
      }

      const authToken = await getAuthToken();
      await ApiClient.post('/api/admin/json/collections/markingSchemes', {
        markingSchemeData: parsedData
      });

      setError(null);
      resetMarkingSchemeForm();
      // Reload marking scheme entries
      loadMarkingSchemeEntries();
      // Show success message
      setError('✅ Marking scheme uploaded successfully');
      setTimeout(() => setError(null), 5000);
    } catch (error) {
      console.error('Error uploading marking scheme:', error);
      setError(`Error uploading marking scheme: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [markingSchemeForm, getAuthToken, resetMarkingSchemeForm, isMarkingSchemeFormValid, loadMarkingSchemeEntries]);

  // Upload grade boundary data
  const uploadGradeBoundaryData = useCallback(async () => {
    if (!isGradeBoundaryFormValid()) {
      setError('Please enter valid grade boundary data');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      const authToken = await getAuthToken();
      const parsedData = JSON.parse(gradeBoundaryForm.gradeBoundaryData);
      const { data: result } = await ApiClient.post('/api/admin/json/collections/gradeBoundaries', parsedData);
      console.log('Grade boundary uploaded successfully:', result);
      setGradeBoundaryEntries(prev => [result.entry, ...prev]);
      resetGradeBoundaryForm();
      setError(`✅ Grade boundary uploaded successfully.`);
      setTimeout(() => setError(null), 5000);
    } catch (error) {
      console.error('Error uploading grade boundary:', error);
      setError(`Error uploading grade boundary: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [gradeBoundaryForm, getAuthToken, resetGradeBoundaryForm, isGradeBoundaryFormValid]);

  // Clear all sessions data
  const clearAllSessions = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL chat sessions? This action cannot be undone and will remove all user conversation history.')) {
      return;
    }

    setIsClearingSessions(true);
    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete('/api/admin/clear-all-sessions');
      console.log('All sessions cleared:', result.message);
      setError(`✅ All chat sessions have been cleared successfully.`);
      setTimeout(() => setError(null), 5000);

      // Dispatch custom event to notify sidebar to refresh
      EventManager.dispatch(EVENT_TYPES.SESSIONS_CLEARED);

      // Navigate to mark homework page after clearing all sessions
      window.location.href = '/app';
    } catch (error) {
      console.error('Error clearing sessions:', error);
      setError(`Error clearing sessions: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsClearingSessions(false);
    }
  }, [getAuthToken]);

  // Clear all usage data
  const clearAllUsageData = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL usage records? This action cannot be undone.')) {
      return;
    }

    setIsClearingUsage(true);
    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete('/api/admin/usage/clear-all');
      console.log('All usage records cleared:', result.message);
      setError(`✅ All usage records have been cleared successfully.`);
      setTimeout(() => setError(null), 5000);

      // Reload usage data
      loadUsageData(usageFilter);
    } catch (error) {
      console.error('Error clearing usage records:', error);
      setError(`Error clearing usage records: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsClearingUsage(false);
    }
  }, [getAuthToken, usageFilter, loadUsageData]);



  // Refresh status checks
  const refreshStatusChecks = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadMarkingSchemeEntries(),
        loadGradeBoundaryEntries()
      ]);
      setError('✅ Status checks updated successfully');
      setTimeout(() => setError(null), 3000);
    } catch (err) {
      setError('Failed to refresh status checks');
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [loadMarkingSchemeEntries, loadGradeBoundaryEntries]);

  const toggleAdminUsageExpanded = useCallback((sessionId) => {
    setExpandedAdminSessions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  }, []);

  const handleJsonInputChange = useCallback((field, value) => {
    setJsonForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // Handle marking scheme form input changes
  const handleMarkingSchemeInputChange = useCallback((field, value) => {
    setMarkingSchemeForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // Handle grade boundary form input changes
  const handleGradeBoundaryInputChange = useCallback((field, value) => {
    setGradeBoundaryForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // Load data on component mount
  useEffect(() => {
    loadJsonEntries();
    loadMarkingSchemeEntries();
    loadGradeBoundaryEntries();
  }, [loadJsonEntries, loadMarkingSchemeEntries, loadGradeBoundaryEntries]);

  // Load usage data when tab is active or filter changes
  useEffect(() => {
    if (activeTab === 'usage') {
      loadUsageData(usageFilter);
    }
  }, [activeTab, usageFilter, loadUsageData]);

  // Load subscriptions list when tab opens or page changes
  useEffect(() => {
    if (activeTab === 'subscriptions') {
      const loadList = async () => {
        setLoadingList(true);
        try {
          const { data } = await ApiClient.get(`/api/payment/list-subscriptions?page=${subscriptionsPage}&limit=20&status=${subscriptionFilter}`);
          setSubscriptionsList(data.subscriptions);
          setSubscriptionsPagination(data.pagination);
        } catch (error) {
          console.error('Error loading subscriptions:', error);
        } finally {
          setLoadingList(false);
        }
      };
      loadList();
    }
  }, [activeTab, subscriptionsPage, subscriptionFilter]);

  // Loading state is now managed in the individual load functions

  // Render loading state - just show empty content
  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-content">
          {/* No loading screen - just empty content */}
        </div>
      </div>
    );
  }
  // Filter logic
  const renderFilterTabs = () => (
    <div className="admin-filter-tabs">
      {['All', 'Pearson Edexcel', 'AQA', 'OCR'].map(board => (
        <button
          key={board}
          className={`admin-filter-tab ${examBoardFilter === board ? 'admin-filter-tab--active' : ''}`}
          onClick={() => setExamBoardFilter(board)}
        >
          {board}
        </button>
      ))}
    </div>
  );

  const filterByBoard = (entries, getBoardFn) => {
    if (examBoardFilter === 'All') return entries;
    return entries.filter(entry => {
      const board = getBoardFn(entry);
      return board && board.toLowerCase().includes(examBoardFilter.toLowerCase());
    });
  };

  // Helper to parse Exam Series (e.g., "November 2023") into a Date for sorting
  const parseExamSeriesDate = (seriesString) => {
    if (!seriesString || seriesString === 'N/A') return new Date(0); // Oldest
    const parts = seriesString.split(' ');
    if (parts.length < 2) return new Date(0);

    const monthName = parts[0];
    const year = parseInt(parts[1]);

    const monthMap = {
      'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
      'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11
    };

    // Default to Jan if month not parsed, but year is present
    const month = monthMap[monthName] !== undefined ? monthMap[monthName] : 0;
    return new Date(year, month);
  };

  const sortEntriesByDateAndCode = (entries, getDateFn, getCodeFn, getTierFn) => {
    return [...entries].sort((a, b) => {
      const dateA = parseExamSeriesDate(getDateFn(a));
      const dateB = parseExamSeriesDate(getDateFn(b));
      const timeDiff = dateB - dateA; // Descending (Newest first)

      if (timeDiff !== 0) return timeDiff;

      // Tertiary Sort: Tier DESC (H > F usually, or specific order)
      if (getTierFn) {
        const tierA = getTierFn(a) || '';
        const tierB = getTierFn(b) || '';

        // If simple string comparison: 'H' > 'F'. So DESC puts Higher first.
        const tierDiff = tierB.localeCompare(tierA);
        if (tierDiff !== 0) return tierDiff;
      }

      // Secondary Sort: Code ASC
      const codeA = getCodeFn ? (getCodeFn(a) || '') : '';
      const codeB = getCodeFn ? (getCodeFn(b) || '') : '';
      return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
    });
  };

  const filteredJsonEntries = sortEntriesByDateAndCode(
    filterByBoard(jsonEntries, (entry) => {
      const examData = entry.data || entry;
      const examMeta = examData.exam || examData.metadata || {};
      return examMeta.board || examMeta.exam_board || JSON.stringify(entry);
    }),
    (entry) => {
      const examData = entry.data || entry;
      const examMeta = examData.exam || examData.metadata || {};
      return examMeta.exam_series || '';
    },
    (entry) => {
      const examData = entry.data || entry;
      const examMeta = examData.exam || examData.metadata || {};
      return examMeta.code || examMeta.exam_code || '';
    },
    (entry) => {
      // Extract Tier from code suffix (e.g. 1H -> H, 1F -> F)
      const examData = entry.data || entry;
      const examMeta = examData.exam || examData.metadata || {};
      const code = examMeta.code || examMeta.exam_code || '';
      if (!code) return '';
      // Capture last letter if it is F or H (case insensitive)
      const match = code.match(/([FHfh])($|\s|\/)/);
      return match ? match[1].toUpperCase() : '';
    }
  );

  const filteredMarkingSchemeEntries = sortEntriesByDateAndCode(
    filterByBoard(markingSchemeEntries, (entry) =>
      entry.examDetails?.board || entry.markingSchemeData?.examDetails?.board || ''
    ),
    (entry) => entry.examDetails?.exam_series || entry.markingSchemeData?.examDetails?.exam_series || '',
    (entry) => {
      const details = entry.examDetails || entry.markingSchemeData?.examDetails || {};
      return details.paperCode || details.exam_code || details.code || '';
    },
    (entry) => {
      const details = entry.examDetails || entry.markingSchemeData?.examDetails || {};
      const code = details.paperCode || details.exam_code || details.code || '';
      if (!code) return '';
      const match = code.match(/([FHfh])($|\s|\/)/);
      return match ? match[1].toUpperCase() : '';
    }
  );

  const filteredGradeBoundaries = sortEntriesByDateAndCode(
    filterByBoard(gradeBoundaryEntries, (entry) =>
      entry.exam_board || entry.examBoard || ''
    ),
    (entry) => entry.exam_series || entry.examSeries || '',
    (entry) => {
      // Sort by qualification/subject as fallback for code
      return (entry.qualification || '') + (entry.subjects?.[0]?.name || '');
    }
  );

  return (
    <div className="admin-page">
      <div className="admin-content">
        <div className="admin-header">
          <h1>Admin Panel</h1>
          <p>Manage AI model JSON data and system operations</p>
        </div>

        {/* Error Display */}
        {error && (
          <div className={`alert ${error.includes('✅') ? 'alert-success' : 'alert-error'}`}>
            {error}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === 'usage' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('usage')}
          >
            <BarChart size={16} />
            Usage
          </button>
          <button
            className={`admin-tab ${activeTab === 'json' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('json')}
          >
            <Database size={16} />
            Exam JSON
          </button>
          <button
            className={`admin-tab ${activeTab === 'marking-scheme' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('marking-scheme')}
          >
            <ClipboardList size={16} />
            Marking Scheme
          </button>
          <button
            className={`admin-tab ${activeTab === 'grade-boundaries' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('grade-boundaries')}
          >
            <Award size={16} />
            Grade Boundaries
          </button>
          <button
            className={`admin-tab ${activeTab === 'query' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('query')}
          >
            <Search size={16} />
            Query
          </button>
          <button
            className={`admin-tab ${activeTab === 'subscriptions' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('subscriptions')}
          >
            <CreditCard size={16} />
            Subscriptions
          </button>
        </div>

        {/* Usage Tab */}
        {activeTab === 'usage' && (
          <div className="admin-tab-content">
            <div className="admin-section-header">
              <h2 className="admin-section-header__title">Usage Statistics</h2>
              <p>View cost breakdown and usage statistics for all users</p>
            </div>

            {/* Summary Header */}
            <div className="usage-summary-header">
              <div className="usage-summary-card">
                <div className="usage-summary-label">Total Cost</div>
                <div className="usage-summary-value">${usageSummary.totalCost.toFixed(2)}</div>
              </div>
              <div className="usage-summary-card">
                <div className="usage-summary-label">Model Cost</div>
                <div className="usage-summary-value">${(usageSummary.totalModelCost || 0).toFixed(2)}</div>
              </div>
              <div className="usage-summary-card">
                <div className="usage-summary-label">Mathpix Cost</div>
                <div className="usage-summary-value">${usageSummary.totalMathpixCost.toFixed(2)}</div>
              </div>
              <div className="usage-summary-card">
                <div className="usage-summary-label">Total Users</div>
                <div className="usage-summary-value">{usageSummary.totalUsers}</div>
              </div>
              <div className="usage-summary-card">
                <div className="usage-summary-label">Total Sessions</div>
                <div className="usage-summary-value">{usageSummary.totalSessions}</div>
              </div>
              <div className="usage-summary-card">
                <div className="usage-summary-label">Total API Requests</div>
                <div className="usage-summary-value">{usageSummary.totalApiRequests || 0}</div>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="usage-filter-tabs">
              <button
                className={`usage-filter-tab ${usageFilter === 'all' ? 'usage-filter-tab--active' : ''}`}
                onClick={() => setUsageFilter('all')}
              >
                All
              </button>
              <button
                className={`usage-filter-tab ${usageFilter === 'year' ? 'usage-filter-tab--active' : ''}`}
                onClick={() => setUsageFilter('year')}
              >
                Year
              </button>
              <button
                className={`usage-filter-tab ${usageFilter === 'month' ? 'usage-filter-tab--active' : ''}`}
                onClick={() => setUsageFilter('month')}
              >
                Month
              </button>
              <button
                className={`usage-filter-tab ${usageFilter === 'week' ? 'usage-filter-tab--active' : ''}`}
                onClick={() => setUsageFilter('week')}
              >
                Week
              </button>
              <button
                className={`usage-filter-tab ${usageFilter === 'yesterday' ? 'usage-filter-tab--active' : ''}`}
                onClick={() => setUsageFilter('yesterday')}
              >
                Yesterday
              </button>
              <button
                className={`usage-filter-tab ${usageFilter === 'day' ? 'usage-filter-tab--active' : ''}`}
                onClick={() => setUsageFilter('day')}
              >
                Day
              </button>
            </div>

            {/* Usage Table */}
            <div className="admin-data-section">
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Usage Records ({usageData.length})</h3>
                {usageData.length > 0 && (
                  <button
                    className="admin-btn admin-btn--danger"
                    onClick={clearAllUsageData}
                    disabled={isClearingUsage}
                  >
                    {isClearingUsage ? 'Clearing...' : 'Clear All Usage Data'}
                  </button>
                )}
              </div>

              {loadingUsage ? (
                <div className="admin-empty-state">
                  <p className="admin-empty-state__text">Loading usage data...</p>
                </div>
              ) : usageData.length === 0 ? (
                <div className="admin-empty-state">
                  <p className="admin-empty-state__text">No usage data found</p>
                </div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th className="admin-table__header">User ID</th>
                        <th className="admin-table__header">Created At</th>
                        <th className="admin-table__header">Mode</th>
                        <th className="admin-table__header">Model Used</th>
                        <th className="admin-table__header">API Requests</th>
                        <th className="admin-table__header">Total Cost</th>
                        <th className="admin-table__header">Model Cost</th>
                        <th className="admin-table__header">Mathpix Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.map((session) => {
                        // We need a state for expanded sessions. Since this is a massive component, 
                        // and we can't easily add a new top-level state right here without viewing the top of the file,
                        // we will assume we added 'const [expandedUsageSessions, setExpandedUsageSessions] = useState(new Set());'
                        // at the component level. 
                        // WAIT: use view_file to check component top first?
                        // Actually, I'll use a local variable for now, but really I need to add the state hook.
                        // Implemented check: I will inject the state hook in a separate tool call if needed.
                        // For now, let's assume 'expandedUsageRows' is available or I will add it.
                        // Let's use a unique name: expandedAdminSessions

                        const isExpanded = expandedAdminSessions.has(session.sessionId);
                        const hasHistory = session.modeHistory && session.modeHistory.length > 1;

                        return (
                          <React.Fragment key={session.sessionId}>
                            <tr className={`admin-table__row ${isExpanded ? 'admin-row-expanded' : ''}`}>
                              <td className="admin-table__cell">{session.userId}</td>
                              <td className="admin-table__cell">{formatDate(session.createdAt)}</td>
                              <td className="admin-table__cell">
                                {hasHistory ? (
                                  <button
                                    className="mode-expand-btn"
                                    style={{ padding: 0, fontSize: '12px' }}
                                    onClick={() => toggleAdminUsageExpanded(session.sessionId)}
                                  >
                                    {isExpanded ? (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    ) : (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    )}
                                    <span className={`status-badge ${session.mode === 'marking' ? 'status-badge--primary' : 'status-badge--secondary'}`}>
                                      {formatMode(session.mode)}
                                    </span>
                                  </button>
                                ) : (
                                  <span className={`status-badge ${session.mode === 'marking' ? 'status-badge--primary' : 'status-badge--secondary'}`}>
                                    {formatMode(session.mode)}
                                  </span>
                                )}
                              </td>
                              <td className="admin-table__cell">{session.modelUsed}</td>
                              <td className="admin-table__cell">{session.apiRequests || 0}</td>
                              <td className="admin-table__cell">${session.totalCost.toFixed(4)}</td>
                              <td className="admin-table__cell">${(session.modelCost || 0).toFixed(4)}</td>
                              <td className="admin-table__cell">${session.mathpixCost.toFixed(4)}</td>
                            </tr>
                            {isExpanded && session.modeHistory && session.modeHistory.map((h, i, arr) => {
                              let usageCost = 0;
                              // Logic for deltas
                              if (i < arr.length - 1) {
                                const next = arr[i + 1];
                                usageCost = next.costAtSwitch - h.costAtSwitch;
                              } else {
                                usageCost = session.totalCost - h.costAtSwitch;
                              }

                              const apiDelta = (h.apiRequestsAtSwitch !== undefined && i < arr.length - 1)
                                ? (arr[i + 1].apiRequestsAtSwitch - h.apiRequestsAtSwitch)
                                : (h.apiRequestsAtSwitch !== undefined)
                                  ? (session.apiRequests - h.apiRequestsAtSwitch)
                                  : null;

                              const aiCostDelta = (h.modelCostAtSwitch !== undefined && i < arr.length - 1)
                                ? (arr[i + 1].modelCostAtSwitch - h.modelCostAtSwitch)
                                : (h.modelCostAtSwitch !== undefined)
                                  ? ((session.modelCost || 0) - h.modelCostAtSwitch)
                                  : null;

                              return (
                                <tr key={`history-${i}`} className="usage-history-row">
                                  <td className="admin-table__cell">{/* Spacer for User ID column */}</td>
                                  <td className="admin-table__cell" style={{ paddingLeft: '32px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {new Date(h.timestamp).toLocaleString(undefined, {
                                      year: 'numeric', month: '2-digit', day: '2-digit',
                                      hour: '2-digit', minute: '2-digit'
                                    })}
                                  </td>
                                  <td className="admin-table__cell">
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{formatMode(h.mode)}</span>
                                  </td>
                                  <td className="admin-table__cell" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {h.modelUsed || '-'}
                                  </td>
                                  <td className="admin-table__cell" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {apiDelta !== null ? apiDelta : '-'}
                                  </td>
                                  <td className="admin-table__cell" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    ${Math.max(0, usageCost).toFixed(4)}
                                  </td>
                                  <td className="admin-table__cell" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {aiCostDelta !== null ? `$${aiCostDelta.toFixed(4)}` : '-'}
                                  </td>
                                  <td className="admin-table__cell">{/* Mathpix column removed/empty per request */}</td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Exam JSON Tab */}
        {activeTab === 'json' && (
          <div className="admin-tab-content">
            <div className="admin-section-header">
              <h2 className="admin-section-header__title">Full Exam Papers</h2>
              <p>Manage AI model training data for exam papers</p>
            </div>

            {/* JSON Upload Form */}
            <div className="admin-upload-section">
              <div className="upload-form">
                <div className="admin-form-group">
                  <textarea
                    id="jsonData"
                    value={jsonForm.jsonData}
                    onChange={(e) => handleJsonInputChange('jsonData', e.target.value)}
                    placeholder="Paste your JSON data here..."
                    rows={8}
                    className="admin-form-control"
                  />
                </div>
                <div className="admin-form-actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    onClick={uploadJsonData}
                    disabled={loading || !isJsonFormValid()}
                  >
                    <FileText size={16} />
                    {loading ? 'Uploading...' : 'Upload to fullExamPapers'}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--secondary"
                    onClick={resetJsonForm}
                  >
                    Clear Form
                  </button>
                </div>
              </div>
            </div>

            {/* Exam JSON List */}
            <div className="admin-data-section">
              {renderFilterTabs()}
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Full Exam Papers ({filteredJsonEntries.length})</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="admin-btn admin-btn--secondary"
                    onClick={refreshStatusChecks}
                    disabled={loading}
                    title="Refresh status checks"
                    style={{ marginBottom: 0 }}
                  >
                    <RefreshCw size={16} className={loading ? 'spin-animation' : ''} />
                    Refresh Status
                  </button>
                  {jsonEntries.length > 0 && (
                    <button
                      className="admin-btn admin-btn--danger"
                      onClick={deleteAllJsonEntries}
                      disabled={isDeletingAll}
                    >
                      {isDeletingAll ? 'Deleting...' : 'Delete All'}
                    </button>
                  )}
                </div>
              </div>

              {jsonEntries.length === 0 ? (
                <div className="empty-state">
                  <Database size={48} />
                  <p>No exam paper data found</p>
                  <p>Upload JSON data to get started</p>
                </div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th className="admin-table__header">Exam Paper</th>
                        <th className="admin-table__header">Exam Series</th>
                        <th className="admin-table__header">Qualification</th>
                        <th className="admin-table__header">Subject</th>
                        <th className="admin-table__header">Tier</th>
                        <th className="admin-table__header">Total Marks</th>
                        <th className="admin-table__header">Has Marking Scheme</th>
                        <th className="admin-table__header">Has Grade Boundary</th>
                        <th className="admin-table__header">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let lastSeries = null;
                        let isOdd = false;

                        return filteredJsonEntries.map(entry => {
                          // Handle multiple data structures: entry.exam, entry.data.exam, entry.metadata
                          const examData = entry.data || entry;
                          const examMeta = examData.exam || examData.metadata || {};

                          // Map new field names to old field names for compatibility
                          const board = examMeta.board || examMeta.exam_board || 'N/A';
                          const examSeries = examMeta.exam_series || 'N/A';
                          const qualification = examMeta.qualification || 'N/A';
                          const subject = examMeta.subject || 'N/A';
                          const session = examMeta.session || examMeta.time_allowed || 'N/A';
                          const code = examMeta.code || examMeta.exam_code || 'N/A';
                          const tier = examMeta.tier || 'N/A';

                          // Use database fields for question counts
                          const questionsList = Array.isArray(examData.questions) ? examData.questions : [];
                          const questionCount = examMeta.totalQuestions || examMeta.total_questions || questionsList.length;
                          const subQuestionCount = examMeta.questionsWithSubQuestions || examMeta.questions_with_subquestions ||
                            questionsList.reduce((total, q) => total + ((q.subQuestions || q.sub_questions) ? (q.subQuestions || q.sub_questions).length : 0), 0);

                          // Calculate total marks using the smarter helper
                          const totalMarks = calculateExamTotalMarks(questionsList);


                          // Check if marking scheme and grade boundary exist
                          const hasScheme = hasMarkingScheme(entry);
                          const hasBoundary = hasGradeBoundary(entry);

                          // Determine render group color
                          const currentGroupSeries = entry.normalizedSeries || examSeries;
                          if (currentGroupSeries !== lastSeries) {
                            isOdd = !isOdd;
                            lastSeries = currentGroupSeries;
                          }

                          return (
                            <React.Fragment key={entry.id}>
                              <tr className={`admin-table__row ${isOdd ? 'admin-row-odd' : 'admin-row-even'}`}>
                                <td className="admin-table__cell exam-paper-link">
                                  <div
                                    className="clickable-exam-paper"
                                    onClick={() => {
                                      const newId = expandedJsonId === entry.id ? null : entry.id;
                                      setExpandedJsonId(newId);
                                      if (newId) {
                                        extractAndCopyQuestionNumbers(entry);
                                      }
                                    }}
                                    title="Click to view exam paper content"
                                  >
                                    <span className="exam-paper-name">
                                      {board !== 'N/A' ?
                                        `${board} ${examSeries} ${code}`.replace(/\s+/g, ' ').trim() :
                                        examData.originalName || examData.filename || entry.id
                                      }
                                    </span>
                                    <span className="expand-indicator">
                                      {expandedJsonId === entry.id ? '▼' : '▶'}
                                    </span>
                                  </div>
                                </td>
                                <td className="admin-table__cell">{examSeries}</td>
                                <td className="admin-table__cell">{qualification}</td>
                                <td className="admin-table__cell">{subject}</td>
                                <td className="admin-table__cell">{tier}</td>
                                <td className="admin-table__cell">
                                  {examData.questions ? (
                                    <span className="mark-count">
                                      <span style={{
                                        color: (subject || '').toLowerCase().includes('math') && (qualification || '').includes('GCSE') && (
                                          (normalizeExamBoard(board) === 'OCR' && totalMarks !== 100) ||
                                          (normalizeExamBoard(board) !== 'OCR' && totalMarks !== 80)
                                        ) ? '#ef4444' : 'inherit',
                                        fontWeight: (subject || '').toLowerCase().includes('math') && (qualification || '').includes('GCSE') && (
                                          (normalizeExamBoard(board) === 'OCR' && totalMarks !== 100) ||
                                          (normalizeExamBoard(board) !== 'OCR' && totalMarks !== 80)
                                        ) ? 'bold' : 'normal'
                                      }}>
                                        {totalMarks} marks
                                      </span>

                                    </span>
                                  ) : (
                                    <span className="no-marks">No marks</span>
                                  )}
                                </td>
                                <td className="admin-table__cell">
                                  {(() => {
                                    // Logic to find marking scheme for mismatched check
                                    // We replicate the finder logic here to properly conditionally color the badge
                                    // Note: reusing the loop context 'board', 'examSeries', 'code'

                                    const matchingScheme = markingSchemeEntries.find(s => {
                                      const sData = s.data || s;
                                      // Marking schemes often store meta in examDetails
                                      const sMeta = sData.examDetails || sData.exam || sData.metadata || {};

                                      const sBoard = normalizeExamBoard(sMeta.board || sMeta.exam_board);
                                      const tBoard = normalizeExamBoard(board);
                                      const sSeries = normalizeExamSeries(sMeta.exam_series || sMeta.date, sBoard).toLowerCase();
                                      const tSeries = normalizeExamSeries(examSeries, tBoard).toLowerCase();
                                      const sCode = (sMeta.code || sMeta.exam_code || sMeta.paperCode || '').trim().toLowerCase();
                                      const tCode = code.trim().toLowerCase();

                                      return sBoard === tBoard &&
                                        (sSeries === tSeries || sSeries === tSeries.replace(/^june\s+/i, '')) &&
                                        sCode === tCode;
                                    });

                                    if (matchingScheme) {
                                      // Marking scheme questions are often an object { "1": {...}, "2": {...} }
                                      // We need to normalize this to an array for checkStructureMismatch
                                      const schemeData = matchingScheme.data || matchingScheme;
                                      const schemeQuestionsObj = schemeData.questions || (schemeData.markingSchemeData && schemeData.markingSchemeData.questions) || {};

                                      let schemeQuestions = [];
                                      if (Array.isArray(schemeQuestionsObj)) {
                                        schemeQuestions = schemeQuestionsObj;
                                      } else {
                                        // Convert object to array
                                        schemeQuestions = Object.entries(schemeQuestionsObj).map(([key, val]) => ({
                                          number: key,
                                          ...val
                                        }));
                                      }

                                      const mismatches = checkStructureMismatch(examData, { questions: schemeQuestions });
                                      const hasMismatch = mismatches.length > 0;

                                      return (
                                        <span
                                          className={`status-badge ${hasMismatch ? 'status-badge--warning' : 'status-badge--success'}`}
                                          style={{
                                            cursor: 'pointer',
                                            backgroundColor: hasMismatch ? '#fee2e2' : undefined,
                                            color: hasMismatch ? '#b91c1c' : undefined,
                                            borderColor: hasMismatch ? '#f87171' : undefined
                                          }}
                                          title={hasMismatch ? `Structure Mismatch:\n${mismatches.slice(0, 5).join('\n')}` : 'View Marking Scheme'}
                                          onClick={(e) => {
                                            e.stopPropagation();

                                            // Copy Mismatches to Clipboard (Admin Enhancement)
                                            if (hasMismatch) {
                                              const copyText = `Structure Mismatch for ${matchingScheme.board} ${matchingScheme.code}:\n${mismatches.join('\n')}`;
                                              navigator.clipboard.writeText(copyText).then(() => {
                                                alert('Copied structure mismatches to clipboard');
                                              }).catch(err => {
                                                console.error('Failed to copy mismatches:', err);
                                              });
                                            }

                                            console.log('Navigating to marking scheme:', matchingScheme.id);
                                            setActiveTab('marking-scheme');
                                            setExpandedMarkingSchemeId(matchingScheme.id);
                                            // Scroll attempt
                                            setTimeout(() => {
                                              const element = document.getElementById(matchingScheme.id);
                                              if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }, 100);
                                          }}
                                        >
                                          YES
                                        </span>
                                      );
                                    } else {
                                      return <span className="status-badge status-badge--warning">No</span>;
                                    }
                                  })()}
                                </td>
                                <td className="admin-table__cell">
                                  {hasBoundary ? (
                                    <span className="status-badge status-badge--success">Yes</span>
                                  ) : (
                                    <span className="status-badge status-badge--warning">No</span>
                                  )}
                                </td>
                                <td className="admin-table__cell actions-cell">
                                  <button
                                    className="admin-btn admin-btn--icon"
                                    onClick={() => {
                                      const newId = expandedJsonId === entry.id ? null : entry.id;
                                      setExpandedJsonId(newId);
                                      if (newId) {
                                        extractAndCopyQuestionNumbers(entry);
                                      }
                                    }}
                                    title="View"
                                  >
                                    <FileText size={16} />
                                  </button>
                                  <button
                                    className="admin-btn admin-btn--icon btn-danger"
                                    onClick={() => deleteJsonEntry(entry.id)}
                                    title="Delete"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </td>
                              </tr>

                              {
                                expandedJsonId === entry.id && (
                                  <tr className="admin-expanded-row">
                                    <td colSpan="8">
                                      <div className="admin-expanded-content">
                                        <div className="admin-content-header">
                                          <h4 className="admin-content-header__title">
                                            {isEditing && editingId === entry.id ? 'Editing: ' : 'Exam Paper Content: '}
                                            {
                                              board !== 'N/A' ?
                                                `${board} ${examSeries} ${code}`.replace(/\s+/g, ' ').trim() :
                                                examData.originalName || examData.filename || entry.id
                                            }</h4>
                                          <div className="admin-content-info">
                                            {isEditing && editingId === entry.id ? (
                                              <div className="admin-edit-actions">
                                                <button
                                                  className="admin-btn admin-btn--primary"
                                                  onClick={saveExamPaperChanges}
                                                  disabled={isSaving}
                                                >
                                                  {isSaving ? 'Saving...' : 'Save Changes'}
                                                </button>
                                                <button
                                                  className="admin-btn admin-btn--secondary"
                                                  onClick={toggleRawEditMode}
                                                  disabled={isSaving}
                                                >
                                                  {isRawEditMode ? '📟 Back to Structured' : '🛠️ Raw JSON'}
                                                </button>
                                                <button
                                                  className="admin-btn admin-btn--secondary"
                                                  onClick={cancelEditMode}
                                                  disabled={isSaving}
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            ) : (
                                              <>
                                                <button
                                                  className="admin-btn admin-btn--secondary"
                                                  onClick={() => enableEditMode(entry)}
                                                  style={{ marginRight: '10px' }}
                                                >
                                                  Edit
                                                </button>
                                                <button
                                                  className="admin-btn admin-btn--secondary"
                                                  onClick={() => extractAndCopyQuestionNumbers(entry)}
                                                  style={{ marginRight: '10px' }}
                                                  title="Copy all question numbers to clipboard"
                                                >
                                                  📋 Copy Numbers
                                                </button>
                                                <span className="admin-content-info__text">Questions are displayed in numerical order</span>
                                                <button
                                                  className="admin-close-btn"
                                                  onClick={() => setExpandedJsonId(null)}
                                                  title="Close"
                                                >
                                                  ×
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>

                                        {/* Use edited data if in edit mode for this entry */}
                                        {(() => {
                                          const displayData = (isEditing && editingId === entry.id) ? editedExamData : examData;
                                          const validationErrors = getValidationErrors(displayData);

                                          if (isEditing && editingId === entry.id && isRawEditMode) {
                                            return (
                                              <div className="admin-raw-edit-container">
                                                <textarea
                                                  className="admin-form-control raw-json-textarea"
                                                  value={rawJsonBuffer}
                                                  onChange={(e) => setRawJsonBuffer(e.target.value)}
                                                  rows={30}
                                                  style={{ height: '70vh', marginTop: '16px' }}
                                                />
                                              </div>
                                            );
                                          }

                                          return (displayData.questions && displayData.questions.length > 0 ? (
                                            <div className="admin-questions-content">
                                              <div className="admin-questions-summary">
                                                {isEditing && editingId === entry.id ? (
                                                  <div className="admin-metadata-editor">
                                                    <div className="meta-field">
                                                      <label>Exam Board</label>
                                                      <input
                                                        type="text"
                                                        value={displayData.exam?.board || displayData.metadata?.board || displayData.exam?.exam_board || displayData.metadata?.exam_board || ''}
                                                        onChange={(e) => handleMetadataChange('board', e.target.value)}
                                                      />
                                                    </div>
                                                    <div className="meta-field">
                                                      <label>Series</label>
                                                      <input
                                                        type="text"
                                                        value={displayData.exam?.exam_series || displayData.metadata?.exam_series || ''}
                                                        onChange={(e) => handleMetadataChange('exam_series', e.target.value)}
                                                      />
                                                    </div>
                                                    <div className="meta-field">
                                                      <label>Subject</label>
                                                      <input
                                                        type="text"
                                                        value={displayData.exam?.subject || displayData.metadata?.subject || ''}
                                                        onChange={(e) => handleMetadataChange('subject', e.target.value)}
                                                      />
                                                    </div>
                                                    <div className="meta-field">
                                                      <label>Tier</label>
                                                      <input
                                                        type="text"
                                                        value={displayData.exam?.tier || displayData.metadata?.tier || ''}
                                                        onChange={(e) => handleMetadataChange('tier', e.target.value)}
                                                      />
                                                    </div>
                                                    <div className="meta-field">
                                                      <label>Qualification</label>
                                                      <input
                                                        type="text"
                                                        value={displayData.exam?.qualification || displayData.metadata?.qualification || ''}
                                                        onChange={(e) => handleMetadataChange('qualification', e.target.value)}
                                                      />
                                                    </div>
                                                    <div className="meta-field">
                                                      <label>Code</label>
                                                      <input
                                                        type="text"
                                                        value={displayData.exam?.code || displayData.metadata?.code || displayData.exam?.exam_code || displayData.metadata?.exam_code || ''}
                                                        onChange={(e) => handleMetadataChange('code', e.target.value)}
                                                      />
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <>
                                                    <span className="admin-summary-item">
                                                      <strong>Exam Series:</strong> {examSeries}
                                                    </span>
                                                    <span className="admin-summary-item">
                                                      <strong>Total Questions:</strong> {questionCount}
                                                    </span>
                                                    <span className="admin-summary-item">
                                                      <strong>Sub-questions:</strong> {subQuestionCount}
                                                    </span>
                                                    <span className="admin-summary-item">
                                                      <strong>Total Marks:</strong>
                                                      {calculateExamTotalMarks(displayData.questions)}
                                                      {validationErrors.totalMismatch && (
                                                        <span title={`Total marks mismatch (expected ${validationErrors.expectedMarks || 80}) - check for errors below. Found: ${calculateExamTotalMarks(displayData.questions)}`} style={{ marginLeft: '8px', cursor: 'help', fontSize: '1.2em' }}>🛑</span>
                                                      )}
                                                      {Object.keys(validationErrors.questionMismatches || {}).length > 0 && (
                                                        <span title="Internal question mark conflicts detected (Parent vs Sub Sum). Check individual question items." style={{ marginLeft: '8px', cursor: 'help', fontSize: '1.2em' }}>⚠️</span>
                                                      )}
                                                    </span>
                                                  </>
                                                )}
                                              </div>

                                              {/* Audit Breakdown (Only shown if total 100/80 mismatch) */}
                                              {validationErrors.totalMismatch && validationErrors.audit && (
                                                <div className="admin-audit-section" style={{
                                                  backgroundColor: 'rgba(239, 68, 68, 0.05)',
                                                  border: '1px dashed #ef4444',
                                                  borderRadius: '8px',
                                                  padding: '12px',
                                                  marginBottom: '16px',
                                                  fontSize: '11px'
                                                }}>
                                                  <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ef4444', textTransform: 'uppercase' }}>
                                                    🔍 Mark Audit (Paper Total: {calculateExamTotalMarks(displayData.questions)})
                                                  </div>
                                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                    {Object.entries(validationErrors.audit).map(([q, m]) => (
                                                      <span key={q} style={{
                                                        padding: '2px 6px',
                                                        backgroundColor: m === 0 ? '#7f1d1d' : '#374151',
                                                        borderRadius: '6px',
                                                        color: '#ffffff',
                                                      }}>
                                                        Q{q}: <strong>{m}</strong>
                                                      </span>
                                                    ))}
                                                  </div>
                                                  <div style={{ marginTop: '8px', fontStyle: 'italic', color: '#666' }}>
                                                    Total = {Object.values(validationErrors.audit).join(' + ')} = {calculateExamTotalMarks(displayData.questions)}
                                                  </div>
                                                </div>
                                              )}

                                              {/* Detailed Structure Mismatch Alert ... */}
                                              {/* [KEEP EXISTING MISMATCH ALERT LOGIC] */}

                                              <div className="admin-questions-list">
                                                {displayData.questions.map((question, qIndex) => (
                                                  <div key={qIndex} className="admin-question-item">
                                                    <div className="admin-question-header">
                                                      <div className="admin-question-main">
                                                        {isEditing && editingId === entry.id ? (
                                                          <>
                                                            <input
                                                              type="text"
                                                              className="admin-question-number-input"
                                                              value={question.number || question.question_number || question.questionNumber || (qIndex + 1)}
                                                              onChange={(e) => handleQuestionFieldChange(qIndex, 'number', e.target.value)}
                                                            />
                                                            <textarea
                                                              className="admin-question-text-input"
                                                              value={question.text || question.question_text || question.questionText || ''}
                                                              onChange={(e) => handleQuestionFieldChange(qIndex, 'text', e.target.value)}
                                                              rows={2}
                                                            />
                                                          </>
                                                        ) : (
                                                          <>
                                                            <span className="admin-question-number">{question.number || question.question_number || question.questionNumber || (qIndex + 1)}</span>
                                                            <span className="admin-question-text">{question.text || question.question_text}</span>
                                                          </>
                                                        )}
                                                      </div>

                                                      {isEditing && editingId === entry.id ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                          {validationErrors.questionMismatches && validationErrors.questionMismatches[qIndex] && (
                                                            <span title={`Marks sum mismatch: Parent (${validationErrors.questionMismatches[qIndex].parent}) vs Sub (${validationErrors.questionMismatches[qIndex].sub})`} style={{ cursor: 'help' }}>❌</span>
                                                          )}
                                                          <div className="mark-editor">
                                                            <label>Marks</label>
                                                            <input
                                                              type="number"
                                                              className="admin-mark-input"
                                                              value={question.marks}
                                                              onChange={(e) => handleMarkChange(qIndex, e.target.value)}
                                                            />
                                                          </div>
                                                          <button
                                                            className="admin-btn admin-btn--icon admin-btn--danger"
                                                            onClick={() => removeQuestion(qIndex)}
                                                            title="Remove Question"
                                                            style={{ padding: '6px', marginLeft: '8px' }}
                                                          >
                                                            <Trash2 size={16} />
                                                          </button>
                                                        </div>
                                                      ) : (
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                          {validationErrors.questionMismatches && validationErrors.questionMismatches[qIndex] && (
                                                            <span title={`Marks sum mismatch: Parent (${validationErrors.questionMismatches[qIndex].parent}) vs Sub (${validationErrors.questionMismatches[qIndex].sub})`} style={{ marginRight: '8px', cursor: 'help', fontSize: '16px' }}>❌</span>
                                                          )}
                                                          {getQuestionMarksRecursive(question) > 0 && (
                                                            <span className="admin-question-marks">[{getQuestionMarksRecursive(question)} marks]</span>
                                                          )}
                                                        </div>
                                                      )}
                                                    </div>

                                                    {(question.subQuestions || question.sub_questions) && (question.subQuestions || question.sub_questions).length > 0 && (
                                                      <div className="admin-sub-questions">
                                                        {(question.subQuestions || question.sub_questions).map((subQ, sIndex) => (
                                                          <div key={sIndex} className="admin-sub-question-item">
                                                            <div className="admin-sub-question-content">
                                                              {isEditing && editingId === entry.id ? (
                                                                <>
                                                                  <input
                                                                    type="text"
                                                                    className="admin-sub-question-part-input"
                                                                    value={subQ.part || subQ.question_part || subQ.subQuestionNumber || ''}
                                                                    onChange={(e) => handleSubQuestionFieldChange(qIndex, sIndex, 'part', e.target.value)}
                                                                  />
                                                                  <textarea
                                                                    className="admin-sub-question-text-input"
                                                                    value={subQ.text || subQ.question_text || subQ.questionText || ''}
                                                                    onChange={(e) => handleSubQuestionFieldChange(qIndex, sIndex, 'text', e.target.value)}
                                                                    rows={1}
                                                                  />
                                                                  <button
                                                                    className="admin-btn admin-btn--icon admin-btn--danger"
                                                                    onClick={() => removeSubQuestion(qIndex, sIndex)}
                                                                    title="Remove Sub-question"
                                                                    style={{ padding: '4px', marginLeft: '4px' }}
                                                                  >
                                                                    <Trash2 size={14} />
                                                                  </button>
                                                                </>
                                                              ) : (
                                                                <>
                                                                  <span className="admin-sub-question-number">{subQ.part || subQ.question_part || subQ.subQuestionNumber || String.fromCharCode(97 + sIndex)}</span>
                                                                  <span className="admin-sub-question-text">{subQ.text || subQ.question_text}</span>
                                                                </>
                                                              )}
                                                            </div>
                                                            {isEditing && editingId === entry.id ? (
                                                              <input
                                                                type="number"
                                                                className="admin-mark-input"
                                                                value={subQ.marks}
                                                                onChange={(e) => handleSubQuestionMarkChange(qIndex, sIndex, e.target.value)}
                                                              />
                                                            ) : (
                                                              subQ.marks && (
                                                                <span className="admin-sub-question-marks">[{subQ.marks} marks]</span>
                                                              )
                                                            )}
                                                          </div>
                                                        ))}
                                                      </div>
                                                    )}

                                                    {isEditing && editingId === entry.id && (
                                                      <div className="admin-sub-question-actions" style={{ paddingLeft: '48px', marginTop: '8px', marginBottom: '12px' }}>
                                                        <button
                                                          className="admin-btn admin-btn--secondary admin-btn--sm"
                                                          onClick={() => addSubQuestion(qIndex)}
                                                        >
                                                          + Add Sub-question
                                                        </button>
                                                      </div>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="no-questions">
                                              <p>No questions found in this exam paper data.</p>
                                              <details style={{ marginTop: '16px' }}>
                                                <summary style={{ cursor: 'pointer', color: '#666' }}>View Raw Exam JSON</summary>
                                                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', background: '#f5f5f5', padding: '16px', borderRadius: '4px', marginTop: '8px' }}>
                                                  {JSON.stringify(examData, null, 2)}
                                                </pre>
                                              </details>
                                            </div>
                                          ));
                                        })()}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              }
                            </React.Fragment>
                          );
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Marking Scheme Tab */}
        {activeTab === 'marking-scheme' && (
          <div className="admin-tab-content">
            <div className="admin-section-header">
              <h2 className="admin-section-header__title">Marking Schemes</h2>
              <p>Manage marking scheme data for exam papers</p>
            </div>

            {/* Marking Scheme Upload Form */}
            <div className="admin-upload-section">
              <div className="upload-form">
                <div className="admin-form-group">
                  <textarea
                    id="markingSchemeData"
                    value={markingSchemeForm.markingSchemeData}
                    onChange={(e) => handleMarkingSchemeInputChange('markingSchemeData', e.target.value)}
                    placeholder="Paste your marking scheme data here..."
                    rows={8}
                    className="admin-form-control"
                  />
                </div>
                <div className="admin-form-actions">
                  <button
                    type="button"
                    onClick={uploadMarkingSchemeData}
                    disabled={!isMarkingSchemeFormValid()}
                    className="admin-btn admin-btn--primary"
                  >
                    <FileText size={16} />
                    Upload Marking Scheme
                  </button>
                  <button
                    type="button"
                    onClick={resetMarkingSchemeForm}
                    className="admin-btn admin-btn--secondary"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Marking Scheme List */}
            <div className="admin-data-section">
              {renderFilterTabs()}
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Marking Schemes ({filteredMarkingSchemeEntries.length})</h3>
                {markingSchemeEntries.length > 0 && (
                  <button
                    onClick={deleteAllMarkingSchemeEntries}
                    className="admin-btn admin-btn--danger"
                    disabled={isDeletingAll}
                  >
                    <Trash2 size={16} />
                    Delete All
                  </button>
                )}
              </div>

              {markingSchemeEntries.length === 0 ? (
                <div className="no-data">
                  <p>No marking schemes uploaded yet.</p>
                </div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th className="admin-table__header">Marking Scheme</th>
                        <th className="admin-table__header">Qualification</th>
                        <th className="admin-table__header">Subject</th>
                        <th className="admin-table__header">Exam Series</th>
                        <th className="admin-table__header">Uploaded</th>
                        <th className="admin-table__header">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let lastSeries = null;
                        let isOdd = false;

                        return filteredMarkingSchemeEntries.map(entry => {
                          // Extract exam details from either structure
                          const examDetails = entry.examDetails || entry.markingSchemeData?.examDetails || {};
                          const questions = entry.questions || entry.markingSchemeData?.questions || {};

                          // Get display values
                          const board = examDetails.board || 'N/A';
                          const qualification = examDetails.qualification || 'N/A';
                          const subject = examDetails.subject || 'N/A';
                          const paperCode = examDetails.paperCode || 'N/A';
                          const examSeries = examDetails.exam_series || 'N/A';

                          // Calculate counts
                          const sortedQuestionKeys = Object.keys(questions).sort((a, b) => {
                            const numA = parseInt(a);
                            const numB = parseInt(b);
                            if (!isNaN(numA) && !isNaN(numB)) {
                              return numA - numB;
                            }
                            return a.localeCompare(b);
                          });
                          const questionCount = entry.totalQuestions || sortedQuestionKeys.length || 0;

                          // Determine render group color
                          const currentGroupSeries = entry.normalizedSeries || examSeries;
                          if (currentGroupSeries !== lastSeries) {
                            isOdd = !isOdd;
                            lastSeries = currentGroupSeries;
                          }

                          return (
                            <React.Fragment key={entry.id}>
                              <tr className={`admin-table__row ${isOdd ? 'admin-row-odd' : 'admin-row-even'}`}>
                                <td className="admin-table__cell exam-paper-link">
                                  <div
                                    className="clickable-exam-paper"
                                    onClick={() => {
                                      const newExpandedId = expandedMarkingSchemeId === entry.id ? null : entry.id;
                                      setExpandedMarkingSchemeId(newExpandedId);
                                    }}
                                    title="Click to view marking scheme content"
                                  >
                                    <span className="exam-paper-name">
                                      {board !== 'N/A' ?
                                        `${board} ${qualification} - ${paperCode}`.replace(/\s+/g, ' ').trim() :
                                        `Marking Scheme ${entry.id}`
                                      }
                                    </span>
                                    <span className="expand-indicator">
                                      {expandedMarkingSchemeId === entry.id ? '▼' : '▶'}
                                    </span>
                                  </div>
                                </td>
                                <td className="admin-table__cell">{qualification}</td>
                                <td className="admin-table__cell">{subject}</td>
                                <td className="admin-table__cell">{examSeries}</td>
                                <td className="admin-table__cell">{formatDate(entry.createdAt || entry.uploadedAt)}</td>
                                <td className="admin-table__cell actions-cell">
                                  <button
                                    className="admin-btn admin-btn--icon"
                                    onClick={() => setExpandedMarkingSchemeId(expandedMarkingSchemeId === entry.id ? null : entry.id)}
                                    title="View"
                                  >
                                    <ClipboardList size={16} />
                                  </button>
                                  <button
                                    className="admin-btn admin-btn--icon"
                                    onClick={() => enableMarkingSchemeEditMode(entry)}
                                    title="Edit"
                                  >
                                    <FileText size={16} />
                                  </button>
                                  <button
                                    className="admin-btn admin-btn--icon btn-danger"
                                    onClick={() => deleteMarkingSchemeEntry(entry.id)}
                                    title="Delete"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </td>
                              </tr>

                              {/* Expanded content row */}
                              {expandedMarkingSchemeId === entry.id && (
                                <tr className="admin-expanded-row">
                                  <td colSpan="8" className="admin-expanded-cell">
                                    <div className="admin-expanded-content">
                                      <div className="admin-content-header">
                                        <h4 className="admin-content-header__title">
                                          {isMarkingSchemeEditing && editingMarkingSchemeId === entry.id ? 'Editing: ' : 'Marking Scheme Details: '}
                                          {
                                            board !== 'N/A' ?
                                              `${board} ${qualification} - ${paperCode}`.replace(/\s+/g, ' ').trim() :
                                              `Marking Scheme ${entry.id}`
                                          }</h4>
                                        <div className="admin-content-info">
                                          {isMarkingSchemeEditing && editingMarkingSchemeId === entry.id ? (
                                            <div className="admin-edit-actions">
                                              <button
                                                className="admin-btn admin-btn--primary"
                                                onClick={saveMarkingSchemeChanges}
                                                disabled={isSaving}
                                              >
                                                {isSaving ? 'Saving...' : 'Save Changes'}
                                              </button>
                                              <button
                                                className="admin-btn admin-btn--secondary"
                                                onClick={toggleMarkingSchemeRawEditMode}
                                                disabled={isSaving}
                                              >
                                                {isMarkingSchemeRawEditMode ? '📟 Back to View' : '🛠️ Raw JSON'}
                                              </button>
                                              <button
                                                className="admin-btn admin-btn--secondary"
                                                onClick={cancelMarkingSchemeEditMode}
                                                disabled={isSaving}
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          ) : (
                                            <>
                                              <button
                                                className="admin-btn admin-btn--secondary"
                                                onClick={() => enableMarkingSchemeEditMode(entry)}
                                                style={{ marginRight: '10px' }}
                                              >
                                                Edit
                                              </button>
                                              <span className="admin-content-info__text">Questions are displayed in numerical order</span>
                                              <button
                                                className="admin-close-btn"
                                                onClick={() => setExpandedMarkingSchemeId(null)}
                                                title="Close"
                                              >
                                                ×
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </div>

                                      {/* Content Rendering based on Edit Mode */}
                                      {(() => {
                                        const displayData = (isMarkingSchemeEditing && editingMarkingSchemeId === entry.id) ? editedMarkingSchemeData : (entry.markingSchemeData || entry);

                                        if (isMarkingSchemeEditing && editingMarkingSchemeId === entry.id && isMarkingSchemeRawEditMode) {
                                          return (
                                            <div className="admin-raw-edit-container">
                                              <textarea
                                                className="admin-form-control raw-json-textarea"
                                                value={markingSchemeRawJsonBuffer}
                                                onChange={(e) => setMarkingSchemeRawJsonBuffer(e.target.value)}
                                                rows={30}
                                                style={{ height: '70vh', marginTop: '16px', fontFamily: 'monospace' }}
                                              />
                                            </div>
                                          );
                                        }

                                        return (
                                          <>
                                            {/* Exam Details */}
                                            {(displayData.examDetails || displayData.exam) && (
                                              <div className="admin-questions-content">
                                                <h6 className="admin-questions-summary__title">Exam Information</h6>
                                                <div className="admin-questions-summary">
                                                  <span className="admin-summary-item">
                                                    <strong>Board:</strong> {displayData.examDetails?.board || displayData.exam?.board || 'Unknown'}
                                                  </span>
                                                  <span className="admin-summary-item">
                                                    <strong>Qualification:</strong> {displayData.examDetails?.qualification || displayData.exam?.qualification || 'Unknown'}
                                                  </span>
                                                  <span className="admin-summary-item">
                                                    <strong>Paper Code:</strong> {displayData.examDetails?.paperCode || displayData.exam?.paperCode || displayData.exam?.code || 'Unknown'}
                                                  </span>
                                                  <span className="admin-summary-item">
                                                    <strong>Paper:</strong> {displayData.examDetails?.paper || displayData.exam?.paper || 'Unknown'}
                                                  </span>
                                                  <span className="admin-summary-item">
                                                    <strong>Exam Series:</strong> {displayData.examDetails?.exam_series || displayData.exam?.exam_series || 'Unknown'}
                                                  </span>
                                                </div>
                                              </div>
                                            )}

                                            {/* Summary Stats */}
                                            <div className="admin-questions-content">
                                              <h6 className="admin-questions-summary__title">Summary Statistics</h6>
                                              <div className="admin-questions-summary">
                                                <span className="admin-summary-item">
                                                  <strong>Total Questions:</strong> {displayData.questions ? Object.keys(displayData.questions).length : 'N/A'}
                                                </span>
                                                <span className="admin-summary-item">
                                                  <strong>Total Marks:</strong> {displayData.questions ?
                                                    Object.values(displayData.questions).reduce((total, question) => {
                                                      return total + (question.marks ? question.marks.length : 0);
                                                    }, 0) : 'N/A'}
                                                </span>
                                              </div>
                                            </div>

                                            {/* Questions List */}
                                            {displayData.questions && (
                                              <div className="admin-questions-content">
                                                <h6 className="admin-questions-summary__title">Questions ({Object.keys(displayData.questions).length})</h6>
                                                <div className="admin-questions-list">
                                                  {Object.entries(displayData.questions)
                                                    .sort(([a], [b]) => {
                                                      const numA = parseInt(a);
                                                      const numB = parseInt(b);
                                                      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                                                      return a.localeCompare(b);
                                                    })
                                                    .map(([questionNum, question]) => (
                                                      <div key={questionNum} className="admin-question-item">
                                                        <div className="admin-question-main">
                                                          <span className="admin-question-number">{questionNum}</span>
                                                          <span className="admin-question-text">
                                                            {question.answer ? `Answer: ${question.answer}` : 'No answer provided'}
                                                          </span>
                                                        </div>

                                                        {/* Marks */}
                                                        {question.marks && question.marks.length > 0 && (
                                                          <div className="admin-sub-questions">
                                                            <h6 className="admin-questions-summary__title">Marks ({question.marks.length})</h6>
                                                            <div className="markdown-marking-scheme">
                                                              {question.marks.map((mark, index) => {
                                                                const markCode = mark.mark || `M${index + 1}`;
                                                                let answer = mark.answer || '';

                                                                // Convert LaTeX math expressions to proper LaTeX delimiters for KaTeX
                                                                answer = answer.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '\\(\\frac{$1}{$2}\\)');
                                                                answer = answer.replace(/\\sqrt\{([^}]+)\}/g, '\\(\\sqrt{$1}\\)');
                                                                answer = answer.replace(/\\[a-zA-Z]+/g, (match) => `\\(${match}\\)`);
                                                                answer = answer.replace(/(?<!\$)\b(\d+(?:\.\d+)?)\b(?!\$)/g, (match, number) => {
                                                                  const before = answer.substring(0, answer.indexOf(match));
                                                                  const after = answer.substring(answer.indexOf(match) + match.length);
                                                                  const mathContext = /[+\-*/=<>(){}[\]]/.test(before.slice(-1)) || /[+\-*/=<>(){}[\]]/.test(after[0]);
                                                                  return mathContext ? `\\(${number}\\)` : number;
                                                                });

                                                                const comments = mark.comments ? ` (${mark.comments})` : '';

                                                                return (
                                                                  <div key={index} className="marking-scheme-item">
                                                                    <MarkdownMathRenderer
                                                                      content={`**${markCode}** ${answer}${comments}`}
                                                                      className="admin-markdown-content"
                                                                    />
                                                                  </div>
                                                                );
                                                              })}
                                                            </div>
                                                          </div>
                                                        )}

                                                        {/* Guidance */}
                                                        {question.guidance && question.guidance.length > 0 && (
                                                          <div className="admin-sub-questions">
                                                            <h6 className="admin-questions-summary__title">Guidance ({question.guidance.length})</h6>
                                                            {question.guidance.map((guidance, guidanceIndex) => (
                                                              <div key={guidanceIndex} className="admin-sub-question-item">
                                                                <div className="admin-sub-question-content">
                                                                  <span className="admin-sub-question-number">{guidanceIndex + 1}</span>
                                                                  <span className="admin-sub-question-text">
                                                                    <strong>Scenario:</strong> {guidance.scenario}
                                                                    {guidance.outcome && ` | <strong>Outcome:</strong> ${guidance.outcome}`}
                                                                  </span>
                                                                </div>
                                                              </div>
                                                            ))}
                                                          </div>
                                                        )}
                                                      </div>
                                                    ))}
                                                </div>
                                              </div>
                                            )}

                                            {/* Metadata */}
                                            <div className="admin-metadata-section">
                                              <h6>Metadata</h6>
                                              <div className="metadata-info">
                                                <p><strong>ID:</strong> {entry.id}</p>
                                                <p><strong>Uploaded:</strong> {formatDate(entry.createdAt || entry.uploadedAt)}</p>
                                                {entry.updatedAt && (
                                                  <p><strong>Last Updated:</strong> {formatDate(entry.updatedAt)}</p>
                                                )}
                                              </div>
                                            </div>
                                          </>
                                        );
                                      })()}

                                      <details style={{ marginTop: '16px' }}>
                                        <summary style={{ cursor: 'pointer', color: '#666' }}>View Raw Marking Scheme Data</summary>
                                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', background: '#f5f5f5', padding: '16px', borderRadius: '4px', marginTop: '8px' }}>
                                          {JSON.stringify(entry, null, 2)}
                                        </pre>
                                      </details>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Grade Boundaries Tab */}
        {activeTab === 'grade-boundaries' && (
          <div className="admin-tab-content">
            <div className="admin-section-header">
              <h2 className="admin-section-header__title">Grade Boundaries</h2>
              <p>Manage grade boundary data for exam papers</p>
            </div>

            {/* Grade Boundary Upload Form */}
            <div className="admin-upload-section">
              <div className="upload-form">
                <div className="admin-form-group">
                  <textarea
                    id="gradeBoundaryData"
                    value={gradeBoundaryForm.gradeBoundaryData}
                    onChange={(e) => handleGradeBoundaryInputChange('gradeBoundaryData', e.target.value)}
                    placeholder="Paste your grade boundary JSON data here..."
                    rows={8}
                    className="admin-form-control"
                  />
                </div>
                <div className="admin-form-actions">
                  <button
                    type="button"
                    onClick={uploadGradeBoundaryData}
                    disabled={!isGradeBoundaryFormValid()}
                    className="admin-btn admin-btn--primary"
                  >
                    <FileText size={16} />
                    Upload Grade Boundary
                  </button>
                  <button
                    type="button"
                    onClick={resetGradeBoundaryForm}
                    className="admin-btn admin-btn--secondary"
                  >
                    Clear Form
                  </button>
                </div>
              </div>
            </div>

            {/* Grade Boundary List */}
            <div className="admin-data-section">
              {renderFilterTabs()}
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Grade Boundaries ({filteredGradeBoundaries.length})</h3>
                {gradeBoundaryEntries.length > 0 && (
                  <button
                    onClick={deleteAllGradeBoundaryEntries}
                    className="admin-btn admin-btn--danger"
                    disabled={isDeletingAllGradeBoundaries}
                  >
                    <Trash2 size={16} />
                    Delete All
                  </button>
                )}
              </div>

              {gradeBoundaryEntries.length === 0 ? (
                <div className="empty-state">
                  <Database size={48} />
                  <p>No grade boundary data found</p>
                  <p>Upload JSON data to get started</p>
                </div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th className="admin-table__header">Grade Boundary</th>
                        <th className="admin-table__header">Exam Board</th>
                        <th className="admin-table__header">Qualification</th>
                        <th className="admin-table__header">Exam Series</th>
                        <th className="admin-table__header">Subjects</th>
                        <th className="admin-table__header">Uploaded</th>
                        <th className="admin-table__header">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let lastSeries = null;
                        let isOdd = false;

                        return filteredGradeBoundaries.map(entry => {
                          const examBoard = entry.exam_board || entry.examBoard || 'N/A';
                          const qualification = entry.qualification || 'N/A';
                          const examSeries = entry.exam_series || entry.examSeries || 'N/A';
                          const subjects = entry.subjects || [];
                          const subjectCount = subjects.length;

                          // Determine render group color
                          const currentGroupSeries = entry.normalizedSeries || examSeries;
                          if (currentGroupSeries !== lastSeries) {
                            isOdd = !isOdd;
                            lastSeries = currentGroupSeries;
                          }

                          return (
                            <React.Fragment key={entry.id}>
                              <tr className={`admin-table__row ${isOdd ? 'admin-row-odd' : 'admin-row-even'}`}>
                                <td className="admin-table__cell exam-paper-link">
                                  <div
                                    className="clickable-exam-paper"
                                    onClick={() => {
                                      setExpandedGradeBoundaryId(expandedGradeBoundaryId === entry.id ? null : entry.id);
                                    }}
                                    title="Click to view grade boundary details"
                                  >
                                    <span className="exam-paper-name">
                                      {examBoard !== 'N/A' ?
                                        `${examBoard} ${qualification} (${examSeries})` :
                                        `Grade Boundary ${entry.id}`
                                      }
                                    </span>
                                    <span className="expand-indicator">
                                      {expandedGradeBoundaryId === entry.id ? '▼' : '▶'}
                                    </span>
                                  </div>
                                </td>
                                <td className="admin-table__cell">{examBoard}</td>
                                <td className="admin-table__cell">{qualification}</td>
                                <td className="admin-table__cell">{examSeries}</td>
                                <td className="admin-table__cell">
                                  {subjectCount > 0 ? (
                                    <span className="question-count">
                                      {subjectCount} {subjectCount === 1 ? 'subject' : 'subjects'}
                                    </span>
                                  ) : (
                                    <span className="no-questions">No subjects</span>
                                  )}
                                </td>
                                <td className="admin-table__cell">{formatDate(entry.uploadedAt)}</td>
                                <td className="admin-table__cell actions-cell">
                                  <button
                                    className="admin-btn admin-btn--icon"
                                    onClick={() => setExpandedGradeBoundaryId(expandedGradeBoundaryId === entry.id ? null : entry.id)}
                                    title="View"
                                  >
                                    <FileText size={16} />
                                  </button>
                                  <button
                                    className="admin-btn admin-btn--icon btn-danger"
                                    onClick={() => deleteGradeBoundaryEntry(entry.id)}
                                    title="Delete"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </td>
                              </tr>

                              {/* Expanded content row */}
                              {expandedGradeBoundaryId === entry.id && (
                                <tr className="admin-expanded-row">
                                  <td colSpan="7" className="admin-expanded-cell">
                                    <div className="admin-expanded-content">
                                      <div className="admin-content-header">
                                        <h4 className="admin-content-header__title">Grade Boundary Details: {
                                          examBoard !== 'N/A' ?
                                            `${examBoard} ${qualification} (${examSeries})` :
                                            `Grade Boundary ${entry.id}`
                                        }</h4>
                                        <div className="admin-content-info">
                                          <button
                                            className="admin-close-btn"
                                            onClick={() => setExpandedGradeBoundaryId(null)}
                                            title="Close"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      </div>

                                      {/* Exam Information */}
                                      <div className="admin-questions-content">
                                        <h6 className="admin-questions-summary__title">Exam Information</h6>
                                        <div className="admin-questions-summary">
                                          <span className="admin-summary-item">
                                            <strong>Exam Board:</strong> {examBoard}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Qualification:</strong> {qualification}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Exam Series:</strong> {examSeries}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Total Subjects:</strong> {subjectCount}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Subjects and Grade Boundaries */}
                                      {subjects.length > 0 && (
                                        <div className="admin-questions-content">
                                          <h6 className="admin-questions-summary__title">Subjects and Grade Boundaries</h6>
                                          <div className="admin-questions-list">
                                            {subjects.map((subject, sIndex) => {
                                              const subjectName = subject.name || 'Unknown';
                                              const subjectCode = subject.code || 'N/A';
                                              const maxMark = subject.max_mark || 0;
                                              const tiers = subject.tiers || [];

                                              return (
                                                <div key={sIndex} className="admin-question-item">
                                                  <div className="admin-question-header">
                                                    <div className="admin-question-main">
                                                      <span className="admin-question-number">{subjectName}</span>
                                                      <span className="admin-question-text">Code: {subjectCode} | Max Mark: {maxMark}</span>
                                                    </div>
                                                  </div>

                                                  {tiers.length > 0 && (
                                                    <div className="admin-sub-questions">
                                                      {tiers.map((tier, tIndex) => {
                                                        const tierLevel = tier.tier_level || 'Unknown';
                                                        const paperCodes = tier.paper_codes || [];
                                                        const boundaries = tier.papers_combined_boundaries?.total_raw_mark_required || {};

                                                        return (
                                                          <div key={tIndex} className="admin-sub-question-item">
                                                            <div className="admin-sub-question-content">
                                                              <span className="admin-sub-question-number">{tierLevel}</span>
                                                              <span className="admin-sub-question-text">
                                                                Papers: {paperCodes.join(', ')}
                                                              </span>
                                                            </div>
                                                            {Object.keys(boundaries).length > 0 && (
                                                              <div className="grade-boundaries-list">
                                                                <strong>Grade Boundaries:</strong>
                                                                <div className="grade-boundaries-grid">
                                                                  {Object.entries(boundaries)
                                                                    .sort(([a], [b]) => {
                                                                      const numA = parseInt(a);
                                                                      const numB = parseInt(b);
                                                                      if (!isNaN(numA) && !isNaN(numB)) {
                                                                        return numB - numA; // Descending order (9, 8, 7...)
                                                                      }
                                                                      return b.localeCompare(a);
                                                                    })
                                                                    .map(([grade, mark]) => (
                                                                      <div key={grade} className="grade-boundary-item">
                                                                        <span className="grade-label">Grade {grade}:</span>
                                                                        <span className="grade-mark">{mark} marks</span>
                                                                      </div>
                                                                    ))}
                                                                </div>
                                                              </div>
                                                            )}
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}

                                      {/* Metadata */}
                                      <div className="admin-metadata-section">
                                        <h6>Metadata</h6>
                                        <div className="metadata-info">
                                          <p><strong>ID:</strong> {entry.id}</p>
                                          <p><strong>Uploaded:</strong> {formatDate(entry.uploadedAt)}</p>
                                        </div>
                                      </div>

                                      <details style={{ marginTop: '16px' }}>
                                        <summary style={{ cursor: 'pointer', color: '#666' }}>View Raw Grade Boundary Data</summary>
                                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', background: '#f5f5f5', padding: '16px', borderRadius: '4px', marginTop: '8px' }}>
                                          {JSON.stringify(entry, null, 2)}
                                        </pre>
                                      </details>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Query Tab */}
        {activeTab === 'query' && (
          <div className="admin-tab-content">
            <div className="admin-section-header">
              <h2 className="admin-section-header__title">Database Queries</h2>
              <p>Execute database operations and manage system data</p>
            </div>

            {/* Clear Sessions Panel */}
            <div className="admin-query-section">
              <div className="admin-query-header">
                <h3 className="admin-query-title">Clear All Sessions</h3>
                <p className="admin-query-description">Remove all chat session data from the database</p>
              </div>

              <div className="admin-query-content">
                <div className="admin-query-warning">
                  <div className="admin-query-warning-icon">⚠️</div>
                  <div className="admin-query-warning-text">
                    <strong>Warning:</strong> This action will permanently delete all chat sessions and conversation history from the database.
                  </div>
                </div>

                <div className="admin-query-details">
                  <h4 className="admin-query-details-title">This includes:</h4>
                  <ul className="admin-query-list">
                    <li><strong>subjectMarkingResults</strong> collection (Marking results)</li>
                    <li><strong>unifiedSessions</strong> collection (Chat sessions)</li>
                    <li>All conversation messages and AI responses</li>
                    <li>All uploaded images and annotations</li>
                  </ul>
                </div>

                <div className="admin-query-danger">
                  <strong>This action cannot be undone.</strong>
                </div>

                <div className="admin-query-actions">
                  <button
                    className="admin-btn admin-btn--danger"
                    onClick={clearAllSessions}
                    disabled={isClearingSessions}
                  >
                    <Trash2 size={16} />
                    {isClearingSessions ? 'Clearing Sessions...' : 'Clear All Sessions'}
                  </button>
                </div>
              </div>
            </div>


          </div>
        )}

        {/* Subscriptions Tab */}
        {activeTab === 'subscriptions' && (
          <div className="admin-tab-content">
            <div className="admin-section-header">
              <h2 className="admin-section-header__title">Subscription & Credit Management</h2>
              <p>View all subscribers and manage their subscriptions and credits</p>
            </div>

            {/* All Subscriptions List */}
            <div className="admin-subscription-list-section">
              <div className="admin-subscription-list-header">
                <div>
                  <h3>Subscriptions ({subscriptionsPagination.total})</h3>
                  <div className="admin-filter-tabs" style={{ marginTop: '8px' }}>
                    <button
                      className={`admin-filter-tab ${subscriptionFilter === 'active' ? 'admin-filter-tab--active' : ''}`}
                      onClick={() => {
                        setSubscriptionFilter('active');
                        setSubscriptionsPage(1); // Reset to page 1 when filter changes
                      }}
                    >
                      Active Only
                    </button>
                    <button
                      className={`admin-filter-tab ${subscriptionFilter === 'all' ? 'admin-filter-tab--active' : ''}`}
                      onClick={() => {
                        setSubscriptionFilter('all');
                        setSubscriptionsPage(1);
                      }}
                    >
                      All Statuses
                    </button>
                  </div>
                </div>
                <button
                  className="admin-btn admin-btn--primary"
                  onClick={async () => {
                    setLoadingList(true);
                    try {
                      const response = await fetch(`http://localhost:5001/api/payment/list-subscriptions?page=${subscriptionsPage}&limit=20&status=${subscriptionFilter}`);
                      if (response.ok) {
                        const data = await response.json();
                        setSubscriptionsList(data.subscriptions);
                        setSubscriptionsPagination(data.pagination);
                      }
                    } catch (error) {
                      console.error('Error loading subscriptions:', error);
                    } finally {
                      setLoadingList(false);
                    }
                  }}
                  disabled={loadingList}
                >
                  <RefreshCw size={16} />
                  {loadingList ? 'Loading...' : 'Refresh List'}
                </button>
              </div>

              {loadingList ? (
                <div className="admin-empty-state">
                  <p>Loading subscriptions...</p>
                </div>
              ) : subscriptionsList.length > 0 ? (
                <>
                  <div className="admin-subscriptions-table">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th className="admin-table__header">Email</th>
                          <th className="admin-table__header">Plan</th>
                          <th className="admin-table__header">Status</th>
                          <th className="admin-table__header">Amount</th>
                          <th className="admin-table__header">Period End</th>
                          <th className="admin-table__header">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subscriptionsList.map((sub) => (
                          <tr key={sub.id} className="admin-table__row">
                            <td className="admin-table__cell">{sub.email}</td>
                            <td className="admin-table__cell" style={{ textTransform: 'capitalize' }}>{sub.planId}</td>
                            <td className="admin-table__cell">
                              <span className={`status-badge status-badge--${sub.status === 'active' ? 'success' : 'warning'}`}>
                                {sub.status}
                              </span>
                            </td>
                            <td className="admin-table__cell">
                              {(sub.amount / 100).toFixed(2)} {sub.currency?.toUpperCase()}
                            </td>
                            <td className="admin-table__cell">
                              {new Date(sub.currentPeriodEnd * 1000).toLocaleDateString()}
                            </td>
                            <td className="admin-table__cell">
                              <button
                                className="admin-btn admin-btn--secondary"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                                onClick={() => {
                                  setSearchUserId(sub.userId);
                                  // Auto-load this user's data
                                  (async () => {
                                    setLoadingSubscription(true);
                                    try {
                                      const subResponse = await fetch(`http://localhost:5001/api/payment/user-subscription/${sub.userId}`);
                                      if (subResponse.ok) {
                                        const subData = await subResponse.json();
                                        setUserSubscription(subData.subscription);
                                      }
                                      const creditsResponse = await fetch(`http://localhost:5001/api/credits/${sub.userId}`);
                                      if (creditsResponse.ok) {
                                        setUserCredits(await creditsResponse.json());
                                      }
                                    } catch (error) {
                                      console.error('Error:', error);
                                    } finally {
                                      setLoadingSubscription(false);
                                    }
                                  })();
                                }}
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="admin-pagination">
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => {
                        if (subscriptionsPage > 1) {
                          setSubscriptionsPage(subscriptionsPage - 1);
                        }
                      }}
                      disabled={subscriptionsPage === 1}
                    >
                      Previous
                    </button>
                    <span className="admin-pagination-info">
                      Page {subscriptionsPage} of {subscriptionsPagination.totalPages}
                    </span>
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => {
                        if (subscriptionsPage < subscriptionsPagination.totalPages) {
                          setSubscriptionsPage(subscriptionsPage + 1);
                        }
                      }}
                      disabled={subscriptionsPage >= subscriptionsPagination.totalPages}
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <div className="admin-empty-state">
                  <p>No subscriptions found. Click "Refresh List" to load subscribers.</p>
                </div>
              )}
            </div>

            {/* User Search */}
            <div className="admin-subscription-search">
              <h3>Search User</h3>
              <div className="admin-search-box">
                <input
                  type="text"
                  placeholder="Enter User ID..."
                  value={searchUserId}
                  onChange={(e) => setSearchUserId(e.target.value)}
                  className="admin-search-input"
                />
                <button
                  className="admin-btn admin-btn--primary"
                  onClick={async () => {
                    if (!searchUserId.trim()) {
                      alert('Please enter a User ID');
                      return;
                    }
                    setLoadingSubscription(true);
                    try {
                      // Fetch subscription
                      const subResponse = await fetch(`http://localhost:5001/api/payment/user-subscription/${searchUserId}`);
                      if (subResponse.ok) {
                        const subData = await subResponse.json();
                        setUserSubscription(subData.subscription);
                      } else {
                        setUserSubscription(null);
                      }

                      // Fetch credits
                      const creditsResponse = await fetch(`http://localhost:5001/api/credits/${searchUserId}`);
                      if (creditsResponse.ok) {
                        const creditsData = await creditsResponse.json();
                        setUserCredits(creditsData);
                      } else {
                        setUserCredits(null);
                      }
                    } catch (error) {
                      console.error('Error fetching user data:', error);
                      alert('Failed to fetch user data');
                    } finally {
                      setLoadingSubscription(false);
                    }
                  }}
                  disabled={loadingSubscription}
                >
                  <Search size={16} />
                  {loadingSubscription ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>

            {/* Subscription Details */}
            {userSubscription && (
              <div className="admin-subscription-details">
                <h3>Subscription Details</h3>
                <div className="admin-details-grid">
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Email:</span>
                    <span className="admin-detail-value">{userSubscription.email}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Plan:</span>
                    <span className="admin-detail-value" style={{ textTransform: 'capitalize' }}>{userSubscription.planId}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Status:</span>
                    <span className="admin-detail-value" style={{ textTransform: 'capitalize' }}>{userSubscription.status}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Billing Cycle:</span>
                    <span className="admin-detail-value" style={{ textTransform: 'capitalize' }}>{userSubscription.billingCycle}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Amount:</span>
                    <span className="admin-detail-value">{(userSubscription.amount / 100).toFixed(2)} {userSubscription.currency.toUpperCase()}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Period End:</span>
                    <span className="admin-detail-value">{new Date(userSubscription.currentPeriodEnd * 1000).toLocaleDateString()}</span>
                  </div>
                  {userSubscription.scheduledPlanId && (
                    <div className="admin-detail-item" style={{ gridColumn: '1 / -1' }}>
                      <span className="admin-detail-label">Scheduled Change:</span>
                      <span className="admin-detail-value" style={{ color: '#f59e0b', fontWeight: 600 }}>
                        ⚠️ Downgrade to {userSubscription.scheduledPlanId} on {new Date(userSubscription.scheduleEffectiveDate).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Credit Management */}
            {userCredits && (
              <div className="admin-credits-management">
                <h3>Credit Management</h3>
                <div className="admin-credits-display">
                  <div className="admin-credit-stat">
                    <span className="admin-credit-label">Total Credits:</span>
                    <span className="admin-credit-value">{userCredits.totalCredits}</span>
                  </div>
                  <div className="admin-credit-stat">
                    <span className="admin-credit-label">Used Credits:</span>
                    <span className="admin-credit-value">{userCredits.usedCredits}</span>
                  </div>
                  <div className="admin-credit-stat">
                    <span className="admin-credit-label">Remaining Credits:</span>
                    <span className="admin-credit-value" style={{ color: userCredits.remainingCredits < 10 ? '#EF4444' : '#10B981', fontWeight: 600 }}>
                      {userCredits.remainingCredits}
                    </span>
                  </div>
                </div>

                <div className="admin-credit-actions">
                  <button
                    className="admin-btn admin-btn--danger"
                    onClick={async () => {
                      if (!window.confirm('⚠️ WARNING: This is a HARD RESET.\n\nThis will:\n1. Cancel any active Stripe subscription/schedule\n2. Set plan to Free\n3. WIPE all credits to 10\n\nAre you sure completely reset this user?')) return;
                      try {
                        const token = await getAuthToken();
                        const response = await fetch(`http://localhost:5001/api/admin/credits/${searchUserId}/reset`, {
                          method: 'POST',
                          headers: {
                            'Authorization': `Bearer ${token}`
                          }
                        });
                        if (response.ok) {
                          alert('User has been HARD RESET successfully.');
                          // Refetch credits
                          const creditsResponse = await fetch(`http://localhost:5001/api/credits/${searchUserId}`);
                          if (creditsResponse.ok) {
                            setUserCredits(await creditsResponse.json());
                          }
                          // Also refetch subscription if looking at it
                          const subResponse = await fetch(`http://localhost:5001/api/payment/user-subscription/${searchUserId}`);
                          if (subResponse.ok) {
                            const subData = await subResponse.json();
                            setUserSubscription(subData.subscription);
                          }
                        } else {
                          alert('Failed to reset user');
                        }
                      } catch (error) {
                        console.error('Error resetting user:', error);
                        alert('Error resetting user');
                      }
                    }}
                  >
                    Hard Reset User (Free + 10 Credits)
                  </button>

                  <div className="admin-adjust-credits">
                    <input
                      type="number"
                      placeholder="Adjustment amount (+/-)"
                      value={adjustmentAmount}
                      onChange={(e) => setAdjustmentAmount(e.target.value)}
                      className="admin-adjust-input"
                    />
                    <button
                      className="admin-btn admin-btn--primary"
                      onClick={async () => {
                        const amount = parseInt(adjustmentAmount);
                        if (isNaN(amount) || amount === 0) {
                          alert('Please enter a valid adjustment amount');
                          return;
                        }
                        try {
                          const token = await getAuthToken();
                          const response = await fetch(`http://localhost:5001/api/admin/credits/${searchUserId}/adjust`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ adjustment: amount })
                          });
                          if (response.ok) {
                            alert(`Credits adjusted by ${amount}!`);
                            setAdjustmentAmount('');
                            // Refetch credits
                            const creditsResponse = await fetch(`http://localhost:5001/api/credits/${searchUserId}`);
                            if (creditsResponse.ok) {
                              setUserCredits(await creditsResponse.json());
                            }
                          } else {
                            alert('Failed to adjust credits');
                          }
                        } catch (error) {
                          console.error('Error adjusting credits:', error);
                          alert('Error adjusting credits');
                        }
                      }}
                      disabled={!adjustmentAmount}
                    >
                      Adjust Credits
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!userSubscription && !userCredits && !loadingSubscription && (
              <div className="admin-empty-state">
                <p>Search for a user to view and manage their subscription and credits</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div >
  );
}

export default AdminPage;

