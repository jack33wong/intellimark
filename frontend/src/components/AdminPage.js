import React, { useState, useEffect, useCallback } from 'react';
import { 
  Upload, 
  FileText, 
  Trash2, 
  Edit,
  Database,
  FileText as FileTextIcon
} from 'lucide-react';
import Sidebar from './Sidebar';
import './AdminPage.css';

/**
 * AdminPage component for managing past paper PDFs and JSON data
 * @returns {JSX.Element} The admin page component
 */
function AdminPage() {
  // State management
  const [activeTab, setActiveTab] = useState('json'); // Default to JSON tab
  const [pastPapers, setPastPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingPaper, setEditingPaper] = useState(null);
  const [expandedPaper, setExpandedPaper] = useState(null);
  const [jsonEntries, setJsonEntries] = useState([]);
  const [expandedJsonId, setExpandedJsonId] = useState(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  
  // JSON upload state
  const [jsonForm, setJsonForm] = useState({
    jsonData: ''
  });
  
  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    examBoard: '',
    year: '',
    level: '',
    paper: '',
    type: 'Question Paper',
    qualification: 'GCSE',
    pdfFile: null
  });
  
  // Constants
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
  
  // Form validation
  const isFormValid = useCallback(() => {
    return uploadForm.examBoard && 
           uploadForm.year && 
           uploadForm.level && 
           uploadForm.paper && 
           uploadForm.pdfFile;
  }, [uploadForm]);
  
  const isJsonFormValid = useCallback(() => {
    return jsonForm.jsonData;
  }, [jsonForm]);
  
  // Reset forms to initial state
  const resetForm = useCallback(() => {
    setUploadForm({
      examBoard: '',
      year: '',
      level: '',
      paper: '',
      type: 'Question Paper',
      qualification: 'GCSE',
      pdfFile: null
    });
  }, []);
  
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
        // Remove the deleted entry from the local state
        setJsonEntries(prev => prev.filter(entry => entry.id !== entryId));
        setError(`✅ Exam paper deleted successfully.`);
        setTimeout(() => setError(null), 5000);
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
  
  // Handle JSON upload
  const handleJsonUpload = useCallback(async (e) => {
    e.preventDefault();
    
    if (!isJsonFormValid()) {
      setError('Please fill in all required fields');
      return;
    }
    
    try {
      // Validate JSON
      let parsedJson;
      try {
        parsedJson = JSON.parse(jsonForm.jsonData);
      } catch (parseError) {
        throw new Error('Invalid JSON format: ' + parseError.message);
      }
      
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${API_BASE}/api/admin/json/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: parsedJson
        }),
      });
      
      if (response.ok) {
        await response.json();
        setError(`✅ JSON uploaded successfully to collection: fullExamPapers`);
        resetJsonForm();
        loadJsonEntries();
        setTimeout(() => setError(null), 5000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }
    } catch (error) {
      console.error('JSON upload error:', error);
      setError(`JSON upload failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [jsonForm, API_BASE, resetJsonForm, isJsonFormValid]);
  
  // Load past papers data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${API_BASE}/api/admin/past-papers`);
      
      if (response.ok) {
        const papers = await response.json();
        setPastPapers(Array.isArray(papers) ? papers : []);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to load past papers:', error);
      setError(`Failed to load data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);
  
  // Handle file upload
  const handleFileUpload = useCallback(async (e) => {
    e.preventDefault();
    
    if (!isFormValid()) {
      setError('Please fill in all required fields and select a PDF file');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      const formData = new FormData();
      formData.append('pdfFile', uploadForm.pdfFile);
      formData.append('examBoard', uploadForm.examBoard);
      formData.append('year', uploadForm.year);
      formData.append('level', uploadForm.level);
      formData.append('paper', uploadForm.paper);
      formData.append('type', uploadForm.type);
      formData.append('qualification', uploadForm.qualification);
      
      const response = await fetch(`${API_BASE}/api/admin/past-papers/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        const result = await response.json();
        setPastPapers(prev => [result.pastPaper, ...prev]);
        resetForm();
        setError(null);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError(`Upload failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [uploadForm, API_BASE, resetForm, isFormValid]);
  
  // Handle form input changes
  const handleInputChange = useCallback((field, value) => {
    setUploadForm(prev => ({ ...prev, [field]: value }));
  }, []);
  

  
  // Extract exam information from filename
  const extractExamInfo = useCallback((filename) => {
    console.log('Extracting info from filename:', filename);
    
    // Remove .pdf extension
    const nameWithoutExt = filename.replace(/\.pdf$/i, '');
    console.log('Name without extension:', nameWithoutExt);
    
    // Split by common separators: dash, underscore, or space
    const parts = nameWithoutExt.split(/[-_\s]+/);
    console.log('Split parts:', parts);
    
    // Try to detect the format and extract accordingly
    if (parts.length >= 3) {
      const examBoard = parts[0];
      
      // Check if second part is a year (4 digits)
      const secondPart = parts[1];
      const yearNum = parseInt(secondPart);
      
      if (yearNum >= 1900 && yearNum <= 2100) {
        // Format 1: [ExamBoard]-[Year]-[Level]-[Type]
        const level = parts[2];
        const type = parts[3] || 'Question Paper';
        
        console.log('Format 1 detected:', { examBoard, year: yearNum, level, type });
        return { examBoard, year: yearNum, level, paper: '1', type, qualification: 'GCSE' };
      } else {
        // Format 2: [ExamBoard]-[PaperCode]-[Type]-[MonthYear]
        const paperCode = parts[1];
        const type = parts[2];
        const monthYear = parts[3];
        
        // Extract year from monthYear (e.g., JUN24 -> 2024, SEP23 -> 2023)
        let year = null;
        if (monthYear) {
          // Look for 2-digit year at the end
          const yearMatch = monthYear.match(/(\d{2})$/);
          if (yearMatch) {
            const shortYear = parseInt(yearMatch[1]);
            // Assume 20xx for years 00-99
            year = shortYear < 50 ? 2000 + shortYear : 1900 + shortYear;
          }
        }
        
        // If no year found in monthYear, try to find year anywhere in filename
        if (!year) {
          const yearMatch = filename.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
          if (yearMatch) {
            year = parseInt(yearMatch[1]);
          }
        }
        
        // Determine level from paper code (e.g., 83001H -> Higher, 83001F -> Foundation)
        let level = '';
        if (paperCode.includes('H')) {
          level = 'Higher';
        } else if (paperCode.includes('F')) {
          level = 'Foundation';
        } else if (paperCode.includes('AS')) {
          level = 'AS';
        } else if (paperCode.includes('A2')) {
          level = 'A2';
        }
        
        // Extract paper number from paper code (e.g., 83001H -> 1, 2H -> 2)
        let paperNumber = '1'; // Default to 1
        if (paperCode) {
          // Try to extract number from paper code
          const numberMatch = paperCode.match(/(\d+)/);
          if (numberMatch) {
            const num = parseInt(numberMatch[1]);
            // If it's a large number like 83001, extract the last digit or use 1
            if (num > 100) {
              // For codes like 83001, extract the last digit
              paperNumber = (num % 10).toString();
              if (paperNumber === '0') paperNumber = '1'; // Avoid 0
            } else {
              paperNumber = num.toString();
            }
          }
        }
        
        // Map type abbreviations
        let mappedType = type;
        if (type === 'QP') mappedType = 'Question Paper';
        else if (type === 'MS') mappedType = 'Mark Scheme';
        else if (type === 'SP') mappedType = 'Specimen';
        
        console.log('Format 2 detected:', { examBoard, year, level, paper: paperNumber, type: mappedType, qualification: 'GCSE' });
        
        if (year) {
          return { examBoard, year, level, paper: paperNumber, type: mappedType, qualification: 'GCSE' };
        }
      }
    }
    
    // Enhanced fallback: try to extract year from anywhere in filename
    const yearMatch = filename.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      console.log('Year extracted from fallback:', year);
      
      // Try to extract exam board from the beginning of filename
      const beforeYear = filename.substring(0, filename.indexOf(yearMatch[1]));
      const examBoard = beforeYear.replace(/[-_\s]+$/, '').trim();
      
      return { 
        examBoard: examBoard || '', 
        year, 
        level: '', 
        paper: '1',
        type: 'Question Paper',
        qualification: 'GCSE'
      };
    }
    
    console.log('No information could be extracted');
    return null;
  }, []);
  
  // Handle file selection
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      console.log('File selected:', file.name);
      
      setUploadForm(prev => ({ ...prev, pdfFile: file }));
      
      // Try to extract exam information from filename
      const extractedInfo = extractExamInfo(file.name);
      console.log('Extracted info:', extractedInfo);
      
      if (extractedInfo) {
        console.log('Setting form with extracted info:', extractedInfo);
        
        setUploadForm(prev => {
          const newForm = {
            ...prev,
            examBoard: extractedInfo.examBoard || prev.examBoard,
            year: extractedInfo.year || prev.year,
            level: extractedInfo.level || prev.level,
            paper: extractedInfo.paper || prev.paper,
            type: extractedInfo.type || prev.type,
            qualification: extractedInfo.qualification || prev.qualification
          };
          console.log('New form state:', newForm);
          return newForm;
        });
        
        if (extractedInfo.examBoard && extractedInfo.year && extractedInfo.level) {
          setError(null); // Clear any previous errors
          // Show success message for auto-fill
          setError(`✅ Auto-filled from filename: ${file.name}`);
          // Clear success message after 3 seconds
          setTimeout(() => setError(null), 3000);
        } else if (extractedInfo && extractedInfo.year) {
          // Partial auto-fill (only year found)
          setError(`⚠️ Partial auto-fill: Year ${extractedInfo.year} detected. Please fill in other fields manually.`);
          setTimeout(() => setError(null), 5000);
        }
      } else {
        console.log('No info could be extracted from filename');
      }
      
      setError(null);
    } else {
      setError('Please select a valid PDF file');
    }
  }, [extractExamInfo]);
  
  // Delete past paper
  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Are you sure you want to delete this past paper?')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/past-papers/${id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setPastPapers(prev => prev.filter(paper => paper.id !== id));
      } else {
        throw new Error('Failed to delete past paper');
      }
    } catch (error) {
      console.error('Delete error:', error);
      setError('Failed to delete past paper');
    }
  }, [API_BASE]);

  // Clear all past papers
  const handleClearAll = useCallback(async () => {
    if (!window.confirm('⚠️ WARNING: This will permanently delete ALL past papers from both the database and local system. This action cannot be undone. Are you absolutely sure?')) {
      return;
    }
    
    if (!window.confirm('Are you REALLY sure? This will delete everything and cannot be recovered.')) {
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${API_BASE}/api/admin/past-papers/clear-all`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        const result = await response.json();
        setPastPapers([]);
        setError(`✅ All past papers cleared successfully: ${result.clearedCount} papers removed`);
        setTimeout(() => setError(null), 5000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to clear all past papers');
      }
    } catch (error) {
      console.error('Clear all error:', error);
      setError(`Failed to clear all past papers: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);
  
    // Update past paper
  const handleUpdate = useCallback(async (id, updatedData) => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/past-papers/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedData),
      });

      if (response.ok) {
        const result = await response.json();
        setPastPapers(prev =>
          prev.map(paper =>
            paper.id === id ? result.pastPaper : paper
          )
        );
        setEditingPaper(null);
      } else {
        throw new Error('Failed to update past paper');
      }
    } catch (error) {
      console.error('Update error:', error);
      setError('Failed to update past paper');
    }
  }, [API_BASE]);

  // Extract questions from past paper
  const handleExtractQuestions = useCallback(async (id) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/admin/past-papers/${id}/extract-questions`, {
        method: 'POST',
      });

      if (response.ok) {
        const result = await response.json();
        setPastPapers(prev =>
          prev.map(paper =>
            paper.id === id ? result.pastPaper : paper
          )
        );
        setError(`✅ Questions extracted successfully: ${result.pastPaper.questionCount} questions, ${result.pastPaper.subQuestionCount} sub-questions`);
        setTimeout(() => setError(null), 5000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to extract questions');
      }
    } catch (error) {
      console.error('Question extraction error:', error);
      setError(`Failed to extract questions: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);
  


  // Toggle paper expansion
  const togglePaperExpansion = useCallback((paperId) => {
    setExpandedPaper(expandedPaper === paperId ? null : paperId);
  }, [expandedPaper]);
  
  // Load data on component mount
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load JSON list on mount and when switching back to JSON tab
  useEffect(() => {
    if (activeTab === 'json') {
      loadJsonEntries();
    }
  }, [activeTab, loadJsonEntries]);
  
  // Render loading state
  if (loading && pastPapers.length === 0) {
    return (
      <div className="admin-layout">
        <Sidebar />
        <div className="admin-content">
          <div className="loading">Loading admin panel...</div>
        </div>
      </div>
    );
  }
  
  // Render error state
  if (error && pastPapers.length === 0) {
    return (
      <div className="admin-layout">
        <Sidebar />
        <div className="admin-content">
          <div className="error-message">
            <h2>Error Loading Admin Panel</h2>
            <p>{error}</p>
            <button onClick={() => window.location.reload()}>Reload Page</button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="admin-layout">
      <Sidebar />
      <div className="admin-content">
        {/* Header */}
        <div className="admin-header">
          <div className="header-left">
            <h1>Admin Dashboard</h1>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-message">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab-button ${activeTab === 'json' ? 'active' : ''}`}
            onClick={() => setActiveTab('json')}
          >
            <Database size={16} /> AI Model
          </button>
          <button
            className={`tab-button ${activeTab === 'pdf' ? 'active' : ''}`}
            onClick={() => setActiveTab('pdf')}
          >
            <FileTextIcon size={16} /> PDF Papers
          </button>
        </div>

        {/* Tab Content */}
                 {activeTab === 'json' && (
           <div className="tab-content">
             <h2>Upload AI Model Data to fullExamPapers Collection</h2>
             <form onSubmit={handleJsonUpload}>
               <div className="form-row">
                 <label>JSON Data *</label>
                 <textarea
                   value={jsonForm.jsonData}
                   onChange={(e) => setJsonForm(prev => ({ ...prev, jsonData: e.target.value }))}
                   placeholder="Paste your AI model exam paper data here..."
                   rows="15"
                   required
                 />
               </div>
               <div className="form-group upload-button-group">
                 <button 
                   type="submit" 
                   className="btn btn-primary upload-btn" 
                   disabled={loading || !isJsonFormValid()}
                 >
                   <Upload size={16} />
                   {loading ? 'Uploading...' : 'Upload to fullExamPapers'}
                 </button>
               </div>
             </form>
            {/* Saved JSON Entries */}
            <div className="papers-section" style={{ marginTop: '24px' }}>
              <div className="papers-header">
                <h3>Full Exam Papers ({jsonEntries.length})</h3>
                {jsonEntries.length > 0 && (
                  <button
                    onClick={deleteAllJsonEntries}
                    disabled={isDeletingAll}
                    className="btn btn-danger"
                    style={{ marginLeft: '16px' }}
                    title="Delete all exam paper data"
                  >
                    {isDeletingAll ? 'Deleting...' : '🗑️ Delete All'}
                  </button>
                )}
              </div>

              {jsonEntries.length === 0 ? (
                <div className="no-papers">
                  <FileText size={48} />
                  <p>No JSON entries found. Upload JSON above to get started.</p>
                </div>
              ) : (
                <div className="papers-table-container">
                  <table className="papers-table">
                    <thead>
                      <tr>
                        <th>Exam Paper</th>
                        <th>Board</th>
                        <th>Session</th>
                        <th>Tier</th>
                        <th>Paper</th>
                        <th>Code</th>
                        <th>Questions</th>
                        <th>Size</th>
                        <th>Uploaded</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jsonEntries.map((entry) => {
                        // Handle both data structures: entry.exam vs entry.data.exam
                        const examData = entry.data || entry;
                        const examMeta = examData.exam || {};
                        // Use database fields for question counts
                        const questionCount = examMeta.totalQuestions || (examData.questions ? examData.questions.length : 0);
                        const subQuestionCount = examMeta.questionsWithSubQuestions || (examData.questions ? 
                          examData.questions.reduce((total, q) => total + (q.subQuestions ? q.subQuestions.length : 0), 0) : 0);
                        
                        return (
                        <React.Fragment key={entry.id}>
                          <tr className="paper-row">
                            <td className="file-cell">
                              <div
                                className="file-info clickable"
                                onClick={() => setExpandedJsonId(expandedJsonId === entry.id ? null : entry.id)}
                                title="Click to view exam content"
                              >
                                <FileText size={20} />
                                <span className="filename">
                                  {examMeta.board || examMeta.boar ? 
                                    `${examMeta.board || examMeta.boar || ''} ${examMeta.session || ''} ${examMeta.tier || examMeta.level || ''} ${examMeta.paper || ''} ${examMeta.code || ''}`.replace(/\s+/g, ' ').trim() :
                                    examData.originalName || examData.filename || entry.id
                                  }
                                </span>
                                <span className="expand-icon">{expandedJsonId === entry.id ? '▼' : '▶'}</span>
                              </div>
                            </td>
                            <td>{examMeta.board || examMeta.boar || 'N/A'}</td>
                            <td>{examMeta.session || 'N/A'}</td>
                            <td>{examMeta.tier || examMeta.level || 'N/A'}</td>
                            <td>{examMeta.paper || 'N/A'}</td>
                            <td>{examMeta.code || 'N/A'}</td>
                            <td>
                              {questionCount ? (
                                <span className="question-count">
                                  {questionCount} Q{subQuestionCount ? ` (${subQuestionCount} sub)` : ''}
                                </span>
                              ) : (
                                <span className="no-questions">No questions</span>
                              )}
                            </td>
                            <td>{formatFileSize(entry.size || 0)}</td>
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
                                      examMeta.board || examMeta.boar ? 
                                        `${examMeta.board || examMeta.boar || ''} ${examMeta.session || ''} ${examMeta.tier || examMeta.level || ''} ${examMeta.paper || ''} ${examMeta.code || ''}`.replace(/\s+/g, ' ').trim() :
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
                                          <strong>Total Questions:</strong> {questionCount}
                                        </span>
                                        <span className="summary-item">
                                          <strong>Sub-questions:</strong> {subQuestionCount}
                                        </span>
                                        <span className="summary-item">
                                          <strong>Total Marks:</strong> {examData.questions.reduce((total, q) => {
                                            const questionMarks = q.marks || 0;
                                            const subQuestionMarks = q.subQuestions ? q.subQuestions.reduce((subTotal, subQ) => subTotal + (subQ.marks || 0), 0) : 0;
                                            return total + questionMarks + subQuestionMarks;
                                          }, 0)}
                                        </span>
                                      </div>
                                      
                                      <div className="questions-list">
                                        {examData.questions.map((question, qIndex) => (
                                          <div key={qIndex} className="question-item">
                                            <div className="question-header">
                                              <span className="question-number">Question {question.number || question.questionNumber || (qIndex + 1)}</span>
                                              {question.marks && (
                                                <span className="question-marks">[{question.marks} marks]</span>
                                              )}
                                            </div>
                                            <div className="question-text">{question.text}</div>
                                            
                                            {question.subQuestions && question.subQuestions.length > 0 && (
                                              <div className="sub-questions">
                                                {question.subQuestions.map((subQ, sIndex) => (
                                                  <div key={sIndex} className="sub-question-item">
                                                    <div className="sub-question-header">
                                                      <span className="sub-question-number">({subQ.part || subQ.subQuestionNumber || String.fromCharCode(97 + sIndex)})</span>
                                                      {subQ.marks && (
                                                        <span className="sub-question-marks">[{subQ.marks} marks]</span>
                                                      )}
                                                    </div>
                                                    <div className="sub-question-text">{subQ.text}</div>
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

        {activeTab === 'pdf' && (
          <>
            {/* Upload Form */}
            <div className="upload-form">
              <h2>Upload Past Paper</h2>
              <form onSubmit={handleFileUpload}>
                {/* First row: Exam Board, Year, Level, Paper */}
                <div className="form-row compact">
                  <div className="form-group">
                    <label>Exam Board *</label>
                    <input
                      type="text"
                      value={uploadForm.examBoard}
                      onChange={(e) => handleInputChange('examBoard', e.target.value)}
                      placeholder="AQA, Edexcel, OCR"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Year *</label>
                    <input
                      type="number"
                      value={uploadForm.year}
                      onChange={(e) => handleInputChange('year', e.target.value)}
                      placeholder="2024"
                      min="1900"
                      max="2100"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Level *</label>
                    <input
                      type="text"
                      value={uploadForm.level}
                      onChange={(e) => handleInputChange('level', e.target.value)}
                      placeholder="Higher, Foundation, AS, A2"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Paper *</label>
                    <input
                      type="text"
                      value={uploadForm.paper}
                      onChange={(e) => handleInputChange('paper', e.target.value)}
                      placeholder="83001H, 1, 2, 3"
                      required
                    />
                  </div>
                </div>
                
                {/* Second row: Type, Qualification, PDF File, Upload Button */}
                <div className="form-row compact">
                  <div className="form-group">
                    <label>Type *</label>
                    <select
                      value={uploadForm.type}
                      onChange={(e) => handleInputChange('type', e.target.value)}
                      required
                    >
                      <option value="Question Paper">Question Paper</option>
                      <option value="Mark Scheme">Mark Scheme</option>
                      <option value="Specimen">Specimen</option>
                      <option value="Practice">Practice</option>
                      <option value="Foundation">Foundation</option>
                      <option value="Higher">Higher</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Qualification</label>
                    <select
                      value={uploadForm.qualification}
                      onChange={(e) => handleInputChange('qualification', e.target.value)}
                    >
                      <option value="GCSE">GCSE</option>
                      <option value="A-Level">A-Level</option>
                      <option value="AS-Level">AS-Level</option>
                      <option value="IB">IB</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>PDF File *</label>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileSelect}
                      required
                    />

                  </div>
                  <div className="form-group upload-button-group">
                    <label>Upload</label>
                    <button 
                      type="submit" 
                      className="btn btn-primary upload-btn" 
                      disabled={loading || !isFormValid()}
                    >
                      <Upload size={16} />
                      {loading ? 'Uploading...' : 'Upload Paper'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Past Papers List */}
            <div className="papers-section">
              <div className="papers-header">
                <h3>Past Papers ({pastPapers.length})</h3>
                {pastPapers.length > 0 ? (
                  <button
                    className="btn-clear-all"
                    onClick={handleClearAll}
                    disabled={loading}
                    title="Clear all past papers from database and local system"
                  >
                    <Trash2 size={16} />
                    Clear All
                  </button>
                ) : (
                  <div className="no-papers-message">
                    No papers to clear
                  </div>
                )}
              </div>
              
              {pastPapers.length === 0 ? (
                <div className="no-papers">
                  <FileText size={48} />
                  <p>No past papers found. Upload your first paper above!</p>
                </div>
              ) : (
                <div className="papers-table-container">
                  <table className="papers-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Exam Board</th>
                        <th>Year</th>
                        <th>Level</th>
                        <th>Paper</th>
                        <th>Type</th>
                        <th>Qualification</th>
                        <th>Questions</th>
                        <th>File Size</th>
                        <th>Uploaded</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pastPapers.map(paper => (
                        <React.Fragment key={paper.id}>
                          <tr className="paper-row">
                            <td className="file-cell">
                              <div 
                                className="file-info clickable"
                                onClick={() => togglePaperExpansion(paper.id)}
                                title="Click to view exam content"
                              >
                                <FileText size={20} />
                                <span className="filename">{paper.originalName}</span>
                                <span className="expand-icon">
                                  {expandedPaper === paper.id ? '▼' : '▶'}
                                </span>
                              </div>
                            </td>
                            <td>{paper.examBoard}</td>
                            <td>{paper.year}</td>
                            <td>{paper.level}</td>
                            <td>{paper.paper}</td>
                            <td>{paper.type}</td>
                            <td>{paper.qualification}</td>
                            <td>
                              {paper.questionCount ? (
                                <span className="question-count">
                                  {paper.questionCount} Q{paper.subQuestionCount ? ` (${paper.subQuestionCount} sub)` : ''}
                                </span>
                              ) : (
                                <span className="no-questions">No questions</span>
                              )}
                            </td>
                            <td>{formatFileSize(paper.fileSize)}</td>
                            <td>{formatDate(paper.uploadedAt)}</td>
                            <td className="actions-cell">
                              <button
                                className="btn-icon"
                                onClick={() => setEditingPaper(editingPaper === paper.id ? null : paper.id)}
                                title="Edit"
                              >
                                <Edit size={16} />
                              </button>
                              {!paper.questionCount && (
                                <button
                                  className="btn-icon"
                                  onClick={() => handleExtractQuestions(paper.id)}
                                  title="Extract Questions"
                                  disabled={loading}
                                >
                                  <FileText size={16} />
                                </button>
                              )}
                              <button
                                className="btn-icon"
                                onClick={() => handleDelete(paper.id)}
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                          
                          {/* Expanded Content Panel */}
                          {expandedPaper === paper.id && (
                            <tr className="expanded-content-row">
                              <td colSpan="11">
                                <div className="expanded-content">
                                                          <div className="content-header">
                                  <h4>Exam Paper Content: {paper.originalName}</h4>
                                  <div className="content-info">
                                    <span className="info-text">Questions are displayed in numerical order</span>
                                    <button 
                                      className="btn-icon close-btn"
                                      onClick={() => togglePaperExpansion(paper.id)}
                                      title="Close"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                                  
                                  {paper.questions && paper.questions.length > 0 ? (
                                    <div className="questions-content">
                                      <div className="questions-summary">
                                        <span className="summary-item">
                                          <strong>Total Questions:</strong> {paper.questionCount || paper.questions.length}
                                        </span>
                                        <span className="summary-item">
                                          <strong>Sub-questions:</strong> {paper.subQuestionCount || paper.questions.reduce((total, q) => total + (q.subQuestions ? q.subQuestions.length : 0), 0)}
                                        </span>
                                        <span className="summary-item">
                                          <strong>Total Marks:</strong> {paper.questions.reduce((total, q) => {
                                            const questionMarks = q.marks || 0;
                                            const subQuestionMarks = q.subQuestions ? q.subQuestions.reduce((subTotal, subQ) => subTotal + (subQ.marks || 0), 0) : 0;
                                            return total + questionMarks + subQuestionMarks;
                                          }, 0)}
                                        </span>
                                      </div>
                                      
                                      <div className="questions-list">
                                        {paper.questions.map((question, qIndex) => (
                                          <div key={qIndex} className="question-item">
                                            <div className="question-header">
                                              <span className="question-number">Question {question.questionNumber}</span>
                                              {question.marks && (
                                                <span className="question-marks">[{question.marks} marks]</span>
                                              )}
                                            </div>
                                            <div className="question-text">{question.text}</div>
                                            
                                            {question.subQuestions && question.subQuestions.length > 0 && (
                                              <div className="sub-questions">
                                                {question.subQuestions.map((subQ, sIndex) => (
                                                  <div key={sIndex} className="sub-question-item">
                                                    <div className="sub-question-header">
                                                      <span className="sub-question-number">({subQ.subQuestionNumber})</span>
                                                      {subQ.marks && (
                                                        <span className="sub-question-marks">[{subQ.marks} marks]</span>
                                                      )}
                                                    </div>
                                                    <div className="sub-question-text">{subQ.text}</div>
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
                                      <p>No questions have been extracted from this paper yet.</p>
                                      <button 
                                        className="btn btn-primary"
                                        onClick={() => handleExtractQuestions(paper.id)}
                                        disabled={loading}
                                      >
                                        {loading ? 'Extracting...' : 'Extract Questions'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                  
                  {/* Edit Form Overlay */}
                  {editingPaper && (
                    <EditPaperForm
                      paper={pastPapers.find(p => p.id === editingPaper)}
                      onUpdate={handleUpdate}
                      onCancel={() => setEditingPaper(null)}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Utility functions
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (dateString) => {
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return 'Invalid Date';
  }
};

// Edit Paper Form Component
function EditPaperForm({ paper, onUpdate, onCancel }) {
  const [formData, setFormData] = useState({
    examBoard: paper?.examBoard || '',
    year: paper?.year || '',
    level: paper?.level || '',
    paper: paper?.paper || '',
    type: paper?.type || 'Question Paper',
    qualification: paper?.qualification || 'GCSE'
  });
  
  const handleSubmit = (e) => {
    e.preventDefault();
    onUpdate(paper.id, formData);
  };
  
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  if (!paper) return null;
  
  return (
    <div className="edit-form-overlay">
      <div className="edit-form">
        <h4>Edit Past Paper</h4>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <input
              name="examBoard"
              value={formData.examBoard}
              onChange={(e) => handleInputChange('examBoard', e.target.value)}
              placeholder="Exam Board"
              required
            />
            <input
              name="year"
              type="number"
              value={formData.year}
              onChange={(e) => handleInputChange('year', e.target.value)}
              placeholder="Year"
              required
            />
          </div>
          <div className="form-row">
            <input
              name="level"
              value={formData.level}
              onChange={(e) => handleInputChange('level', e.target.value)}
              placeholder="Level"
              required
            />
            <input
              name="paper"
              value={formData.paper}
              onChange={(e) => handleInputChange('paper', e.target.value)}
              placeholder="Paper Code"
              required
            />
          </div>
          <div className="form-row">
            <select 
              name="type" 
              value={formData.type}
              onChange={(e) => handleInputChange('type', e.target.value)}
            >
              <option value="Question Paper">Question Paper</option>
              <option value="Mark Scheme">Mark Scheme</option>
              <option value="Specimen">Specimen</option>
              <option value="Practice">Practice</option>
              <option value="Foundation">Foundation</option>
              <option value="Higher">Higher</option>
            </select>
            <select 
              name="qualification" 
              value={formData.qualification}
              onChange={(e) => handleInputChange('qualification', e.target.value)}
            >
              <option value="GCSE">GCSE</option>
              <option value="A-Level">A-Level</option>
              <option value="AS-Level">AS-Level</option>
              <option value="IB">IB</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="edit-actions">
            <button type="submit" className="btn btn-primary">Save</button>
            <button 
              type="button" 
              className="btn btn-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AdminPage;

