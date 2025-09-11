import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, 
  Trash2, 
  Database,
  ClipboardList,
  Search
} from 'lucide-react';
import { useSessionContext } from '../contexts/SessionContext';
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
  // Get sessionManager from context
  const { sessionManager } = useSessionContext();
  
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
  
  // Constants
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
  
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
      const response = await fetch(`${API_BASE}/api/admin/json/collections/fullExamPapers`);
      if (response.ok) {
        const data = await response.json();
        setJsonEntries(Array.isArray(data.entries) ? data.entries : []);
      } else {
        setError(`Failed to load JSON entries (HTTP ${response.status})`);
        setTimeout(() => setError(null), 4000);
      }
    } catch (e) {
      setError(`Failed to load JSON entries: ${e.message}`);
      setTimeout(() => setError(null), 4000);
    }
  }, [API_BASE]);

  // Load marking scheme entries
  const loadMarkingSchemeEntries = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/json/collections/markingSchemes`);
      if (response.ok) {
        const data = await response.json();
        setMarkingSchemeEntries(data.entries || []);
      } else {
        console.error('Failed to load marking scheme entries');
        setMarkingSchemeEntries([]);
      }
    } catch (error) {
      console.error('Error loading marking scheme entries:', error);
      setMarkingSchemeEntries([]);
    }
  }, [API_BASE]);
  
  // Delete all JSON entries
  const deleteAllJsonEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL exam paper data? This action cannot be undone.')) {
      return;
    }
    
    setIsDeletingAll(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/json/collections/fullExamPapers/clear-all`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('All entries deleted:', result.message);
        setJsonEntries([]);
        setError(`✅ All exam paper data has been deleted successfully.`);
        setTimeout(() => setError(null), 5000);
      } else {
        const error = await response.json();
        console.error('Failed to delete all entries:', error);
        setError(`Failed to delete all entries: ${error.error}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error deleting all entries:', error);
      setError(`Error deleting all entries: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsDeletingAll(false);
    }
  }, [API_BASE]);

  // Delete individual JSON entry
  const deleteJsonEntry = useCallback(async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this exam paper? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/json/collections/fullExamPapers/${entryId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Entry deleted:', result.message);
        setJsonEntries(prev => prev.filter(entry => entry.id !== entryId));
        setError(`✅ Exam paper deleted successfully.`);
          setTimeout(() => setError(null), 3000);
      } else {
        const error = await response.json();
        console.error('Failed to delete entry:', error);
        setError(`Failed to delete entry: ${error.error}`);
          setTimeout(() => setError(null), 5000);
        }
    } catch (error) {
      console.error('Error deleting entry:', error);
      setError(`Error deleting entry: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [API_BASE]);

  // Delete all marking scheme entries
  const deleteAllMarkingSchemeEntries = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL marking scheme data? This action cannot be undone.')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/json/collections/markingSchemes`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('All marking schemes deleted:', result.message);
        setMarkingSchemeEntries([]);
        setError(`✅ All marking schemes deleted successfully.`);
        setTimeout(() => setError(null), 3000);
      } else {
        const error = await response.json();
        console.error('Failed to delete all marking schemes:', error);
        setError(`Failed to delete all marking schemes: ${error.error}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error deleting all marking schemes:', error);
      setError(`Error deleting all marking schemes: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [API_BASE]);

  // Delete individual marking scheme entry
  const deleteMarkingSchemeEntry = useCallback(async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this marking scheme? This action cannot be undone.')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/json/collections/markingSchemes/${entryId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Marking scheme deleted:', result.message);
        setMarkingSchemeEntries(prev => prev.filter(entry => entry.id !== entryId));
        setError(`✅ Marking scheme deleted successfully.`);
        setTimeout(() => setError(null), 3000);
      } else {
        const error = await response.json();
        console.error('Failed to delete marking scheme:', error);
        setError(`Failed to delete marking scheme: ${error.error}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error deleting marking scheme:', error);
      setError(`Error deleting marking scheme: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [API_BASE]);
  
  // Upload JSON data
  const uploadJsonData = useCallback(async () => {
    if (!isJsonFormValid()) {
      setError('Please enter valid JSON data');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/json/collections/fullExamPapers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: jsonForm.jsonData
      });

      if (response.ok) {
        const result = await response.json();
        console.log('JSON uploaded successfully:', result);
        setJsonEntries(prev => [result.entry, ...prev]);
        resetJsonForm();
        setError(`✅ JSON data uploaded successfully to fullExamPapers collection.`);
        setTimeout(() => setError(null), 5000);
      } else {
        const error = await response.json();
        console.error('Failed to upload JSON:', error);
        setError(`Failed to upload JSON: ${error.error}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error uploading JSON:', error);
      setError(`Error uploading JSON: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [jsonForm, API_BASE, resetJsonForm, isJsonFormValid]);

  // Upload marking scheme data
  const uploadMarkingSchemeData = useCallback(async () => {
    if (!isMarkingSchemeFormValid()) {
      setError('Please enter valid marking scheme data');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/json/collections/markingSchemes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          markingSchemeData: markingSchemeForm.markingSchemeData
        }),
      });

      if (response.ok) {
        setError(null);
        resetMarkingSchemeForm();
        // Reload marking scheme entries
        loadMarkingSchemeEntries();
      } else {
        const error = await response.json();
        console.error('Failed to upload marking scheme:', error);
        setError(`Failed to upload marking scheme: ${error.error}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error uploading marking scheme:', error);
      setError(`Error uploading marking scheme: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    }
  }, [markingSchemeForm, API_BASE, resetMarkingSchemeForm, isMarkingSchemeFormValid, loadMarkingSchemeEntries]);

  // Clear all sessions data
  const clearAllSessions = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL chat sessions? This action cannot be undone and will remove all user conversation history.')) {
      return;
    }
    
    setIsClearingSessions(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/clear-all-sessions`, {
        method: 'DELETE'
      });
      
            if (response.ok) {
              const result = await response.json();
              console.log('All sessions cleared:', result.message);
              setError(`✅ All chat sessions have been cleared successfully.`);
              setTimeout(() => setError(null), 5000);
              
              // Use SessionManager event to notify sidebar to refresh
              sessionManager.clearAllSessions();
              
              // Navigate to mark homework page after clearing all sessions
              window.location.href = '/mark-homework';
            } else {
        const error = await response.json();
        console.error('Failed to clear sessions:', error);
        setError(`Failed to clear sessions: ${error.error}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error clearing sessions:', error);
      setError(`Error clearing sessions: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsClearingSessions(false);
    }
  }, [API_BASE]);

  // Clear all marking results data
  const clearAllMarkingResults = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete ALL marking results? This action cannot be undone and will remove all homework marking data.')) {
      return;
    }
    
    setIsClearingMarkingResults(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/clear-all-marking-results`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('All marking results cleared:', result.message);
        setError(`✅ All marking results have been cleared successfully.`);
        setTimeout(() => setError(null), 5000);
      } else {
        const error = await response.json();
        console.error('Failed to clear marking results:', error);
        setError(`Failed to clear marking results: ${error.error}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error clearing marking results:', error);
      setError(`Error clearing marking results: ${error.message}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsClearingMarkingResults(false);
    }
  }, [API_BASE]);

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

  // Set loading to false after data is loaded
  useEffect(() => {
    if (jsonEntries.length > 0 || error) {
      setLoading(false);
    }
  }, [jsonEntries, error]);

  // Render loading state
  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-content">
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading admin panel...</p>
          </div>
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
        <div className="tab-navigation">
          <button
            className={`tab-button ${activeTab === 'json' ? 'active' : ''}`}
            onClick={() => setActiveTab('json')}
          >
            <Database size={16} />
            Exam JSON
          </button>
          <button
            className={`tab-button ${activeTab === 'marking-scheme' ? 'active' : ''}`}
            onClick={() => setActiveTab('marking-scheme')}
          >
            <ClipboardList size={16} />
            Marking Scheme
          </button>
          <button
            className={`tab-button ${activeTab === 'query' ? 'active' : ''}`}
            onClick={() => setActiveTab('query')}
          >
            <Search size={16} />
            Query
          </button>
              </div>

        {/* Exam JSON Tab */}
        {activeTab === 'json' && (
          <div className="tab-content">
            <div className="section-header">
              <h2>Full Exam Papers</h2>
              <p>Manage AI model training data for exam papers</p>
            </div>
            
            {/* JSON Upload Form */}
            <div className="upload-section">
              <h3>Upload Exam JSON</h3>
              <div className="upload-form">
              <div className="form-group">
                  <label htmlFor="jsonData">Exam JSON:</label>
                  <textarea
                    id="jsonData"
                    value={jsonForm.jsonData}
                    onChange={(e) => handleJsonInputChange('jsonData', e.target.value)}
                    placeholder="Paste your JSON data here..."
                    rows={8}
                    className="form-control"
                  />
              </div>
                <div className="form-actions">
                <button 
                    type="button"
                    className="btn btn-primary"
                    onClick={uploadJsonData}
                    disabled={loading || !isJsonFormValid()}
                  >
                    <FileText size={16} />
                    {loading ? 'Uploading...' : 'Upload to fullExamPapers'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={resetJsonForm}
                  >
                    Clear Form
                </button>
              </div>
            </div>
        </div>

            {/* Exam JSON List */}
            <div className="data-section">
              <div className="section-header">
                <h3>Full Exam Papers ({jsonEntries.length})</h3>
                {jsonEntries.length > 0 && (
              <button
                    className="btn btn-danger"
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
                <div className="data-table-container">
                  <table className="data-table">
                <thead>
                  <tr>
                        <th>Exam Paper</th>
                        <th>Board</th>
                    <th>Year</th>
                        <th>Session</th>
                        <th>Tier</th>
                    <th>Paper</th>
                        <th>Code</th>
                    <th>Questions</th>
                    <th>Uploaded</th>
                    <th>Actions</th>
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
                            <tr className="data-row">
                              <td className="exam-paper-link">
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
                                  <FileText size={16} />
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
                              <td>{board}</td>
                              <td>{year}</td>
                              <td>{session}</td>
                              <td>{tier}</td>
                              <td>{paper}</td>
                              <td>{code}</td>
                              <td>
                                {questionCount ? (
                            <span className="question-count">
                                    {questionCount} Q{subQuestionCount ? ` (${subQuestionCount} sub)` : ''}
                            </span>
                          ) : (
                            <span className="no-questions">No questions</span>
                          )}
                        </td>
                              <td>{formatDate(entry.uploadedAt)}</td>
                        <td className="actions-cell">
                          <button
                            className="btn-icon"
                                  onClick={() => setExpandedJsonId(expandedJsonId === entry.id ? null : entry.id)}
                                  title="View"
                            >
                              <FileText size={16} />
                            </button>
                          <button
                                  className="btn-icon btn-danger"
                                  onClick={() => deleteJsonEntry(entry.id)}
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                      
                            {expandedJsonId === entry.id && (
                        <tr className="expanded-content-row">
                                <td colSpan="10">
                            <div className="expanded-content">
                                                          <div className="content-header">
                                      <h4>Exam Paper Content: {
                                        board !== 'N/A' ? 
                                          `${board} ${year} ${code}`.replace(/\s+/g, ' ').trim() :
                                          examData.originalName || examData.filename || entry.id
                                      }</h4>
                              <div className="content-info">
                                <span className="info-text">Questions are displayed in numerical order</span>
                                <button 
                                  className="btn-icon close-btn"
                                          onClick={() => setExpandedJsonId(null)}
                                  title="Close"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                              
                                    {examData.questions && examData.questions.length > 0 ? (
                                <div className="questions-content">
                                  <div className="questions-summary">
                                    <span className="summary-item">
                                            <strong>Year:</strong> {year}
                                    </span>
                                    <span className="summary-item">
                                            <strong>Total Questions:</strong> {questionCount}
                                    </span>
                                    <span className="summary-item">
                                            <strong>Sub-questions:</strong> {subQuestionCount}
                                          </span>
                                          <span className="summary-item">
                                            <strong>Total Marks:</strong> {examData.questions.reduce((total, q) => {
                                              const questionMarks = q.marks || 0;
                                              const subQuestionMarks = (q.subQuestions || q.sub_questions) ? (q.subQuestions || q.sub_questions).reduce((subTotal, subQ) => subTotal + (subQ.marks || 0), 0) : 0;
                                              return total + questionMarks + subQuestionMarks;
                                            }, 0)}
                                    </span>
                                  </div>
                                  
                                  <div className="questions-list">
                                          {examData.questions.map((question, qIndex) => (
                                      <div key={qIndex} className="question-item">
                                        <div className="question-header">
                                                <span className="question-number">Question {question.number || question.question_number || question.questionNumber || (qIndex + 1)}</span>
                                          {question.marks && (
                                            <span className="question-marks">[{question.marks} marks]</span>
                                          )}
                                        </div>
                                              <div className="question-text">{question.text || question.question_text}</div>
                                        
                                              {(question.subQuestions || question.sub_questions) && (question.subQuestions || question.sub_questions).length > 0 && (
                                          <div className="sub-questions">
                                                  {(question.subQuestions || question.sub_questions).map((subQ, sIndex) => (
                                              <div key={sIndex} className="sub-question-item">
                                                <div className="sub-question-header">
                                                        <span className="sub-question-number">({subQ.part || subQ.question_part || subQ.subQuestionNumber || String.fromCharCode(97 + sIndex)})</span>
                                                  {subQ.marks && (
                                                    <span className="sub-question-marks">[{subQ.marks} marks]</span>
                                                  )}
                                                </div>
                                                      <div className="sub-question-text">{subQ.text || subQ.question_text}</div>
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
          <div className="tab-content">
            <div className="section-header">
              <h2>Marking Schemes</h2>
              <p>Manage marking scheme data for exam papers</p>
            </div>

            {/* Marking Scheme Upload Form */}
            <div className="upload-section">
              <h3>Upload Marking Scheme</h3>
              <div className="upload-form">
                <div className="form-group">
                  <label htmlFor="markingSchemeData">Marking Scheme Data:</label>
                  <textarea
                    id="markingSchemeData"
                    value={markingSchemeForm.markingSchemeData}
                    onChange={(e) => handleMarkingSchemeInputChange('markingSchemeData', e.target.value)}
                    placeholder="Paste your marking scheme data here..."
                    rows={8}
                    className="form-control"
                  />
                </div>
                <div className="form-actions">
                  <button
                    type="button"
                    onClick={uploadMarkingSchemeData}
                    disabled={!isMarkingSchemeFormValid()}
                    className="btn btn-primary"
                  >
                    <FileText size={16} />
                    Upload Marking Scheme
                  </button>
                  <button
                    type="button"
                    onClick={resetMarkingSchemeForm}
                    className="btn btn-secondary"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Marking Scheme List */}
            <div className="data-section">
              <div className="section-header">
                <h3>Marking Schemes ({markingSchemeEntries.length})</h3>
                {markingSchemeEntries.length > 0 && (
                  <button
                    onClick={deleteAllMarkingSchemeEntries}
                    className="btn btn-danger"
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
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Marking Scheme</th>
                        <th>Board</th>
                        <th>Qualification</th>
                        <th>Paper Code</th>
                        <th>Tier</th>
                        <th>Date</th>
                        <th>Questions</th>
                        <th>Marks</th>
                        <th>Uploaded</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {markingSchemeEntries.map(entry => {
                        // Extract exam details from either structure
                        const examDetails = entry.examDetails || entry.markingSchemeData?.examDetails || {};
                        const questions = entry.markingSchemeData?.questions || {};
                        
                        // Get display values
                        const board = examDetails.board || 'N/A';
                        const qualification = examDetails.qualification || 'N/A';
                        const paperCode = examDetails.paperCode || 'N/A';
                        const tier = examDetails.tier || 'N/A';
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
                            <tr className="data-row">
                              <td className="exam-paper-link">
                                <div
                                  className="clickable-exam-paper"
                                  onClick={() => {
                                    const newExpandedId = expandedMarkingSchemeId === entry.id ? null : entry.id;
                                    setExpandedMarkingSchemeId(newExpandedId);
                                  }}
                                  title="Click to view marking scheme content"
                                >
                                  <ClipboardList size={16} />
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
                              <td>{board}</td>
                              <td>{qualification}</td>
                              <td>{paperCode}</td>
                              <td>{tier}</td>
                              <td>{date}</td>
                              <td>
                                {questionCount ? (
                                  <span className="question-count">
                                    {questionCount} Q
                                  </span>
                                ) : (
                                  <span className="no-questions">No questions</span>
                                )}
                              </td>
                              <td>
                                {markCount ? (
                                  <span className="mark-count">
                                    {markCount} marks
                                  </span>
                                ) : (
                                  <span className="no-marks">No marks</span>
                                )}
                              </td>
                              <td>{formatDate(entry.createdAt || entry.uploadedAt)}</td>
                              <td className="actions-cell">
                                <button
                                  className="btn-icon"
                                  onClick={() => setExpandedMarkingSchemeId(expandedMarkingSchemeId === entry.id ? null : entry.id)}
                                  title="View"
                                >
                                  <ClipboardList size={16} />
                                </button>
                                <button
                                  className="btn-icon btn-danger"
                                  onClick={() => deleteMarkingSchemeEntry(entry.id)}
                                  title="Delete"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                            
                            {/* Expanded content row */}
                            {expandedMarkingSchemeId === entry.id && (
                              <tr className="expanded-row">
                                <td colSpan="10" className="expanded-cell">
                                  <div className="data-content">
                                    <div className="marking-scheme-details">
                                      <h5>Marking Scheme Details</h5>
                            
                            {/* Exam Details */}
                            {(entry.examDetails || (entry.markingSchemeData && entry.markingSchemeData.examDetails)) && (
                              <div className="exam-details-section">
                                <h6>Exam Information</h6>
                                <div className="exam-details-grid">
                                  <div className="detail-item">
                                    <span className="detail-label">Board:</span>
                                    <span className="detail-value">{entry.examDetails?.board || entry.markingSchemeData?.examDetails?.board || 'Unknown'}</span>
        </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Qualification:</span>
                                    <span className="detail-value">{entry.examDetails?.qualification || entry.markingSchemeData?.examDetails?.qualification || 'Unknown'}</span>
      </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Paper Code:</span>
                                    <span className="detail-value">{entry.examDetails?.paperCode || entry.markingSchemeData?.examDetails?.paperCode || 'Unknown'}</span>
    </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Tier:</span>
                                    <span className="detail-value">{entry.examDetails?.tier || entry.markingSchemeData?.examDetails?.tier || 'Unknown'}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Paper:</span>
                                    <span className="detail-value">{entry.examDetails?.paper || entry.markingSchemeData?.examDetails?.paper || 'Unknown'}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Date:</span>
                                    <span className="detail-value">{entry.examDetails?.date || entry.markingSchemeData?.examDetails?.date || 'Unknown'}</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Summary Stats */}
                            <div className="summary-stats">
                              <div className="stat-item">
                                <span className="stat-label">Total Questions:</span>
                                <span className="stat-value">
                                  {entry.totalQuestions || 
                                   (entry.markingSchemeData && entry.markingSchemeData.questions ? 
                                     Object.keys(entry.markingSchemeData.questions).sort((a, b) => {
                                       const numA = parseInt(a);
                                       const numB = parseInt(b);
                                       if (!isNaN(numA) && !isNaN(numB)) {
                                         return numA - numB;
                                       }
                                       return a.localeCompare(b);
                                     }).length : 'N/A')}
                                </span>
                              </div>
                              <div className="stat-item">
                                <span className="stat-label">Total Marks:</span>
                                <span className="stat-value">
                                  {entry.totalMarks || 
                                   (entry.markingSchemeData && entry.markingSchemeData.questions ? 
                                     Object.values(entry.markingSchemeData.questions).reduce((total, question) => {
                                       return total + (question.marks ? question.marks.length : 0);
                                     }, 0) : 'N/A')}
                                </span>
                              </div>
                            </div>

                            {/* Questions List */}
                            {entry.markingSchemeData && entry.markingSchemeData.questions && (
                              <div className="questions-section">
                                <h6>Questions ({Object.keys(entry.markingSchemeData.questions).length})</h6>
                                <div className="questions-list">
                                  {Object.entries(entry.markingSchemeData.questions)
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
                                    <div key={questionNum} className="question-item">
                                      <div className="question-header">
                                        <span className="question-number">Question {questionNum}</span>
                                        {question.answer && (
                                          <span className="question-answer">Answer: {question.answer}</span>
                                        )}
                                      </div>
                                      
                                      {/* Marks */}
                                      {question.marks && question.marks.length > 0 && (
                                        <div className="marks-section">
                                          <h7>Marks ({question.marks.length})</h7>
                                          {question.marks.map((mark, markIndex) => (
                                            <div key={markIndex} className="mark-item">
                                              <div className="mark-header">
                                                <span className="mark-type">{mark.mark}</span>
                                                {mark.answer && (
                                                  <span className="mark-answer">{mark.answer}</span>
                                                )}
                                              </div>
                                              {mark.comments && (
                                                <div className="mark-comments">{mark.comments}</div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* Guidance */}
                                      {question.guidance && question.guidance.length > 0 && (
                                        <div className="guidance-section">
                                          <h7>Guidance ({question.guidance.length})</h7>
                                          {question.guidance.map((guidance, guidanceIndex) => (
                                            <div key={guidanceIndex} className="guidance-item">
                                              <div className="guidance-scenario">
                                                <strong>Scenario:</strong> {guidance.scenario}
                                              </div>
                                              {guidance.outcome && (
                                                <div className="guidance-outcome">
                                                  <strong>Outcome:</strong> {guidance.outcome}
                                                </div>
                                              )}
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
                            <div className="metadata-section">
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
          <div className="tab-content">
            <div className="section-header">
              <h2>Database Queries</h2>
              <p>Execute database operations and manage system data</p>
            </div>
            
            {/* Clear Sessions Panel */}
            <div className="query-section">
              <div className="query-panel">
                <div className="query-panel-header">
                  <h3>Clear All Sessions</h3>
                  <p>Remove all chat session data from the database</p>
                </div>
                
                <div className="query-panel-content">
                  <div className="query-description">
                    <p><strong>Warning:</strong> This action will permanently delete all chat sessions and conversation history from the database. This includes:</p>
                    <ul>
                      <li>All user chat sessions (authenticated and anonymous)</li>
                      <li>All conversation messages and AI responses</li>
                      <li>All uploaded images and annotations</li>
                      <li>All session metadata and timestamps</li>
                    </ul>
                    <p><strong>This action cannot be undone.</strong></p>
                  </div>
                  
                  <div className="query-actions">
                    <button
                      className="btn btn-danger"
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

            {/* Clear Marking Results Panel */}
            <div className="query-section">
              <div className="query-panel">
                <div className="query-panel-header">
                  <h3>Clear All Marking Results</h3>
                  <p>Remove all homework marking results from the database</p>
                </div>
                
                <div className="query-panel-content">
                  <div className="query-description">
                    <p><strong>Warning:</strong> This action will permanently delete all marking results data from the database. This includes:</p>
                    <ul>
                      <li>All homework marking results and annotations</li>
                      <li>All AI-generated feedback and corrections</li>
                      <li>All uploaded homework images and processed data</li>
                      <li>All marking metadata and timestamps</li>
                    </ul>
                    <p><strong>This action cannot be undone.</strong></p>
                  </div>
                  
                  <div className="query-actions">
                    <button
                      className="btn btn-danger"
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
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPage;

