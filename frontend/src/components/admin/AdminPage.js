import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, 
  Trash2, 
  Database,
  ClipboardList,
  Search
} from 'lucide-react';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
import { useAuth } from '../../contexts/AuthContext';
import ApiClient from '../../services/apiClient';
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

/**
 * AdminPage component for managing AI model JSON data
 * @returns {JSX.Element} The admin page component
 */
function AdminPage() {
  // Get auth context
  const { getAuthToken } = useAuth();
  
  // State management
  const [activeTab, setActiveTab] = useState('json'); // Default to JSON tab
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
  
  // Query tab state
  const [isClearingSessions, setIsClearingSessions] = useState(false);
  const [isClearingMarkingResults, setIsClearingMarkingResults] = useState(false);
  
  // Constants removed - using ApiClient instead
  
  // Form validation
  const isJsonFormValid = useCallback(() => {
    return jsonForm.jsonData;
  }, [jsonForm]);
  
  const isMarkingSchemeFormValid = useCallback(() => {
    return markingSchemeForm.markingSchemeData.trim().length > 0;
  }, [markingSchemeForm.markingSchemeData]);
  
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

  // Load JSON entries from fullExamPapers
  const loadJsonEntries = useCallback(async () => {
    try {
      const authToken = await getAuthToken();
      const data = await ApiClient.get('/api/admin/json/collections/fullExamPapers', authToken);
      setJsonEntries(Array.isArray(data.entries) ? data.entries : []);
      setLoading(false); // Set loading to false when data is loaded (even if empty)
    } catch (e) {
      setError(`Failed to load JSON entries: ${e.message}`);
      setLoading(false); // Set loading to false on error
      setTimeout(() => setError(null), 4000);
    }
  }, [getAuthToken]);

  // Load marking scheme entries
  const loadMarkingSchemeEntries = useCallback(async () => {
    try {
      const authToken = await getAuthToken();
      const data = await ApiClient.get('/api/admin/json/collections/markingSchemes', authToken);
      setMarkingSchemeEntries(data.entries || []);
    } catch (error) {
      console.error('Error loading marking scheme entries:', error);
      setMarkingSchemeEntries([]);
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

  // Clear all marking results data
  const clearAllMarkingResults = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL marking results? This action cannot be undone and will remove all homework marking data.')) {
      return;
    }
    
    setIsClearingMarkingResults(true);
    try {
      const authToken = await getAuthToken();
      const result = await ApiClient.delete('/api/admin/clear-all-marking-results', authToken);
      console.log('All marking results cleared:', result.message);
      setError(`✅ All marking results have been cleared successfully.`);
      setTimeout(() => setError(null), 5000);
    } catch (error) {
      console.error('Error clearing marking results:', error);
      setError(`Error clearing marking results: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsClearingMarkingResults(false);
    }
  }, [getAuthToken]);

  // Handle JSON form input changes
  const handleJsonInputChange = useCallback((field, value) => {
    setJsonForm(prev => ({ ...prev, [field]: value }));
  }, []);
  
  // Handle marking scheme form input changes
  const handleMarkingSchemeInputChange = useCallback((field, value) => {
    setMarkingSchemeForm(prev => ({ ...prev, [field]: value }));
  }, []);
  
  // Load data on component mount
  useEffect(() => {
    loadJsonEntries();
    loadMarkingSchemeEntries();
  }, [loadJsonEntries, loadMarkingSchemeEntries]);

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
            className={`admin-tab ${activeTab === 'query' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('query')}
          >
            <Search size={16} />
            Query
          </button>
              </div>

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
                        <th className="admin-table__header">Board</th>
                    <th className="admin-table__header">Year</th>
                        <th className="admin-table__header">Session</th>
                        <th className="admin-table__header">Tier</th>
                    <th className="admin-table__header">Paper</th>
                        <th className="admin-table__header">Code</th>
                    <th className="admin-table__header">Questions</th>
                    <th className="admin-table__header">Uploaded</th>
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
                        const year = examMeta.year || 'N/A';
                        const session = examMeta.session || examMeta.time_allowed || 'N/A';
                        const tier = examMeta.tier || examMeta.level || 'N/A';
                        const paper = examMeta.paper || examMeta.paper_title || 'N/A';
                        const code = examMeta.code || examMeta.exam_code || 'N/A';
                        
                        // Use database fields for question counts
                        const questionCount = examMeta.totalQuestions || examMeta.total_questions || (examData.questions ? examData.questions.length : 0);
                        const subQuestionCount = examMeta.questionsWithSubQuestions || examMeta.questions_with_subquestions || (examData.questions ? 
                          examData.questions.reduce((total, q) => total + ((q.subQuestions || q.sub_questions) ? (q.subQuestions || q.sub_questions).length : 0), 0) : 0);

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
                                      `${board} ${year} ${code}`.replace(/\s+/g, ' ').trim() :
                                      examData.originalName || examData.filename || entry.id
                                    }
                                  </span>
                                  <span className="expand-indicator">
                                    {expandedJsonId === entry.id ? '▼' : '▶'}
                            </span>
                          </div>
                        </td>
                              <td className="admin-table__cell">{board}</td>
                              <td className="admin-table__cell">{year}</td>
                              <td className="admin-table__cell">{session}</td>
                              <td className="admin-table__cell">{tier}</td>
                              <td className="admin-table__cell">{paper}</td>
                              <td className="admin-table__cell">{code}</td>
                              <td className="admin-table__cell">
                                {questionCount ? (
                            <span className="question-count">
                                    {questionCount} Q{subQuestionCount ? ` (${subQuestionCount} sub)` : ''}
                            </span>
                          ) : (
                            <span className="no-questions">No questions</span>
                          )}
                        </td>
                              <td className="admin-table__cell">{formatDate(entry.uploadedAt)}</td>
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
                                <td colSpan="10">
                            <div className="admin-expanded-content">
                                                          <div className="admin-content-header">
                                      <h4 className="admin-content-header__title">Exam Paper Content: {
                                        board !== 'N/A' ? 
                                          `${board} ${year} ${code}`.replace(/\s+/g, ' ').trim() :
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
                                            <strong>Year:</strong> {year}
                                    </span>
                                    <span className="admin-summary-item">
                                            <strong>Total Questions:</strong> {questionCount}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Sub-questions:</strong> {subQuestionCount}
                                          </span>
                                          <span className="admin-summary-item">
                                            <strong>Total Marks:</strong> {examData.questions.reduce((total, q) => {
                                              const questionMarks = q.marks || 0;
                                              const subQuestionMarks = (q.subQuestions || q.sub_questions) ? (q.subQuestions || q.sub_questions).reduce((subTotal, subQ) => subTotal + (subQ.marks || 0), 0) : 0;
                                              return total + questionMarks + subQuestionMarks;
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
                        <th className="admin-table__header">Board</th>
                        <th className="admin-table__header">Qualification</th>
                        <th className="admin-table__header">Paper Code</th>
                        <th className="admin-table__header">Date</th>
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
                        const paperCode = examDetails.paperCode || 'N/A';
                        const date = examDetails.date || 'N/A';
                        
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
                              <td className="admin-table__cell">{board}</td>
                              <td className="admin-table__cell">{qualification}</td>
                              <td className="admin-table__cell">{paperCode}</td>
                              <td className="admin-table__cell">{date}</td>
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
                                <td colSpan="10" className="admin-expanded-cell">
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
                                    <strong>Date:</strong> {entry.examDetails?.date || entry.markingSchemeData?.examDetails?.date || 'Unknown'}
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
                                          {question.marks.map((mark, markIndex) => (
                                            <div key={markIndex} className="admin-sub-question-item">
                                              <div className="admin-sub-question-content">
                                                <span className="admin-sub-question-number">{markIndex + 1}</span>
                                                <span className="admin-sub-question-text">
                                                  <strong>{mark.mark}</strong>
                                                  {mark.answer && ` - ${mark.answer}`}
                                                  {mark.comments && ` (${mark.comments})`}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
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
                    <li>All user chat sessions</li>
                    <li>All conversation messages and AI responses</li>
                    <li>All uploaded images and annotations</li>
                    <li>All session metadata and timestamps</li>
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

            {/* Clear Marking Results Panel */}
            <div className="admin-query-section">
              <div className="admin-query-header">
                <h3 className="admin-query-title">Clear All Marking Results</h3>
                <p className="admin-query-description">Remove all homework marking results from the database</p>
              </div>
              
              <div className="admin-query-content">
                <div className="admin-query-warning">
                  <div className="admin-query-warning-icon">⚠️</div>
                  <div className="admin-query-warning-text">
                    <strong>Warning:</strong> This action will permanently delete all marking results data from the database.
                  </div>
                </div>
                
                <div className="admin-query-details">
                  <h4 className="admin-query-details-title">This includes:</h4>
                  <ul className="admin-query-list">
                    <li>All homework marking results and annotations</li>
                    <li>All AI-generated feedback and corrections</li>
                    <li>All uploaded homework images and processed data</li>
                    <li>All marking metadata and timestamps</li>
                  </ul>
                </div>
                
                <div className="admin-query-danger">
                  <strong>This action cannot be undone.</strong>
                </div>
                
                <div className="admin-query-actions">
                  <button
                    className="admin-btn admin-btn--danger"
                    onClick={clearAllMarkingResults}
                    disabled={isClearingMarkingResults}
                  >
                    <Trash2 size={16} />
                    {isClearingMarkingResults ? 'Clearing Marking Results...' : 'Clear All Marking Results'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPage;

