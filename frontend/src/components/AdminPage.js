import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, 
  Trash2, 
  Database
} from 'lucide-react';
import Sidebar from './Sidebar';
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
  
  // Constants
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
  
  // Form validation
  const isJsonFormValid = useCallback(() => {
    return jsonForm.jsonData;
  }, [jsonForm]);
  
  // Reset forms to initial state
  const resetJsonForm = useCallback(() => {
    setJsonForm({
      jsonData: ''
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

  // Handle JSON form input changes
  const handleJsonInputChange = useCallback((field, value) => {
    setJsonForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // Load data on component mount
  useEffect(() => {
    loadJsonEntries();
  }, [loadJsonEntries]);

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
        <Sidebar />
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
      <Sidebar />
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
            JSON Data
          </button>
        </div>

        {/* JSON Data Tab */}
        {activeTab === 'json' && (
          <div className="tab-content">
            <div className="section-header">
              <h2>Full Exam Papers</h2>
              <p>Manage AI model training data for exam papers</p>
            </div>

            {/* JSON Upload Form */}
            <div className="upload-section">
              <h3>Upload JSON Data</h3>
              <div className="upload-form">
                <div className="form-group">
                  <label htmlFor="jsonData">JSON Data:</label>
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

            {/* JSON Data List */}
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
                                          <summary style={{ cursor: 'pointer', color: '#666' }}>View Raw JSON Data</summary>
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
      </div>
    </div>
  );
}

export default AdminPage;

