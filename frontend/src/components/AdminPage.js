import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Upload, 
  FileText, 
  Trash2, 
  Edit, 
  Download, 
  Search,
  Filter,
  Plus,
  ArrowLeft,
  Calendar,
  BookOpen
} from 'lucide-react';
import './AdminPage.css';

/**
 * AdminPage component for managing past paper PDFs
 * @returns {JSX.Element} The admin page component
 */
function AdminPage() {
  const navigate = useNavigate();
  const [pastPapers, setPastPapers] = useState([]);
  const [examBoards, setExamBoards] = useState([]);
  const [years, setYears] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    examBoard: '',
    year: '',
    subject: '',
    paperType: 'Main',
    description: '',
    pdfFile: null
  });
  
  // Filter state
  const [filters, setFilters] = useState({
    examBoard: '',
    year: '',
    subject: '',
    searchTerm: ''
  });
  
  // Edit state
  const [editingPaper, setEditingPaper] = useState(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  
  // API base URL for development vs production
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';

  /**
   * Load all past papers and metadata
   */
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [papersRes, boardsRes, yearsRes, subjectsRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/past-papers`),
        fetch(`${API_BASE}/api/admin/exam-boards`),
        fetch(`${API_BASE}/api/admin/years`),
        fetch(`${API_BASE}/api/admin/subjects`)
      ]);

      if (papersRes.ok) {
        const papers = await papersRes.json();
        setPastPapers(papers);
      }
      
      if (boardsRes.ok) {
        const boards = await boardsRes.json();
        setExamBoards(boards);
      }
      
      if (yearsRes.ok) {
        const yearsData = await yearsRes.json();
        setYears(yearsData);
      }
      
      if (subjectsRes.ok) {
        const subjectsData = await subjectsRes.json();
        setSubjects(subjectsData);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle file upload
   */
  const handleFileUpload = async (e) => {
    e.preventDefault();
    
    if (!uploadForm.pdfFile || !uploadForm.examBoard || !uploadForm.year || !uploadForm.subject) {
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
      formData.append('subject', uploadForm.subject);
      formData.append('paperType', uploadForm.paperType);
      formData.append('description', uploadForm.description);

      const response = await fetch(`${API_BASE}/api/admin/past-papers/upload`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setPastPapers(prev => [result.pastPaper, ...prev]);
        setUploadForm({
          examBoard: '',
          year: '',
          subject: '',
          paperType: 'Main',
          description: '',
          pdfFile: null
        });
        setShowUploadForm(false);
        setError(null);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError('Upload failed');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle file selection
   */
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setUploadForm(prev => ({ ...prev, pdfFile: file }));
    } else {
      setError('Please select a valid PDF file');
    }
  };

  /**
   * Delete a past paper
   */
  const handleDelete = async (id) => {
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
        setError('Failed to delete past paper');
      }
    } catch (error) {
      console.error('Delete error:', error);
      setError('Failed to delete past paper');
    }
  };

  /**
   * Update past paper metadata
   */
  const handleUpdate = async (id, updatedData) => {
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
        setError('Failed to update past paper');
      }
    } catch (error) {
      console.error('Update error:', error);
      setError('Failed to update past paper');
    }
  };

  /**
   * Download a past paper
   */
  const handleDownload = async (id) => {
    try {
      window.open(`${API_BASE}/api/admin/past-papers/${id}/download`, '_blank');
    } catch (error) {
      console.error('Download error:', error);
      setError('Failed to download past paper');
    }
  };

  /**
   * Filter past papers based on current filters
   */
  const filteredPapers = pastPapers.filter(paper => {
    if (filters.examBoard && paper.examBoard !== filters.examBoard) return false;
    if (filters.year && paper.year !== filters.year) return false;
    if (filters.subject && paper.subject !== filters.subject) return false;
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      return (
        paper.subject.toLowerCase().includes(searchLower) ||
        paper.examBoard.toLowerCase().includes(searchLower) ||
        paper.description.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  // Load data on component mount
  useEffect(() => {
    loadData();
  }, []);

  /**
   * Format file size for display
   */
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  /**
   * Format date for display
   */
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading && pastPapers.length === 0) {
    return (
      <div className="admin-page">
        <div className="loading">Loading admin panel...</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="header-left">
          <button 
            className="btn btn-secondary"
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={16} />
            Back to Chat
          </button>
          <h1>Admin Dashboard - Past Papers Management</h1>
        </div>
        <button 
          className="btn btn-primary"
          onClick={() => setShowUploadForm(!showUploadForm)}
        >
          <Plus size={16} />
          {showUploadForm ? 'Cancel Upload' : 'Upload New Paper'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Upload Form */}
      {showUploadForm && (
        <div className="upload-form">
          <h2>Upload New Past Paper</h2>
          <form onSubmit={handleFileUpload}>
            <div className="form-row">
              <div className="form-group">
                <label>Exam Board *</label>
                <input
                  type="text"
                  value={uploadForm.examBoard}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, examBoard: e.target.value }))}
                  placeholder="e.g., AQA, Edexcel, OCR"
                  required
                />
              </div>
              <div className="form-group">
                <label>Year *</label>
                <input
                  type="number"
                  value={uploadForm.year}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, year: e.target.value }))}
                  placeholder="e.g., 2024"
                  min="2000"
                  max="2030"
                  required
                />
              </div>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Subject *</label>
                <input
                  type="text"
                  value={uploadForm.subject}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, subject: e.target.value }))}
                  placeholder="e.g., Mathematics, Physics, Chemistry"
                  required
                />
              </div>
              <div className="form-group">
                <label>Paper Type</label>
                <select
                  value={uploadForm.paperType}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, paperType: e.target.value }))}
                >
                  <option value="Main">Main</option>
                  <option value="Foundation">Foundation</option>
                  <option value="Higher">Higher</option>
                  <option value="Mark Scheme">Mark Scheme</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={uploadForm.description}
                onChange={(e) => setUploadForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description of the paper"
                rows="3"
              />
            </div>

            <div className="form-group">
              <label>PDF File *</label>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                required
              />
              <small>Maximum file size: 50MB. Only PDF files allowed.</small>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                <Upload size={16} />
                {loading ? 'Uploading...' : 'Upload Paper'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="filters-section">
        <h3>Filters</h3>
        <div className="filters">
          <div className="filter-group">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search papers..."
              value={filters.searchTerm}
              onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
            />
          </div>
          
          <div className="filter-group">
            <Filter size={16} />
            <select
              value={filters.examBoard}
              onChange={(e) => setFilters(prev => ({ ...prev, examBoard: e.target.value }))}
            >
              <option value="">All Exam Boards</option>
              {examBoards.map(board => (
                <option key={board} value={board}>{board}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <Calendar size={16} />
            <select
              value={filters.year}
              onChange={(e) => setFilters(prev => ({ ...prev, year: e.target.value }))}
            >
              <option value="">All Years</option>
              {years.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <BookOpen size={16} />
            <select
              value={filters.subject}
              onChange={(e) => setFilters(prev => ({ ...prev, subject: e.target.value }))}
            >
              <option value="">All Subjects</option>
              {subjects.map(subject => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Past Papers List */}
      <div className="papers-section">
        <h3>Past Papers ({filteredPapers.length})</h3>
        
        {filteredPapers.length === 0 ? (
          <div className="no-papers">
            <FileText size={48} />
            <p>No past papers found. {showUploadForm ? 'Upload your first paper above!' : 'Click "Upload New Paper" to get started.'}</p>
          </div>
        ) : (
          <div className="papers-grid">
            {filteredPapers.map(paper => (
              <div key={paper.id} className="paper-card">
                <div className="paper-header">
                  <div className="paper-icon">
                    <FileText size={24} />
                  </div>
                  <div className="paper-actions">
                    <button
                      className="btn-icon"
                      onClick={() => setEditingPaper(editingPaper === paper.id ? null : paper.id)}
                      title="Edit"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => handleDelete(paper.id)}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="paper-content">
                  <h4>{paper.subject}</h4>
                  <p className="paper-meta">
                    <span className="exam-board">{paper.examBoard}</span>
                    <span className="year">{paper.year}</span>
                    <span className="paper-type">{paper.paperType}</span>
                  </p>
                  
                  {paper.description && (
                    <p className="description">{paper.description}</p>
                  )}
                  
                  <div className="paper-details">
                    <span className="file-size">{formatFileSize(paper.fileSize)}</span>
                    <span className="upload-date">{formatDate(paper.uploadedAt)}</span>
                    <span className="downloads">{paper.downloadCount} downloads</span>
                  </div>
                </div>

                <div className="paper-footer">
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleDownload(paper.id)}
                  >
                    <Download size={16} />
                    Download
                  </button>
                </div>

                {/* Edit Form */}
                {editingPaper === paper.id && (
                  <div className="edit-form">
                    <h5>Edit Paper Details</h5>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.target);
                      handleUpdate(paper.id, {
                        examBoard: formData.get('examBoard'),
                        year: formData.get('year'),
                        subject: formData.get('subject'),
                        paperType: formData.get('paperType'),
                        description: formData.get('description')
                      });
                    }}>
                      <div className="form-row">
                        <input
                          name="examBoard"
                          defaultValue={paper.examBoard}
                          placeholder="Exam Board"
                          required
                        />
                        <input
                          name="year"
                          type="number"
                          defaultValue={paper.year}
                          placeholder="Year"
                          required
                        />
                      </div>
                      <div className="form-row">
                        <input
                          name="subject"
                          defaultValue={paper.subject}
                          placeholder="Subject"
                          required
                        />
                        <select name="paperType" defaultValue={paper.paperType}>
                          <option value="Main">Main</option>
                          <option value="Foundation">Foundation</option>
                          <option value="Higher">Higher</option>
                          <option value="Mark Scheme">Mark Scheme</option>
                        </select>
                      </div>
                      <textarea
                        name="description"
                        defaultValue={paper.description}
                        placeholder="Description"
                        rows="2"
                      />
                      <div className="edit-actions">
                        <button type="submit" className="btn btn-primary">Save</button>
                        <button 
                          type="button" 
                          className="btn btn-secondary"
                          onClick={() => setEditingPaper(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPage;
