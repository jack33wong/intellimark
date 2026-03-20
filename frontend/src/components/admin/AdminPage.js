import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
/**
 * Robustly ensures value is an array.
 * Converts numeric-indexed objects (like Firestore sometimes creates) into actual arrays.
 */
const robustEnsureArray = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'object' && val !== null) {
    const entries = Object.entries(val);
    if (entries.length === 0) return [];

    // Map over entries to preserve the key inside the object before it gets lost in values()
    const mappedEntries = entries.map(([key, v]) => {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const enhancedV = { ...v };
        // 🚨 Map Key Priority: The key IS the identifier in Map-based structures.
        // We MUST prioritize it to avoid stale properties inside the object from causing mismatches.
        enhancedV.number = key;
        return [key, enhancedV];
      }
      return [key, v];
    });
    
    // Check if keys are predominantly numeric strings (for sorting)
    const numericKeys = mappedEntries.filter(([key]) => !isNaN(parseInt(key)));
    if (numericKeys.length > 0) {
      return mappedEntries
        .sort(([a], [b]) => {
          const numA = parseInt(a);
          const numB = parseInt(b);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.localeCompare(b);
        })
        .map(([_, v]) => v);
    }
    // Final fallback: just use values
    return mappedEntries.map(([_, v]) => v);
  }
  // NEW: Don't turn primitives into empty arrays; wrap them or return as is if appropriate.
  // For safety in normalization, return the value as an array of one if it's not null/undefined.
  return (val !== null && val !== undefined) ? [val] : [];
};

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
  if (!questions) return { total: 0, audit: {} };
  
  // Robustly handle both Array and Object formats
  let questionsArray = [];
  if (Array.isArray(questions)) {
    questionsArray = questions;
  } else if (typeof questions === 'object' && questions !== null) {
    questionsArray = Object.values(questions);
  }

  const audit = {};
  const total = questionsArray.reduce((sum, q, idx) => {
    if (!q) return sum;
    const qNum = String(q.number || q.questionNumber || q.question_number || (idx + 1));
    const marks = getQuestionMarksRecursive(q);
    audit[qNum] = marks;
    return sum + marks;
  }, 0);
  return { total, audit };
};

const calculateExamTotalMarks = (questions) => {
  try {
    return calculateExamTotalMarksDetailed(questions).total;
  } catch (e) {
    console.error('Error calculating total marks:', e);
    return 0;
  }
};



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
 * Normalizes exam content (questions and sub-questions) to use a consistent 'text' and 'number'/'part' structure.
 * This is crucial for allowing empty strings to be saved without fallback logic interfering.
 */
const normalizeExamContent = (data) => {
  if (!data) return data;

  // Clone to avoid mutating original source
  const normalized = JSON.parse(JSON.stringify(data));
  normalized._isNormalized = true;
  
  // 1. Recursive check for nested containers
  if (normalized.markingSchemeData) {
    normalized.markingSchemeData = normalizeExamContent(normalized.markingSchemeData);
  }
  if (normalized.data && typeof normalized.data === 'object' && normalized.data.questions) {
    const normalizedData = normalizeExamContent(normalized.data);
    normalized.data = { ...normalized.data, ...normalizedData };
  }

  // Helper for single question normalization (RECURSIVE)
  const normQ = (sq) => {
    if (!sq || typeof sq !== 'object') return sq;
    const qData = { ...sq };
    
    // Normalize Sub-Questions Recursively (Passively)
    const subQs = qData.subQuestions || qData.sub_questions;
    if (subQs && Array.isArray(subQs)) {
      const normalizedSubs = subQs.map((s) => normQ(s));
      if (qData.sub_questions) qData.sub_questions = normalizedSubs;
      else qData.subQuestions = normalizedSubs;
    }
    return qData;
  };

  // 2. Normalize questions
  if (normalized.questions) {
    if (Array.isArray(normalized.questions)) {
      normalized.questions = normalized.questions.map((q, idx) => normQ(q, idx + 1));
    } else if (typeof normalized.questions === 'object' && normalized.questions !== null) {
      const qMap = {};
      Object.entries(normalized.questions).forEach(([key, q]) => {
        qMap[key] = normQ(q, key);
      });
      normalized.questions = qMap;
    }
  }

  return normalized;
};

/**
 * Compare an exam paper with a marking scheme or grade boundary to see if they match
 */
const isPaperMatch = (paper, scheme) => {
  if (!paper || !scheme) return false;

  const pData = paper.data || paper;
  const pMeta = pData.exam || pData.metadata || pData.examDetails || {};

  const sData = scheme.data || scheme;
  const sMeta = sData.examDetails || sData.exam || sData.metadata || {};

  // 1. Board Match
  const pBoard = normalizeExamBoard(pMeta.board || pMeta.exam_board || pMeta.examBoard || '');
  const sBoard = normalizeExamBoard(sMeta.board || sMeta.exam_board || sMeta.examBoard || sMeta.examDetails?.board || '');

  if (!pBoard || !sBoard || pBoard !== sBoard) return false;

  // 2. Series Match
  const pSeries = normalizeExamSeries(pMeta.exam_series || pMeta.series || '', pBoard).toLowerCase();
  const sSeriesRaw = sMeta.exam_series || sMeta.series || sMeta.date || sMeta.examDetails?.exam_series || '';
  const sSeries = normalizeExamSeries(sSeriesRaw, sBoard).toLowerCase();

  const seriesMatch = pSeries === sSeries ||
    pSeries === sSeries.replace(/^june\s+/i, '') ||
    sSeries === pSeries.replace(/^june\s+/i, '');

  if (!seriesMatch) return false;

  // 3. Code Match
  const pCode = (pMeta.code || pMeta.exam_code || pMeta.paperCode || '').trim().toLowerCase();
  const sCode = (sMeta.code || sMeta.exam_code || sMeta.paperCode || sMeta.examDetails?.code || sMeta.paper_code || '').trim().toLowerCase();

  return pCode && sCode && pCode === sCode;
};

/**
 * Compare Exam Paper and Marking Scheme structure
 * Returns an array of mismatch descriptions or empty array if match
 */
