import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Trash2,
  Database,
  ClipboardList,
  Search,
  Award,
  BarChart,
  RefreshCw
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


  // Usage tab state
  const [usageData, setUsageData] = useState([]);
  const [usageSummary, setUsageSummary] = useState({
    totalCost: 0,
    totalLLMCost: 0,
    totalGeminiCost: 0,
    totalGptCost: 0,
    totalMathpixCost: 0,
    totalUsers: 0,
    totalSessions: 0,
    totalApiRequests: 0
  });
  const [usageFilter, setUsageFilter] = useState('day');
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [isClearingUsage, setIsClearingUsage] = useState(false);

  // Subscriptions tab state
  const [searchUserId, setSearchUserId] = useState('');
  const [userSubscription, setUserSubscription] = useState(null);
  const [userCredits, setUserCredits] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');

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
      const data = await ApiClient.get('/api/admin/json/collections/fullExamPapers', authToken);
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

    return markingSchemeEntries.some(entry => {
      const schemeData = entry.data || entry;
      const examDetails = schemeData.examDetails || schemeData.exam || {};

      const schemeBoard = (examDetails.exam_board || examDetails.board || '').trim().toLowerCase();
      const schemeSeries = (examDetails.exam_series || examDetails.date || '').trim().toLowerCase();
      const schemeCode = (examDetails.exam_code || examDetails.code || examDetails.paperCode || '').trim().toLowerCase();

      const targetBoard = board.trim().toLowerCase();
      const targetSeries = examSeries.trim().toLowerCase();
      const targetCode = code.trim().toLowerCase();

      const seriesMatch = schemeSeries === targetSeries ||
        schemeSeries === targetSeries.replace(/^june\s+/i, '');

      return schemeBoard === targetBoard && seriesMatch && schemeCode === targetCode;
    });
  }, [markingSchemeEntries]);

  // Helper function to check if grade boundary exists for an exam paper
  const hasGradeBoundary = useCallback((examPaper) => {
    const examData = examPaper.data || examPaper;
    const examMeta = examData.exam || examData.metadata || {};
    const board = examMeta.board || examMeta.exam_board || '';
    const examSeries = examMeta.exam_series || '';
    const subject = examMeta.subject || examMeta.qualification || '';
    const code = examMeta.code || examMeta.exam_code || '';

    if (!board || !examSeries || !subject || !code) return false;

    return gradeBoundaryEntries.some(entry => {
      const boundaryData = entry.data || entry;
      const boundaryBoard = boundaryData.exam_board || '';
      const boundarySeries = boundaryData.exam_series || '';

      if (boundaryBoard !== board || boundarySeries !== examSeries) return false;

      // Check if subject matches
      const subjects = boundaryData.subjects || [];
      return subjects.some(subj => {
        const subjectName = (subj.name || '').toLowerCase();
        const subjectCode = subj.code || '';
        const normalizedSubject = (subject || '').toLowerCase();

        // Extract subject code from exam code (e.g., "1MA1/1H" -> "1MA1")
        const examCodePrefix = code.split('/')[0];

        return subjectName.includes(normalizedSubject) ||
          normalizedSubject.includes(subjectName) ||
          subjectCode === examCodePrefix;
      });
    });
  }, [gradeBoundaryEntries]);

  // Load marking scheme entries
  const loadMarkingSchemeEntries = useCallback(async () => {
    try {
      const authToken = await getAuthToken();
      const data = await ApiClient.get('/api/admin/json/collections/markingSchemes', authToken);
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
      const data = await ApiClient.get('/api/admin/json/collections/gradeBoundaries', authToken);
      setGradeBoundaryEntries(data.entries || []);
    } catch (error) {
      console.error('Error loading grade boundary entries:', error);
      setGradeBoundaryEntries([]);
    }
  }, [getAuthToken]);

  // Load usage data
  const loadUsageData = useCallback(async (filter = 'all') => {
    try {
      setLoadingUsage(true);
      const authToken = await getAuthToken();
      const data = await ApiClient.get(
        `/api/admin/usage?filter=${filter}`,
        authToken
      );

      if (data.success) {
        setUsageData(data.usage || []);
        setUsageSummary(data.summary || {
          totalCost: 0,
          totalLLMCost: 0,
          totalGeminiCost: 0,
          totalGptCost: 0,
          totalMathpixCost: 0,
          totalUsers: 0,
          totalSessions: 0
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
      const result = await ApiClient.delete('/api/admin/json/collections/fullExamPapers/clear-all', authToken);
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
      const result = await ApiClient.delete(`/api/admin/json/collections/fullExamPapers/${entryId}`, authToken);
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

  // Delete all marking scheme entries
  const deleteAllMarkingSchemeEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL marking scheme data? This action cannot be undone.')) {
      return;
    }

    try {
      const authToken = await getAuthToken();
      const result = await ApiClient.delete('/api/admin/json/collections/markingSchemes/clear-all', authToken);
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
      const result = await ApiClient.delete(`/api/admin/json/collections/markingSchemes/${entryId}`, authToken);
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

  // Delete all grade boundary entries
  const deleteAllGradeBoundaryEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL grade boundaries? This action cannot be undone.')) {
      return;
    }

    setIsDeletingAllGradeBoundaries(true);
    try {
      const authToken = await getAuthToken();
      const result = await ApiClient.delete('/api/admin/json/collections/gradeBoundaries/clear-all', authToken);
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
      const result = await ApiClient.delete(`/api/admin/json/collections/gradeBoundaries/${entryId}`, authToken);
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
      const result = await ApiClient.post('/api/admin/json/collections/fullExamPapers', JSON.parse(jsonForm.jsonData), authToken);
      console.log('JSON uploaded successfully:', result);
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
      const authToken = await getAuthToken();
      await ApiClient.post('/api/admin/json/collections/markingSchemes', {
        markingSchemeData: markingSchemeForm.markingSchemeData
      }, authToken);

      setError(null);
      resetMarkingSchemeForm();
      // Reload marking scheme entries
      loadMarkingSchemeEntries();
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
      const result = await ApiClient.post('/api/admin/json/collections/gradeBoundaries', parsedData, authToken);
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
      const result = await ApiClient.delete('/api/admin/clear-all-sessions', authToken);
      console.log('All sessions cleared:', result.message);
      setError(`✅ All chat sessions have been cleared successfully.`);
      setTimeout(() => setError(null), 5000);

      // Dispatch custom event to notify sidebar to refresh
      EventManager.dispatch(EVENT_TYPES.SESSIONS_CLEARED);

      // Navigate to mark homework page after clearing all sessions
      window.location.href = '/mark-homework';
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
      const result = await ApiClient.delete('/api/admin/usage/clear-all', authToken);
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
                <div className="usage-summary-label">AI Cost</div>
                <div className="usage-summary-value">${(usageSummary.totalGeminiCost + usageSummary.totalGptCost).toFixed(2)}</div>
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
                        <th className="admin-table__header">Model Used</th>
                        <th className="admin-table__header">API Requests</th>
                        <th className="admin-table__header">Total Cost</th>
                        <th className="admin-table__header">AI Cost</th>
                        <th className="admin-table__header">Mathpix Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.map((session) => (
                        <tr key={session.sessionId} className="admin-table__row">
                          <td className="admin-table__cell">{session.userId}</td>
                          <td className="admin-table__cell">{formatDate(session.createdAt)}</td>
                          <td className="admin-table__cell">{session.modelUsed}</td>
                          <td className="admin-table__cell">{session.apiRequests || 0}</td>
                          <td className="admin-table__cell">${session.totalCost.toFixed(2)}</td>
                          <td className="admin-table__cell">${((session.geminiCost || 0) + (session.gptCost || 0)).toFixed(2)}</td>
                          <td className="admin-table__cell">${session.mathpixCost.toFixed(2)}</td>
                        </tr>
                      ))}
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
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Full Exam Papers ({jsonEntries.length})</h3>
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
                        <th className="admin-table__header">Questions</th>
                        <th className="admin-table__header">Has Marking Scheme</th>
                        <th className="admin-table__header">Has Grade Boundary</th>
                        <th className="admin-table__header">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jsonEntries.map(entry => {
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

                        // Use database fields for question counts
                        const questionCount = examMeta.totalQuestions || examMeta.total_questions || (examData.questions ? examData.questions.length : 0);
                        const subQuestionCount = examMeta.questionsWithSubQuestions || examMeta.questions_with_subquestions || (examData.questions ?
                          examData.questions.reduce((total, q) => total + ((q.subQuestions || q.sub_questions) ? (q.subQuestions || q.sub_questions).length : 0), 0) : 0);

                        // Check if marking scheme and grade boundary exist
                        const hasScheme = hasMarkingScheme(entry);
                        const hasBoundary = hasGradeBoundary(entry);

                        return (
                          <React.Fragment key={entry.id}>
                            <tr className="admin-table__row">
                              <td className="admin-table__cell exam-paper-link">
                                <div
                                  className="clickable-exam-paper"
                                  onClick={() => {
                                    console.log('Exam paper clicked:', entry.id, 'Current expanded:', expandedJsonId);
                                    console.log('Entry data structure:', entry);
                                    console.log('Exam data:', examData);
                                    console.log('Questions found:', examData.questions);
                                    const newExpandedId = expandedJsonId === entry.id ? null : entry.id;
                                    console.log('Setting expanded to:', newExpandedId);
                                    setExpandedJsonId(newExpandedId);
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
                              <td className="admin-table__cell">
                                {questionCount ? (
                                  <span className="question-count">
                                    {questionCount} Q{subQuestionCount ? ` (${subQuestionCount} sub)` : ''}
                                  </span>
                                ) : (
                                  <span className="no-questions">No questions</span>
                                )}
                              </td>
                              <td className="admin-table__cell">
                                {hasScheme ? (
                                  <span className="status-badge status-badge--success">Yes</span>
                                ) : (
                                  <span className="status-badge status-badge--warning">No</span>
                                )}
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
                                  onClick={() => setExpandedJsonId(expandedJsonId === entry.id ? null : entry.id)}
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

                            {expandedJsonId === entry.id && (
                              <tr className="admin-expanded-row">
                                <td colSpan="8">
                                  <div className="admin-expanded-content">
                                    <div className="admin-content-header">
                                      <h4 className="admin-content-header__title">Exam Paper Content: {
                                        board !== 'N/A' ?
                                          `${board} ${examSeries} ${code}`.replace(/\s+/g, ' ').trim() :
                                          examData.originalName || examData.filename || entry.id
                                      }</h4>
                                      <div className="admin-content-info">
                                        <span className="admin-content-info__text">Questions are displayed in numerical order</span>
                                        <button
                                          className="admin-close-btn"
                                          onClick={() => setExpandedJsonId(null)}
                                          title="Close"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>

                                    {examData.questions && examData.questions.length > 0 ? (
                                      <div className="admin-questions-content">
                                        <div className="admin-questions-summary">
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
                                            <strong>Total Marks:</strong> {examData.questions.reduce((total, q) => {
                                              // Fix: Only sum the parent question marks as requested by user.
                                              // Previous logic double-counted (parent + subQuestions).
                                              // Also ensure marks are parsed as integers to avoid string concatenation.
                                              const questionMarks = parseInt(q.marks) || 0;
                                              return total + questionMarks;
                                            }, 0)}
                                          </span>
                                        </div>

                                        <div className="admin-questions-list">
                                          {examData.questions.map((question, qIndex) => (
                                            <div key={qIndex} className="admin-question-item">
                                              <div className="admin-question-header">
                                                <div className="admin-question-main">
                                                  <span className="admin-question-number">{question.number || question.question_number || question.questionNumber || (qIndex + 1)}</span>
                                                  <span className="admin-question-text">{question.text || question.question_text}</span>
                                                </div>
                                                {question.marks && (
                                                  <span className="admin-question-marks">[{question.marks} marks]</span>
                                                )}
                                              </div>

                                              {(question.subQuestions || question.sub_questions) && (question.subQuestions || question.sub_questions).length > 0 && (
                                                <div className="admin-sub-questions">
                                                  {(question.subQuestions || question.sub_questions).map((subQ, sIndex) => (
                                                    <div key={sIndex} className="admin-sub-question-item">
                                                      <div className="admin-sub-question-content">
                                                        <span className="admin-sub-question-number">{subQ.part || subQ.question_part || subQ.subQuestionNumber || String.fromCharCode(97 + sIndex)}</span>
                                                        <span className="admin-sub-question-text">{subQ.text || subQ.question_text}</span>
                                                      </div>
                                                      {subQ.marks && (
                                                        <span className="admin-sub-question-marks">[{subQ.marks} marks]</span>
                                                      )}
                                                    </div>
                                                  ))}
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
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
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
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Marking Schemes ({markingSchemeEntries.length})</h3>
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
                        <th className="admin-table__header">Questions</th>
                        <th className="admin-table__header">Marks</th>
                        <th className="admin-table__header">Uploaded</th>
                        <th className="admin-table__header">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {markingSchemeEntries.map(entry => {
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
                        const markCount = entry.totalMarks || Object.values(questions).reduce((total, question) => {
                          return total + (question.marks ? question.marks.length : 0);
                        }, 0);

                        return (
                          <React.Fragment key={entry.id}>
                            <tr className="admin-table__row">
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
                              <td className="admin-table__cell">
                                {questionCount ? (
                                  <span className="question-count">
                                    {questionCount} Q
                                  </span>
                                ) : (
                                  <span className="no-questions">No questions</span>
                                )}
                              </td>
                              <td className="admin-table__cell">
                                {markCount ? (
                                  <span className="mark-count">
                                    {markCount} marks
                                  </span>
                                ) : (
                                  <span className="no-marks">No marks</span>
                                )}
                              </td>
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
                                      <h4 className="admin-content-header__title">Marking Scheme Details: {
                                        board !== 'N/A' ?
                                          `${board} ${qualification} - ${paperCode}`.replace(/\s+/g, ' ').trim() :
                                          `Marking Scheme ${entry.id}`
                                      }</h4>
                                      <div className="admin-content-info">
                                        <span className="admin-content-info__text">Questions are displayed in numerical order</span>
                                        <button
                                          className="admin-close-btn"
                                          onClick={() => setExpandedMarkingSchemeId(null)}
                                          title="Close"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>

                                    {/* Exam Details */}
                                    {(entry.examDetails || (entry.markingSchemeData && entry.markingSchemeData.examDetails)) && (
                                      <div className="admin-questions-content">
                                        <h6 className="admin-questions-summary__title">Exam Information</h6>
                                        <div className="admin-questions-summary">
                                          <span className="admin-summary-item">
                                            <strong>Board:</strong> {entry.examDetails?.board || entry.markingSchemeData?.examDetails?.board || 'Unknown'}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Qualification:</strong> {entry.examDetails?.qualification || entry.markingSchemeData?.examDetails?.qualification || 'Unknown'}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Paper Code:</strong> {entry.examDetails?.paperCode || entry.markingSchemeData?.examDetails?.paperCode || 'Unknown'}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Paper:</strong> {entry.examDetails?.paper || entry.markingSchemeData?.examDetails?.paper || 'Unknown'}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Exam Series:</strong> {entry.examDetails?.exam_series || entry.markingSchemeData?.examDetails?.exam_series || 'Unknown'}
                                          </span>
                                        </div>
                                      </div>
                                    )}

                                    {/* Summary Stats */}
                                    <div className="admin-questions-content">
                                      <h6 className="admin-questions-summary__title">Summary Statistics</h6>
                                      <div className="admin-questions-summary">
                                        <span className="admin-summary-item">
                                          <strong>Total Questions:</strong> {entry.totalQuestions ||
                                            ((entry.questions || entry.markingSchemeData?.questions) ?
                                              Object.keys(entry.questions || entry.markingSchemeData.questions).sort((a, b) => {
                                                const numA = parseInt(a);
                                                const numB = parseInt(b);
                                                if (!isNaN(numA) && !isNaN(numB)) {
                                                  return numA - numB;
                                                }
                                                return a.localeCompare(b);
                                              }).length : 'N/A')}
                                        </span>
                                        <span className="admin-summary-item">
                                          <strong>Total Marks:</strong> {entry.totalMarks ||
                                            ((entry.questions || entry.markingSchemeData?.questions) ?
                                              Object.values(entry.questions || entry.markingSchemeData.questions).reduce((total, question) => {
                                                return total + (question.marks ? question.marks.length : 0);
                                              }, 0) : 'N/A')}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Questions List */}
                                    {(entry.questions || (entry.markingSchemeData && entry.markingSchemeData.questions)) && (
                                      <div className="admin-questions-content">
                                        <h6 className="admin-questions-summary__title">Questions ({Object.keys(entry.questions || entry.markingSchemeData.questions).length})</h6>
                                        <div className="admin-questions-list">
                                          {Object.entries(entry.questions || entry.markingSchemeData.questions)
                                            .sort(([a], [b]) => {
                                              // Sort numerically if both are numbers, otherwise alphabetically
                                              const numA = parseInt(a);
                                              const numB = parseInt(b);
                                              if (!isNaN(numA) && !isNaN(numB)) {
                                                return numA - numB;
                                              }
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
                      })}
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
              <div className="admin-data-section__header">
                <h3 className="admin-data-section__title">Grade Boundaries ({gradeBoundaryEntries.length})</h3>
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
                      {gradeBoundaryEntries.map(entry => {
                        const examBoard = entry.exam_board || entry.examBoard || 'N/A';
                        const qualification = entry.qualification || 'N/A';
                        const examSeries = entry.exam_series || entry.examSeries || 'N/A';
                        const subjects = entry.subjects || [];
                        const subjectCount = subjects.length;
                        const subjectNames = subjects.map(s => s.name || s.subject || 'Unknown').join(', ');

                        return (
                          <React.Fragment key={entry.id}>
                            <tr className="admin-table__row">
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
                      })}
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
              <p>Search users and manage their subscriptions and credits</p>
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
                    className="admin-btn admin-btn--warning"
                    onClick={async () => {
                      if (!window.confirm('Reset credits to plan default?')) return;
                      try {
                        const response = await fetch(`http://localhost:5001/api/admin/credits/${searchUserId}/reset`, {
                          method: 'POST'
                        });
                        if (response.ok) {
                          alert('Credits reset successfully!');
                          // Refetch credits
                          const creditsResponse = await fetch(`http://localhost:5001/api/credits/${searchUserId}`);
                          if (creditsResponse.ok) {
                            setUserCredits(await creditsResponse.json());
                          }
                        } else {
                          alert('Failed to reset credits');
                        }
                      } catch (error) {
                        console.error('Error resetting credits:', error);
                        alert('Error resetting credits');
                      }
                    }}
                  >
                    Reset to Plan Default
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
                          const response = await fetch(`http://localhost:5001/api/admin/credits/${searchUserId}/adjust`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
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