const checkStructureMismatch = (paperInput, schemeInput) => {
  if (!paperInput || !schemeInput) return [];
  
  // Robust Extraction: Handle if we were passed full objects or just the lists
  const questions1 = Array.isArray(paperInput) ? paperInput : (paperInput.questions || []);
  const questions2 = (!Array.isArray(schemeInput) && schemeInput.questions) ? schemeInput.questions : schemeInput;
  const mismatches = [];

  const normId = (id) => {
    if (!id) return '';
    let nid = String(id).toLowerCase().trim();
    nid = nid.replace(/^q(?:uestion)?\.?\s*(\d)/, '$1');
    // Keep only alphanumeric to match "3(a)" vs "3a"
    return nid.replace(/[^a-z0-9]/g, '');
  };

  // Helper to build a flat map of all canonical identifiers
  const getFlattenedIds = (data, isScheme = false) => {
    const ids = new Set();
    
    const processRecursive = (item, parentId = '', keyId = '') => {
      if (!item) return;
      
      // Determine Identity
      // 🚨 CRITICAL: For papers (Array), we prioritize internal fields (number/part) over the array index (keyId).
      // For schemes (Object Map), the key IS the primary ID.
      let rawId = '';
      if (isScheme && keyId) {
        rawId = keyId;
      } else {
        rawId = item.part || item.question_part || item.number || item.questionNumber || item.question_number || item.question_part || keyId || '';
      }
      
      const currentId = normId(rawId);
      
      // If we are deep nesting, join with no separator to match flat keys like "3ai"
      // But if root has no ID, we'll handle that in the caller
      const fullId = parentId ? `${parentId}${currentId}` : currentId;

      // Identify Children
      const children = item.subQuestions || item.sub_questions || item.questions;
      const subList = [];
      
      if (Array.isArray(children)) {
        subList.push(...children.map(c => ({ item: c, key: '' })));
      } else if (children && typeof children === 'object' && !children.marks) { // Not a leaf node with a 'questions' field (unlikely)
        Object.entries(children).forEach(([k, v]) => subList.push({ item: v, key: k }));
      }

      if (subList.length > 0) {
        // It's a container - process children
        subList.forEach(c => processRecursive(c.item, fullId, c.key));
      } else if (fullId) {
        // It's a leaf node - add the identifier
        ids.add(fullId);
      }
    };

    // Root level handling
    if (Array.isArray(data)) {
      data.forEach((q, i) => processRecursive(q, '', ''));
    } else if (data && typeof data === 'object') {
      Object.entries(data).forEach(([k, v]) => processRecursive(v, '', k));
    }
    
    return ids;
  };

  const ids1 = getFlattenedIds(questions1, false);
  const ids2 = getFlattenedIds(questions2, true);

  const paperIdsList = Array.from(ids1);
  const schemeIdsList = Array.from(ids2);

  // 1. Check Paper -> Scheme (Are all paper questions covered?)
  paperIdsList.forEach(pId => {
    if (!ids2.has(pId)) {
      mismatches.push(`Missing in Scheme: Paper Question "${pId}"`);
    }
  });

  // 2. Check Scheme -> Paper (Are there extra marks in scheme?)
  schemeIdsList.forEach(sId => {
    if (!ids1.has(sId)) {
      mismatches.push(`Missing in Paper: Scheme Question "${sId}"`);
    }
  });

  return mismatches;
};

/**
 * AdminPage component for managing AI model JSON data
 * @returns {JSX.Element} The admin page component
 */
function AdminPage() {
  // Get auth context
  const { getAuthToken } = useAuth();

  // State management
  const [loading, setLoading] = useState(true); // Still used for initial mount
  const [loadingJson, setLoadingJson] = useState(false);
  const [loadingMarking, setLoadingMarking] = useState(false);
  const [loadingBoundaries, setLoadingBoundaries] = useState(false);
  const [error, setError] = useState(null);
  const [jsonEntries, setJsonEntries] = useState([]);
  const [expandedJsonId, setExpandedJsonId] = useState(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [activeTab, setActiveTab] = useState('json');
  const [examBoardFilter, setExamBoardFilter] = useState('Pearson Edexcel');
  const [qualificationFilter, setQualificationFilter] = useState('All');
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });

  // JSON upload state
  const [jsonForm, setJsonForm] = useState({
    jsonData: ''
  });

  // Marking scheme state
  const [markingSchemeEntries, setMarkingSchemeEntries] = useState([]);
  const [expandedMarkingSchemeId, setExpandedMarkingSchemeId] = useState(null);
  const [isAuditingMarkTypes, setIsAuditingMarkTypes] = useState(false);
  const [auditProgress, setAuditProgress] = useState({ current: 0, total: 0 });
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

  // Memoized matching and structural check results
  // This prevents the "Triple Check" from running hundreds of times per render.
  const relationshipCache = useMemo(() => {
    const cache = {};
    jsonEntries.forEach(entry => {
      const matchingScheme = markingSchemeEntries.find(s => isPaperMatch(entry, s));
      let mismatches = [];
      let hasMismatch = false;
      let checkPerformed = false;

      if (matchingScheme && entry.isFullyLoaded && matchingScheme.isFullyLoaded) {
        mismatches = checkStructureMismatch(entry.questions || [], matchingScheme.questions || {});
        hasMismatch = mismatches.length > 0;
        checkPerformed = true;
      }

      cache[entry.id] = {
        matchingScheme,
        mismatches,
        hasMismatch,
        checkPerformed
      };
    });
    return cache;
  }, [jsonEntries, markingSchemeEntries]);

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



  // Load JSON entries from fullExamPaper
  const loadJsonEntries = useCallback(async (listOnly = true, silent = false) => {
    try {
      if (!silent) setLoadingJson(true);
      const authToken = await getAuthToken();
      const { data } = await ApiClient.get(`/api/admin/json/collections/fullExamPapers?listOnly=${listOnly}`);
      const entries = Array.isArray(data.entries) ? data.entries : [];

      // Sort entries by exam board, exam series, subject
      const sortedEntries = entries.sort((a, b) => {
        const examDataA = a.data || a;
        const examMetaA = examDataA.exam || examDataA.metadata || {};
        const examDataB = b.data || b;
        const examMetaB = examDataB.exam || examDataB.data?.exam || b.metadata || {}; // Added b.data?.exam for robustness

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
      if (!silent) setLoadingJson(false);
      setLoading(false); // Clear initial mount loading
    } catch (e) {
      setError(`Failed to load JSON entries: ${e.message}`);
      setLoadingJson(false);
      setLoading(false);
      setTimeout(() => setError(null), 4000);
    }
  }, [getAuthToken]);

  // Fetch full details for a specific JSON entry
  const fetchJsonEntryDetails = useCallback(async (entryId) => {
    // Set local loading status to show row-level spinner
    setJsonEntries(prev => prev.map(e => e.id === entryId ? { ...e, isLoadingDetails: true } : e));
    
    try {
      // Add a cache-buster timestamp to ensure we get the absolute latest from Firestore
      const { data } = await ApiClient.get(`/api/admin/json/collections/fullExamPapers/${entryId}?t=${Date.now()}`);
      const fullEntry = normalizeExamContent(data.entry || data);

      setJsonEntries(prev => prev.map(entry => {
        if (entry.id === entryId) {
          // Keep top-level metadata like id and normalizeSeries, but overwrite
          // the rest with the fully rich object returned from API
          return {
            ...entry,
            ...fullEntry,
            data: fullEntry.data || fullEntry, // Ensures entry.data is populated if expected
            isFullyLoaded: true,
            isLoadingDetails: false
          };
        }
        return entry;
      }));
      return fullEntry;
    } catch (e) {
      console.error('Error fetching entry details:', e);
      setError(`Failed to load details: ${e.message}`);
      setJsonEntries(prev => prev.map(e => e.id === entryId ? { ...e, isLoadingDetails: false } : e));
      return null;
    }
  }, []);

  // Helper function to check if marking scheme exists for an exam paper
  const hasMarkingScheme = useCallback((examPaper) => {
    return markingSchemeEntries.some(scheme => isPaperMatch(examPaper, scheme));
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

    const targetSubject = normalize(examMeta.subject || '');
    const targetQual = normalize(examMeta.qualification || '');
    const targetCode = normalize(examMeta.code || examMeta.exam_code || examMeta.paperCode || '');

    if (!targetBoard || !targetSeries) return false;

    return gradeBoundaryEntries.some(entry => {
      const boundaryData = entry.data || entry;
      const boundaryBoardRaw = boundaryData.exam_board || boundaryData.board;
      const boundaryBoard = normalizeExamBoard(boundaryBoardRaw);

      const boundarySeriesRaw = boundaryData.exam_series || boundaryData.series;
      const boundarySeries = normalize(normalizeExamSeries(boundarySeriesRaw, boundaryBoard));

      // 1. Board Match
      const boardMatch = boundaryBoard === targetBoard ||
        boundaryBoard.includes(targetBoard) ||
        targetBoard.includes(boundaryBoard);

      if (!boardMatch) return false;

      // 2. Series Match (Exact normalized)
      if (boundarySeries !== targetSeries) return false;

      // 3. Subject/Code/Qual Match
      const subjects = boundaryData.subjects || [];
      return subjects.some(subj => {
        const subjectName = normalize(subj.name);
        const subjectCode = normalize(subj.code);
        const subjectLevel = normalize(subj.level || subj.qualification || boundaryData.qualification || '');

        // Extract subject code from exam code (e.g., "1MA1/1H" -> "1MA1")
        const examCodePrefix = targetCode.split('/')[0];

        // Check if subject code matches prefix (e.g. "1ma1" === "1ma1")
        const codeMatch = subjectCode && (subjectCode === examCodePrefix || targetCode.startsWith(subjectCode));

        // Qualification Level Check (Stricter)
        const levelMatch = !targetQual || !subjectLevel || 
          targetQual === subjectLevel || 
          targetQual.includes(subjectLevel) || 
          subjectLevel.includes(targetQual);
        
        if (!levelMatch) return false;

        // Subject check - prioritize code match, fallback to exact-ish name match
        if (codeMatch) return true;
        
        if (targetSubject && subjectName) {
           return subjectName === targetSubject || 
                  subjectName === `${targetQual} ${targetSubject}`.trim() ||
                  subjectName === `${targetSubject} ${targetQual}`.trim();
        }

        return false;
      });
    });
  }, [gradeBoundaryEntries]);

  // Load marking scheme entries
  const loadMarkingSchemeEntries = useCallback(async (listOnly = true, silent = false) => {
    try {
      if (!silent) setLoadingMarking(true);
      const authToken = await getAuthToken();
      const { data } = await ApiClient.get(`/api/admin/json/collections/markingSchemes?listOnly=${listOnly}`);
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
      setLoadingMarking(false);
      setLoading(false);
    } catch (error) {
      console.error('Error loading marking scheme entries:', error);
      setMarkingSchemeEntries([]);
      setLoadingMarking(false);
      setLoading(false);
    }
  }, [getAuthToken]);

  // Fetch full details for a specific marking scheme
  const fetchMarkingSchemeDetails = useCallback(async (entryId) => {
    // Set local loading status to show row-level spinner
    setMarkingSchemeEntries(prev => prev.map(e => e.id === entryId ? { ...e, isLoadingDetails: true } : e));
    
    try {
      const { data } = await ApiClient.get(`/api/admin/json/collections/markingSchemes/${entryId}`);
      const fullEntry = normalizeExamContent(data.entry || data);

      setMarkingSchemeEntries(prev => prev.map(entry =>
        entry.id === entryId ? {
          ...entry,
          ...fullEntry,
          markType: fullEntry.markType || entry.markType, // Keep local markType if server didn't send it
          isFullyLoaded: true,
          isLoadingDetails: false
        } : entry
      ));
      return fullEntry;
    } catch (e) {
      console.error('Error fetching marking scheme details:', e);
      setError(`Failed to load marking scheme details: ${e.message}`);
      setMarkingSchemeEntries(prev => prev.map(e => e.id === entryId ? { ...e, isLoadingDetails: false } : e));
      return null;
    }
  }, []);

  // Load grade boundary entries
  const loadGradeBoundaryEntries = useCallback(async () => {
    try {
      setLoadingBoundaries(true);
      const authToken = await getAuthToken();
      const { data } = await ApiClient.get('/api/admin/json/collections/gradeBoundaries');
      setGradeBoundaryEntries(data.entries || []);
      setLoadingBoundaries(false);
      setLoading(false);
    } catch (error) {
      console.error('Error loading grade boundary entries:', error);
      setGradeBoundaryEntries([]);
      setLoadingBoundaries(false);
      setLoading(false);
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
    // Normalize data (includes deep copy and field unification)
    setEditedExamData(normalizeExamContent(JSON.parse(JSON.stringify(examData))));
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
    // Normalize data (includes deep copy and field unification)
    setEditedMarkingSchemeData(normalizeExamContent(JSON.parse(JSON.stringify(schemeData))));
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
        const q = { ...updated.questions[qIndex] };
        
        // Smart update for parent question fields
        let targetField = field;
        if (field === 'number') {
          if (q.question_number !== undefined) targetField = 'question_number';
          else if (q.questionNumber !== undefined) targetField = 'questionNumber';
        } else if (field === 'text') {
          if (q.question_text !== undefined) targetField = 'question_text';
          else if (q.questionText !== undefined) targetField = 'questionText';
        }

        q[targetField] = value;
        updated.questions[qIndex] = q;
      }
      return updated;
    });
  }, []);

  const handleSubQuestionFieldChange = useCallback((qIndex, sIndex, field, value) => {
    setEditedExamData(prev => {
      const updated = { ...prev };
      if (updated.questions && updated.questions[qIndex]) {
        const q = updated.questions[qIndex];
        if (q && (q.subQuestions || q.sub_questions)) {
          const subQsOriginal = q.subQuestions || q.sub_questions;
          if (subQsOriginal && subQsOriginal[sIndex]) {
            const subQs = [...subQsOriginal];
            const sub = { ...subQs[sIndex] };
            
            // Smart update: if we're updating 'part' or 'text' but the object uses snake_case, update the snake_case field
            let targetField = field;
            if (field === 'part') {
               if (sub.question_part !== undefined) targetField = 'question_part';
               else if (sub.part !== undefined) targetField = 'part';
               else if (sub.number !== undefined) targetField = 'number';
            } else if (field === 'text') {
               if (sub.question_text !== undefined) targetField = 'question_text';
               else if (sub.questionText !== undefined) targetField = 'questionText';
               else if (sub.text !== undefined) targetField = 'text';
            }
            
            sub[targetField] = value;
            subQs[sIndex] = sub;

            // Re-assign back to the correct field
            if (q.sub_questions) q.sub_questions = subQs;
            else q.subQuestions = subQs;
          }
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
        
        // Smart creation: use the format of existing sub-questions if available
        const newSub = { marks: '0' };
        if (subQs.length > 0) {
          const firstSub = subQs[0];
          if (firstSub.question_part !== undefined) newSub.question_part = nextPartLetter;
          else newSub.part = nextPartLetter;
          
          if (firstSub.question_text !== undefined) newSub.question_text = '';
          else if (firstSub.questionText !== undefined) newSub.questionText = '';
          else newSub.text = '';
        } else {
          // Default to camelCase if no siblings exist
          newSub.part = nextPartLetter;
          newSub.text = '';
        }

        subQs.push(newSub);

        // Maintain original key (subQuestions or sub_questions)
        if (q.sub_questions) q.sub_questions = subQs;
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

    // Guard: Ensure questions are present (avoid accidental save of light metadata)
    if (!finalData.questions || (typeof finalData.questions === 'object' && Object.keys(finalData.questions).length === 0)) {
      if (!window.confirm('Warning: Marking scheme questions appear to be missing or empty. Save anyway?')) {
        return;
      }
    }

    // "Heal" data during save by applying deep normalization one last time
    const dataToSave = normalizeExamContent(finalData);

    setIsSaving(true);
    try {
      const authToken = await getAuthToken();
      
      // Wrap payload in markingSchemeData if the original had it (preserving nesting)
      const originalEntry = markingSchemeEntries.find(e => e.id === editingMarkingSchemeId);
      const payload = (originalEntry && originalEntry.markingSchemeData) 
        ? { markingSchemeData: dataToSave } 
        : dataToSave;

      await ApiClient.patch(`/api/admin/json/collections/markingSchemes/${editingMarkingSchemeId}`, payload);

      // Invalidate relationship status for matching papers
      await invalidateStatusForMatches('markingScheme', dataToSave);

      // Update local state - ensure we merge healed data correctly
      setMarkingSchemeEntries(prev => prev.map(entry => {
        if (entry.id === editingMarkingSchemeId) {
          if (entry.markingSchemeData) {
             return { ...entry, markingSchemeData: dataToSave, isFullyLoaded: true };
          }
          return { ...entry, ...dataToSave, isFullyLoaded: true };
        }
        return entry;
      }));


      setError('✅ Marking scheme healed and saved successfully');
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

  /**
   * Status Invalidation: Resets relationshipStatus for papers when dependencies change.
   * This ensures that "YES" doesn't stay stale if a marking scheme or boundary is modified.
   */
  const invalidateStatusForMatches = useCallback(async (type, data) => {
    if (!data) return;
    
    // Find all papers that might be affected
    const matchingPapers = jsonEntries.filter(paper => {
      if (type === 'markingScheme') {
        const fullPaper = paper.data || paper;
        return isPaperMatch(fullPaper, data);
      }
      if (type === 'gradeBoundary') {
        return hasGradeBoundary(paper);
      }
      return false;
    });

    if (matchingPapers.length === 0) return;


    // Perform individual updates to Firestore
    const updatePromises = matchingPapers.map(async (paper) => {
      try {
        await ApiClient.patch(`/api/admin/json/collections/fullExamPapers/${paper.id}/relationship-status`, {
          relationshipStatus: null
        });
        return paper.id;
      } catch (err) {
        console.error(`[Invalidate] Failed for ${paper.id}:`, err);
        return null;
      }
    });

    const results = await Promise.all(updatePromises);
    const successIds = new Set(results.filter(id => id !== null));

    // Update local state en-masse
    if (successIds.size > 0) {
      setJsonEntries(prev => prev.map(e => 
        successIds.has(e.id) ? { ...e, relationshipStatus: null } : e
      ));
    }
  }, [jsonEntries, hasGradeBoundary]);

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

    const isGCSEMaths = (subject.includes('math') || subject.includes('mathematics')) && (qual.includes('GCSE') || qual.includes('IGCSE'));

    if (isGCSEMaths) {
      // OCR J560 is 100 marks, Edexcel 1MA1 and AQA 8300 are 80 marks
      const normalizedBoard = board.toUpperCase();
      const expectedMarks = normalizedBoard.includes('OCR') ? 100 : 80;
      if (totalMarks !== expectedMarks) {
        errors.totalMismatch = true;
        errors.expectedMarks = expectedMarks;
      }
    }

    data.questions.forEach((q, idx) => {
      const qNum = String(q.number || q.questionNumber || q.question_number || (idx + 1));
      const subQs = q.subQuestions || q.sub_questions || [];
      const pMark = parseFloat(q.marks) || parseFloat(q.max_marks) || parseFloat(q.total_marks) || 0;

      // 🛡️ STRICT 0-MARKS CHECK
      if (subQs.length === 0) {
        if (pMark === 0) {
          if (!errors.audit[qNum]) errors.audit[qNum] = 0;
          errors.missingMarks = true;
        }
      } else {
        const subSum = subQs.reduce((s, sq) => s + getQuestionMarksRecursive(sq), 0);

        // Root Cause Fix: Check if compound question is missing top-level marks
        if (pMark === 0) {
          errors.missingMarks = true;
        }

        // Mismatch check (already existing)
        if (pMark > 0 && pMark !== subSum && subSum > 0) {
          errors.questionMismatches[idx] = { parent: pMark, sub: subSum };
        }

        // Check sub-questions for 0 marks
        subQs.forEach((sq, sIdx) => {
          const sqMark = parseFloat(sq.marks) || parseFloat(sq.max_marks) || 0;
          if (sqMark === 0) errors.missingMarks = true;
        });
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
      
      // Local reset for all papers to ensure re-calculation
      setJsonEntries(prev => prev.map(e => ({ ...e, relationshipStatus: null })));

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
      const entryToDelete = markingSchemeEntries.find(e => e.id === entryId);
      
      const { data: result } = await ApiClient.delete(`/api/admin/json/collections/markingSchemes/${entryId}`);
      
      // Invalidate relationship status for matching papers
      if (entryToDelete) {
        await invalidateStatusForMatches('markingScheme', entryToDelete.markingSchemeData || entryToDelete);
      }

      setMarkingSchemeEntries(prev => prev.filter(entry => entry.id !== entryId));
      setError(`✅ Marking scheme deleted successfully.`);
      setTimeout(() => setError(null), 3000);
    } catch (error) {
      console.error('Error deleting marking scheme:', error);
      setError(`Error deleting marking scheme: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [getAuthToken]);



  // Delete all grade boundary entries
  const deleteAllGradeBoundaryEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL grade boundaries? This action cannot be undone.')) {
      return;
    }

    setIsDeletingAllGradeBoundaries(true);
    try {
      const authToken = await getAuthToken();
      const { data: result } = await ApiClient.delete('/api/admin/json/collections/gradeBoundaries/clear-all');
      
      // Local reset for all papers to ensure re-calculation
      setJsonEntries(prev => prev.map(e => ({ ...e, relationshipStatus: null })));

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
      const entryToDelete = gradeBoundaryEntries.find(e => e.id === entryId);
      
      const { data: result } = await ApiClient.delete(`/api/admin/json/collections/gradeBoundaries/${entryId}`);
      
      // Invalidate relationship status for matching papers
      if (entryToDelete) {
        await invalidateStatusForMatches('gradeBoundary', entryToDelete);
      }

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
      const jsonData = JSON.parse(jsonForm.jsonData);

      // 🛡️ FRONTEND VALIDATION
      const validation = getValidationErrors(jsonData);
      if (validation.missingMarks) {
        setError('❌ Upload Cancelled: Some questions have 0 marks. Fix the data before uploading.');
        setTimeout(() => setError(null), 5000);
        return;
      }
      // Skip strict marks mismatch check as per user request

      const { data: result } = await ApiClient.post('/api/admin/json/collections/fullExamPapers', jsonData);
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

      // Invalidate relationship status for matching papers
      await invalidateStatusForMatches('markingScheme', parsedData);

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
      
      // Invalidate relationship status for matching papers
      await invalidateStatusForMatches('gradeBoundary', parsedData);

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



  const [syncingId, setSyncingId] = useState(null);
  const sessionSyncedIds = useRef(new Set());

  /**
   * Sync logic: Calculates structural mismatch and saves it to Firestore as a denormalized field.
   * This solves the "YES to MISMATCH" flicker on page load.
   */
  const syncExamRelationshipStatus = useCallback(async (examPaper, force = false) => {
    if (!examPaper || syncingId === examPaper.id || loadingJson || loadingMarking) return;

    setSyncingId(examPaper.id);

    try {
      // 1. Ensure we have full questions for the paper
      let fullPaper = examPaper;
      // If force is true, we ALWAYS re-fetch from backend to get fresh cleaned data
      if (force || !examPaper.isFullyLoaded || !examPaper.questions) {
        fullPaper = await fetchJsonEntryDetails(examPaper.id);
        if (!fullPaper) throw new Error('Failed to load full paper details');
      }

      // 2. Find matching marking scheme
      const matchingScheme = markingSchemeEntries.find(s => isPaperMatch(fullPaper, s));
      
      let status = {
        hasMarkingScheme: "NO",
        mismatches: [],
        hasGradeBoundary: hasGradeBoundary(fullPaper) ? "YES" : "NO"
      };

      if (matchingScheme) {
        // Ensure scheme is fully loaded
        let fullScheme = matchingScheme;
        if (!matchingScheme.isFullyLoaded || !matchingScheme.questions) {
           fullScheme = await fetchMarkingSchemeDetails(matchingScheme.id);
           if (!fullScheme) throw new Error('Failed to load full scheme details');
        }

        const mismatches = checkStructureMismatch(fullPaper.questions || [], fullScheme.questions || {});
        status.hasMarkingScheme = mismatches.length > 0 ? "MISMATCH" : "YES";
        status.mismatches = mismatches;
      }

      // 3. Update Firestore
      await ApiClient.patch(`/api/admin/json/collections/fullExamPapers/${examPaper.id}/relationship-status`, {
        relationshipStatus: status
      });

      // 4. Update local state
      // 🚨 FIX: We must spread the fullPaper data here to ensure it is NOT clobbered by 
      // the metadata-only version ('e') in the stale closure's 'prev'.
      setJsonEntries(prev => prev.map(e => e.id === examPaper.id ? { 
        ...e, 
        ...fullPaper, 
        relationshipStatus: status,
        isFullyLoaded: true 
      } : e));
      sessionSyncedIds.current.add(examPaper.id);

    } catch (err) {
      console.error(`[Sync] Failed for ${examPaper.id}:`, err);
    } finally {
      setSyncingId(null);
    }
  }, [syncingId, loadingJson, loadingMarking, fetchJsonEntryDetails, fetchMarkingSchemeDetails, markingSchemeEntries, hasGradeBoundary]);
 
  // --- Audit All Marking Schemes for Mark Type (Integer Only vs Codes) ---
  const runMarkTypeAudit = useCallback(async () => {
    if (isAuditingMarkTypes) return;
 
    const filteredSchemes = markingSchemeEntries;
    if (filteredSchemes.length === 0) return;
 
    if (!window.confirm(`Audit marking codes for all ${filteredSchemes.length} schemes? This will update the database.`)) {
      return;
    }
 
    setIsAuditingMarkTypes(true);
    setAuditProgress({ current: 0, total: filteredSchemes.length });
 
    try {
      for (let i = 0; i < filteredSchemes.length; i++) {
        const scheme = filteredSchemes[i];
        setAuditProgress({ current: i + 1, total: filteredSchemes.length });
 
        try {
          // 1. Ensure we have questions for the scheme
          let fullScheme = scheme;
          if (!scheme.questions || !scheme.isFullyLoaded) {
            fullScheme = await fetchMarkingSchemeDetails(scheme.id);
          }
 
          if (!fullScheme || !fullScheme.questions) continue;
 
          // 2. Perform the scan
          const qValues = Object.values(fullScheme.questions);
          const isIntegerOnly = qValues.length > 0 && qValues.every(q => {
            const marks = Array.isArray(q.marks) ? q.marks : [];
            // If it's a leaf question with no marks, we treat as true until proven otherwise
            if (marks.length === 0) return true; 
            return marks.every(m => !/[a-zA-Z]/.test(String(m.mark || '')));
          });
 
          const markType = isIntegerOnly ? 'integer_only' : 'codes';
 
          // 3. Patch backend (Use direct document root to ensure persistence)
          await ApiClient.patch(`/api/admin/json/collections/markingSchemes/${scheme.id}`, {
            markType: markType
          });
 
          // 4. Update local state
          setMarkingSchemeEntries(prev => prev.map(s => 
            s.id === scheme.id ? { ...s, markType: markType } : s
          ));
        } catch (err) {
          console.error(`Failed to audit marking scheme ${scheme.id}:`, err);
        }
      }
      setError('✅ Marking code audit completed successfully.');
      setTimeout(() => setError(null), 3000);
    } catch (err) {
      console.error('Audit failed:', err);
      setError('❌ Marking code audit failed. See console.');
    } finally {
      setIsAuditingMarkTypes(false);
      setAuditProgress({ current: 0, total: 0 });
    }
  }, [markingSchemeEntries, isAuditingMarkTypes, fetchMarkingSchemeDetails, setError]);

  const runBulkSync = useCallback(async (mode = 'pending') => {
    if (isSyncingAll) return;
    
    // Determine which entries to sync
    const targetEntries = jsonEntries.filter(entry => {
      if (mode === 'all') return true;
      // Pending mode: Missing or not 'YES'
      if (!entry.relationshipStatus) return true;
      return entry.relationshipStatus.hasMarkingScheme !== 'YES';
    });

    if (targetEntries.length === 0) {
      setError('✅ No papers require status refresh.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsSyncingAll(true);
    setSyncProgress({ current: 0, total: targetEntries.length });

    try {
      for (let i = 0; i < targetEntries.length; i++) {
        setSyncProgress({ current: i + 1, total: targetEntries.length });
        await syncExamRelationshipStatus(targetEntries[i], true); // Force re-calculate
      }
      setError(`✅ Completed refreshing ${targetEntries.length} status checks.`);
      setTimeout(() => setError(null), 5000);
    } catch (err) {
      console.error('Bulk sync failed:', err);
      setError('❌ Error during bulk status refresh');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsSyncingAll(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  }, [isSyncingAll, jsonEntries, syncExamRelationshipStatus]);

  // Refresh status checks (Targets 'pending': Mismatch/No/Missing)
  const refreshStatusChecks = useCallback(async () => {
    runBulkSync('pending');
  }, [runBulkSync]);

  // Refresh ALL status checks
  const refreshAllStatusChecks = useCallback(async () => {
    runBulkSync('all');
  }, [runBulkSync]);

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

  // Load data on component mount - removed combined effect

  // Load Exam Papers when tab is active
  useEffect(() => {
    if (activeTab === 'json') {
      loadJsonEntries(true); // Load metadata only initially
    }
  }, [activeTab, loadJsonEntries]);

  // Load Marking Schemes and Grade Boundaries in the background (metadata only)
  // This powers the "Has Marking Scheme" and "Has Grade Boundary" indicators
  // in the JSON list view before those tabs are explicitly opened.
  useEffect(() => {
    loadMarkingSchemeEntries(true); // listOnly = true
    loadGradeBoundaryEntries();
  }, [loadMarkingSchemeEntries, loadGradeBoundaryEntries]);

  // Load usage data when tab is active or filter changes
  useEffect(() => {
    if (activeTab === 'usage') {
      loadUsageData(usageFilter);
    }
  }, [activeTab, usageFilter, loadUsageData]);

  // Background Sync Loop

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
  // UI unblocked to allow tab navigation and header to show immediately
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

  const renderQualificationFilterTabs = () => (
    <div className="admin-filter-tabs" style={{ marginTop: '8px' }}>
      {['All', 'GCSE', 'A-Level'].map(qual => (
        <button
          key={qual}
          className={`admin-filter-tab ${qualificationFilter === qual ? 'admin-filter-tab--active' : ''}`}
          onClick={() => setQualificationFilter(qual)}
        >
          {qual}
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

  const filterByQualification = (entries, getQualFn) => {
    if (qualificationFilter === 'All') return entries;
    return entries.filter(entry => {
      const qual = getQualFn(entry);
      if (!qual) return false;
      const lowerQual = qual.toLowerCase();
      const targetQual = qualificationFilter.toLowerCase();
      
      // Check for exact match or inclusion (e.g., "GCSE Maths" matches "GCSE")
      return lowerQual === targetQual || 
             lowerQual.includes(targetQual) || 
             (targetQual === 'a-level' && (lowerQual.includes('a level') || lowerQual.includes('alevel')));
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
    filterByQualification(
      filterByBoard(jsonEntries, (entry) => {
        const examData = entry.data || entry;
        const examMeta = examData.exam || examData.metadata || {};
        return examMeta.board || examMeta.exam_board || JSON.stringify(entry);
      }),
      (entry) => {
        const examData = entry.data || entry;
        const examMeta = examData.exam || examData.metadata || {};
        return examMeta.qualification || examMeta.subject || '';
      }
    ),
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
    filterByQualification(
      filterByBoard(markingSchemeEntries, (entry) => {
        const examDetails = entry.examDetails || entry.markingSchemeData?.examDetails || {};
        return examDetails.board || examDetails.exam_board || '';
      }),
      (entry) => {
        const examDetails = entry.examDetails || entry.markingSchemeData?.examDetails || {};
        return examDetails.qualification || examDetails.subject || '';
      }
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
    filterByQualification(
      filterByBoard(gradeBoundaryEntries, (entry) =>
        entry.exam_board || entry.examBoard || ''
      ),
      (entry) => entry.qualification || ''
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
                    disabled={loadingJson || !isJsonFormValid()}
                  >
                    <FileText size={16} />
                    {loadingJson ? 'Uploading...' : 'Upload to fullExamPapers'}
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
              {renderQualificationFilterTabs()}
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Full Exam Papers ({filteredJsonEntries.length})</h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {isSyncingAll && (
                    <div className="admin-status-badge admin-status-badge--mismatch" style={{ fontSize: '13px' }}>
                       Refreshing: {syncProgress.current}/{syncProgress.total}
                    </div>
                  )}
                  <button
                    className="admin-btn admin-btn--secondary"
                    onClick={refreshStatusChecks}
                    disabled={isSyncingAll || loadingJson || loadingMarking || loadingBoundaries}
                    title="Refresh status for papers with Mismatch or No status"
                    style={{ marginBottom: 0 }}
                  >
                    <RefreshCw size={16} className={(isSyncingAll || loadingJson || loadingMarking || loadingBoundaries) ? 'spin-animation' : ''} />
                    Refresh Pending
                  </button>
                  <button
                    className="admin-btn admin-btn--secondary"
                    onClick={refreshAllStatusChecks}
                    disabled={isSyncingAll || loadingJson || loadingMarking || loadingBoundaries}
                    title="Refresh ALL status checks in the database"
                    style={{ marginBottom: 0 }}
                  >
                    <RefreshCw size={16} className={(isSyncingAll && syncProgress.total === jsonEntries.length) ? 'spin-animation' : ''} />
                    Refresh ALL
                  </button>
                  {jsonEntries.length > 0 && (
                    <button
                      className="admin-btn admin-btn--danger"
                      onClick={deleteAllJsonEntries}
                      disabled={isDeletingAll || isSyncingAll}
                    >
                      {isDeletingAll ? 'Deleting...' : 'Delete All'}
                    </button>
                  )}
                </div>
              </div>

              {loadingJson ? (
                <div className="admin-loading-spinner-container">
                  <div className="admin-spinner"></div>
                  <p>Loading exam records...</p>
                </div>
              ) : jsonEntries.length === 0 ? (
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

                          // Calculate total marks: prefer exact backend calc (needed for listOnly mode), fallback to local calc
                          const totalMarks = examData.totalMarks !== undefined ? examData.totalMarks : calculateExamTotalMarks(questionsList);


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
                                        // Fetch full details if data is incomplete
                                        const hasData = entry.questions || (entry.data && entry.data.questions);
                                        if (!hasData || !entry.isFullyLoaded) {
                                          fetchJsonEntryDetails(entry.id);
                                        }
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
                                      {entry.isLoadingDetails ? (
                                        <div className="mini-spinner"></div>
                                      ) : (
                                        expandedJsonId === entry.id ? '▼' : '▶'
                                      )}
                                    </span>
                                  </div>
                                </td>
                                <td className="admin-table__cell">{examSeries}</td>
                                <td className="admin-table__cell">{qualification}</td>
                                <td className="admin-table__cell">{subject}</td>
                                <td className="admin-table__cell">{tier}</td>
                                <td className="admin-table__cell">
                                  {totalMarks > 0 ? (
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
                                        {totalMarks}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="status-badge status-badge--warning">No marks</span>
                                  )}
                                </td>
                                <td className="admin-table__cell">
                                  {(() => {
                                    const status = entry.relationshipStatus;
                                    
                                    // If we have denormalized status, use it instantly!
                                    if (status) {
                                      if (status.hasMarkingScheme === "YES") {
                                        const matchingScheme = markingSchemeEntries.find(s => isPaperMatch(entry, s));
                                        return (
                                          <span 
                                            className="status-badge status-badge--success"
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (matchingScheme) {
                                                setActiveTab('marking-scheme');
                                                setExpandedMarkingSchemeId(matchingScheme.id);
                                                if (!matchingScheme.isFullyLoaded) fetchMarkingSchemeDetails(matchingScheme.id);
                                              }
                                            }}
                                          >
                                            YES
                                          </span>
                                        );
                                      }
                                      
                                      if (status.hasMarkingScheme === "MISMATCH") {
                                        const mismatches = status.mismatches || [];
                                        const matchingScheme = markingSchemeEntries.find(s => isPaperMatch(entry, s));
                                        return (
                                          <span
                                            className="status-badge"
                                            style={{
                                              cursor: 'pointer',
                                              backgroundColor: '#fef2f2',
                                              color: '#b91c1c',
                                              borderColor: '#f87171',
                                              borderWidth: '1px',
                                              borderStyle: 'solid'
                                            }}
                                            title={`Structural Mismatch (Triple Check):\n${mismatches.slice(0, 5).join('\n')}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const copyText = `Structure Mismatch:\n${mismatches.join('\n')}`;
                                              navigator.clipboard.writeText(copyText).then(() => {
                                                alert('Copied structure mismatches to clipboard');
                                              });
                                              if (matchingScheme) {
                                                setActiveTab('marking-scheme');
                                                setExpandedMarkingSchemeId(matchingScheme.id);
                                                if (!matchingScheme.isFullyLoaded) fetchMarkingSchemeDetails(matchingScheme.id);
                                              }
                                            }}
                                          >
                                            Mismatch
                                          </span>
                                        );
                                      }
                                      
                                      return <span className="status-badge status-badge--warning">No</span>;
                                    }

                                    // Fallback for when data is still loading or not yet synced
                                    if (syncingId === entry.id) {
                                      return <span className="status-badge" style={{ backgroundColor: '#f0f9ff', color: '#0369a1' }}>Checking...</span>;
                                    }

                                    const { matchingScheme, mismatches, hasMismatch, checkPerformed } = relationshipCache[entry.id] || {};

                                    if (matchingScheme) {
                                      // "Triple Check": Real-time structural validation
                                      // Only if pre-calculated in the memoized cache
                                      if (checkPerformed) {
                                        return (
                                          <span
                                            className={`status-badge ${hasMismatch ? '' : 'status-badge--success'}`}
                                            style={{
                                              cursor: 'pointer',
                                              backgroundColor: hasMismatch ? '#fef2f2' : undefined,
                                              color: hasMismatch ? '#b91c1c' : undefined,
                                              borderColor: hasMismatch ? '#f87171' : undefined,
                                              borderWidth: hasMismatch ? '1px' : undefined,
                                              borderStyle: hasMismatch ? 'solid' : undefined
                                            }}
                                            title={hasMismatch ? `Structural Mismatch (Triple Check):\n${mismatches.slice(0, 5).join('\n')}` : 'View Marking Scheme'}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (hasMismatch) {
                                                const copyText = `Structure Mismatch:\n${mismatches.join('\n')}`;
                                                navigator.clipboard.writeText(copyText).then(() => alert('Copied mismatches'));
                                              }
                                              setActiveTab('marking-scheme');
                                              setExpandedMarkingSchemeId(matchingScheme.id);
                                            }}
                                          >
                                            {hasMismatch ? 'Mismatch' : 'YES'}
                                          </span>
                                        );
                                      }

                                      // Fallback: If not both loaded, show "YES" if we at least matched identifiers
                                      return (
                                        <span
                                          className="status-badge status-badge--success"
                                          style={{ opacity: 0.8, cursor: 'help', backgroundColor: '#ecfdf5', color: '#059669', border: '1px dashed #10b981' }}
                                          title="Paper identifiers match, but full structural sync check is pending (expand row or click Refresh to verify)."
                                        >
                                          Link Verified
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
                                        // Fetch full details if data is incomplete
                                        const hasData = entry.questions || (entry.data && entry.data.questions);
                                        if (!hasData || !entry.isFullyLoaded) {
                                          fetchJsonEntryDetails(entry.id);
                                        }
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
                                  <tr className="admin-expansion-row">
                                    <td colSpan={10}>
                                      <div className="admin-expansion-content">
                                        {entry.isLoadingDetails ? (
                                          <div className="row-loading-state">
                                            <div className="admin-spinner"></div>
                                            <p>Loading details...</p>
                                          </div>
                                        ) : (
                                          <>
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
                                                                    value={question.number || question.question_number || question.questionNumber || ''}
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
                                                                <span className="admin-question-text">{question.text || question.question_text || question.questionText || ''}</span>
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
                                                                        value={subQ.part || subQ.question_part || subQ.number || ''}
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
                                                                      <span className="admin-sub-question-number">{subQ.part || subQ.number || subQ.question_part || subQ.subQuestionNumber || String.fromCharCode(97 + sIndex)}</span>
                                                                      <span className="admin-sub-question-text">{subQ.text || subQ.question_text || subQ.questionText || ''}</span>
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
                                          </>
                                        )}
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
                    disabled={loadingMarking || !isMarkingSchemeFormValid()}
                    className="admin-btn admin-btn--primary"
                  >
                    <FileText size={16} />
                    {loadingMarking ? 'Uploading...' : 'Upload Marking Scheme'}
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
              {renderQualificationFilterTabs()}
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Marking Schemes ({filteredMarkingSchemeEntries.length})</h3>
                 <div className="admin-data-section__actions" style={{ display: 'flex', gap: '8px' }}>
                   {isAuditingMarkTypes && (
                     <div className="audit-progress" style={{ fontSize: '0.8rem', color: '#666', display: 'flex', alignItems: 'center' }}>
                       Auditing: {auditProgress.current}/{auditProgress.total}...
                     </div>
                   )}
                   <button
                     onClick={runMarkTypeAudit}
                     className="admin-btn admin-btn--secondary"
                     disabled={isAuditingMarkTypes}
                   >
                     <RefreshCw size={16} className={isAuditingMarkTypes ? 'animate-spin' : ''} />
                     Audit Mark Types
                   </button>
                   {markingSchemeEntries.length > 0 && (
                     <button
                       onClick={deleteAllMarkingSchemeEntries}
                       className="admin-btn admin-btn--danger"
                       disabled={isDeletingAll || isAuditingMarkTypes}
                     >
                       <Trash2 size={16} />
                       Delete All
                     </button>
                   )}
                 </div>
              </div>

              {loadingMarking ? (
                <div className="admin-loading-spinner-container">
                  <div className="admin-spinner"></div>
                  <p>Loading marking schemes...</p>
                </div>
              ) : markingSchemeEntries.length === 0 ? (
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
                        <th className="admin-table__header">Mark Type</th>
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
                          const examDetails = entry.examDetails || entry.markingSchemeData?.examDetails || entry.metadata || entry.exam || {};
                          const questionsRaw = entry.questions || entry.markingSchemeData?.questions || entry.data?.questions || {};
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
 
                          // Use the persistent markType from server if it exists
                          const isIntegerOnly = entry.markType === 'integer_only';
                          const hasAuditData = !!entry.markType;
                          if (expandedMarkingSchemeId === entry.id) {
                            // Suppressed debug log for rendering row
                          }

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
                                      if (newExpandedId) {
                                        const hasData = entry.questions || entry.markingSchemeData?.questions;
                                        if (!hasData || !entry.isFullyLoaded) {
                                          fetchMarkingSchemeDetails(entry.id);
                                        }
                                      }
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
                                      {entry.isLoadingDetails ? (
                                        <div className="mini-spinner"></div>
                                      ) : (
                                        expandedMarkingSchemeId === entry.id ? '▼' : '▶'
                                      )}
                                    </span>
                                  </div>
                                </td>
                                <td className="admin-table__cell">{qualification}</td>
                                <td className="admin-table__cell">{subject}</td>
                                <td className="admin-table__cell">{examSeries}</td>
                                <td className="admin-table__cell">
                                  {!hasAuditData ? (
                                    <span style={{ fontSize: '0.75rem', color: '#999' }}>--</span>
                                  ) : isIntegerOnly ? (
                                    <span style={{ 
                                      padding: '2px 8px', 
                                      borderRadius: '4px', 
                                      backgroundColor: '#fff7ed', 
                                      color: '#9a3412',
                                      border: '1px solid #ffedd5',
                                      fontSize: '0.75rem',
                                      fontWeight: '600'
                                    }} title="Marks are integers only (missing M1, A1, etc.)">
                                      Integer Only
                                    </span>
                                  ) : (
                                    <span style={{ 
                                      padding: '2px 8px', 
                                      borderRadius: '4px', 
                                      backgroundColor: '#f0fdf4', 
                                      color: '#166534',
                                      border: '1px solid #dcfce7',
                                      fontSize: '0.75rem',
                                      fontWeight: '600'
                                    }}>
                                      Codes
                                    </span>
                                  )}
                                </td>
                                <td className="admin-table__cell">{formatDate(entry.createdAt || entry.uploadedAt)}</td>
                                <td className="admin-table__cell actions-cell">
                                  <button
                                    className="admin-btn admin-btn--icon"
                                    onClick={() => {
                                      const newId = expandedMarkingSchemeId === entry.id ? null : entry.id;
                                      setExpandedMarkingSchemeId(newId);
                                      if (newId) {
                                        const hasData = entry.questions || entry.markingSchemeData?.questions;
                                        if (!hasData || !entry.isFullyLoaded) {
                                          fetchMarkingSchemeDetails(entry.id);
                                        }
                                      }
                                    }}
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
                                <tr className="admin-expansion-row">
                                  <td colSpan={10}>
                                    <div className="admin-expansion-content">
                                      {entry.isLoadingDetails ? (
                                        <div className="row-loading-state">
                                          <div className="admin-spinner"></div>
                                          <p>Loading scheme details...</p>
                                        </div>
                                      ) : (
                                        <>
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
                                                      <strong>Total Questions:</strong> {displayData.questions ? robustEnsureArray(displayData.questions).length : 'N/A'}
                                                    </span>
                                                    <span className="admin-summary-item">
                                                      <strong>Total Marks:</strong> {displayData.questions ?
                                                        robustEnsureArray(displayData.questions).reduce((total, question) => {
                                                          const marks = robustEnsureArray(question.marks);
                                                          return total + marks.length;
                                                        }, 0) : 'N/A'}
                                                    </span>
                                                  </div>
                                                </div>

                                                {/* Questions List */}
                                                {(() => {
                                                  const questionsList = robustEnsureArray(displayData.questions).map((q, idx) => ({
                                                    number: String(q.number || q.questionNumber || q.question_number || (idx + 1)),
                                                    ...q
                                                  }));

                                                  if (questionsList.length === 0) return (
                                                    <div className="no-questions">
                                                      <p>No questions found in this marking scheme.</p>
                                                    </div>
                                                  );

                                                  return (
                                                    <div className="admin-questions-content">
                                                      <h6 className="admin-questions-summary__title">Questions ({questionsList.length})</h6>
                                                      <div className="admin-questions-list">
                                                        {questionsList
                                                          .sort((a, b) => {
                                                            const numA = parseInt(a.number);
                                                            const numB = parseInt(b.number);
                                                            if (!isNaN(numA) && !isNaN(numB)) {
                                                              if (numA !== numB) return numA - numB;
                                                              return a.number.localeCompare(b.number);
                                                            }
                                                            return a.number.localeCompare(b.number);
                                                          })
                                                          .map((q) => (
                                                            <div key={q.number} className="admin-question-item">
                                                              <div className="admin-question-main">
                                                                <span className="admin-question-number">{q.number}</span>
                                                                <span className="admin-question-text">{q.answer ? `Answer: ${q.answer}` : 'No answer provided'}</span>
                                                              </div>

                                                              {(() => {
                                                                const mArr = robustEnsureArray(q.marks);
                                                                if (mArr.length === 0) return null;
                                                                return (
                                                                  <div className="admin-sub-questions">
                                                                    <h6 className="admin-questions-summary__title">Marks ({mArr.length})</h6>
                                                                    <div className="markdown-marking-scheme">
                                                                      {mArr.map((m, i) => {
                                                                        const mCode = m.mark || `M${i + 1}`;
                                                                        let ans = m.answer || '';
                                                                        const comms = m.comments ? ` (${m.comments})` : '';
                                                                        return (
                                                                          <div key={i} className="marking-scheme-item">
                                                                            <MarkdownMathRenderer content={`**${mCode}** ${ans}${comms}`} className="admin-markdown-content" />
                                                                          </div>
                                                                        );
                                                                      })}
                                                                    </div>
                                                                  </div>
                                                                );
                                                              })()}

                                                              {(() => {
                                                                const gArr = robustEnsureArray(q.guidance);
                                                                if (gArr.length === 0) return null;
                                                                return (
                                                                  <div className="admin-sub-questions">
                                                                    <h6 className="admin-questions-summary__title">Guidance ({gArr.length})</h6>
                                                                    {gArr.map((g, gi) => (
                                                                      <div key={gi} className="admin-sub-question-item">
                                                                        <div className="admin-sub-question-content">
                                                                          <span className="admin-sub-question-number">{gi + 1}</span>
                                                                          <span className="admin-sub-question-text">
                                                                            <strong>Scenario:</strong> {g.scenario}
                                                                            {g.outcome && ` | <strong>Outcome:</strong> ${g.outcome}`}
                                                                          </span>
                                                                        </div>
                                                                      </div>
                                                                    ))}
                                                                  </div>
                                                                );
                                                              })()}
                                                            </div>
                                                          ))}
                                                      </div>
                                                    </div>
                                                  );
                                                })()}

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
                                        </>
                                      )}
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
                    disabled={loadingBoundaries || !isGradeBoundaryFormValid()}
                    className="admin-btn admin-btn--primary"
                  >
                    <FileText size={16} />
                    {loadingBoundaries ? 'Uploading...' : 'Upload Grade Boundary'}
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
              {renderQualificationFilterTabs()}
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

              {loadingBoundaries ? (
                <div className="admin-loading-spinner-container">
                  <div className="admin-spinner"></div>
                  <p>Loading grade boundaries...</p>
                </div>
              ) : gradeBoundaryEntries.length === 0 ? (
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
    </div>
  );
}

export default AdminPage;

