import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Upload, 
  FileText, 
  Trash2, 
  Edit, 
  Download, 
  Plus,
  EyeOff,
  ArrowLeft
} from 'lucide-react';
import './AdminPage.css';

/**
 * AdminPage component for managing past paper PDFs
 * @returns {JSX.Element} The admin page component
 */
function AdminPage() {
  const navigate = useNavigate();
  const [pastPapers, setPastPapers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Upload form state - simplified to 4 fields
  const [uploadForm, setUploadForm] = useState({
    examBoard: '',
    year: '',
    level: '',
    paper: '',
    type: 'Question Paper',
    qualification: 'GCSE',
    pdfFile: null
  });
  

  
  // Edit state
  const [editingPaper, setEditingPaper] = useState(null);
  const [showUploadForm, setShowUploadForm] = useState(true);
  
  // API base URL for development vs production
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';

  /**
   * Load all past papers
   */
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const papersRes = await fetch(`${API_BASE}/api/admin/past-papers`);

      if (papersRes.ok) {
        const papers = await papersRes.json();
        setPastPapers(papers);
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
    
    if (!uploadForm.pdfFile || !uploadForm.examBoard || !uploadForm.year || !uploadForm.level || !uploadForm.paper) {
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
        setUploadForm({
          examBoard: '',
          year: '',
          level: '',
          paper: '',
          type: 'Question Paper',
          qualification: 'GCSE',
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
   * Extract exam information from filename
   * Supports multiple formats:
   * 1. [ExamBoard]-[Year]-[Level]-[Type].pdf (e.g., AQA-2024-Higher-Main.pdf)
   * 2. [ExamBoard]-[PaperCode]-[Type]-[MonthYear].pdf (e.g., AQA-83001H-QP-JUN24.PDF)
   * 3. [ExamBoard]-[PaperCode]-[Type]-[Year].pdf (e.g., Edexcel-1H-QP-2024.pdf)
   */
  const extractExamInfo = (filename) => {
    console.log('Extracting info from filename:', filename); // Debug log
    
    // Remove .pdf extension
    const nameWithoutExt = filename.replace(/\.pdf$/i, '');
    console.log('Name without extension:', nameWithoutExt); // Debug log
    
    // Split by common separators: dash, underscore, or space
    const parts = nameWithoutExt.split(/[-_\s]+/);
    console.log('Split parts:', parts); // Debug log
    
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
        
        console.log('Format 1 detected:', { examBoard, year: yearNum, level, type }); // Debug log
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
        
        // Map type abbreviations
        let mappedType = type;
        if (type === 'QP') mappedType = 'Question Paper';
        else if (type === 'MS') mappedType = 'Mark Scheme';
        else if (type === 'SP') mappedType = 'Specimen';
        
        console.log('Format 2 detected:', { examBoard, year, level, paper: paperCode, type: mappedType, qualification: 'GCSE' }); // Debug log
        
        if (year) {
          return { examBoard, year, level, paper: paperCode, type: mappedType, qualification: 'GCSE' };
        }
      }
    }
    
    // Enhanced fallback: try to extract year from anywhere in filename
    const yearMatch = filename.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      console.log('Year extracted from fallback:', year); // Debug log
      
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
    
    console.log('No information could be extracted'); // Debug log
    return null;
  };

  /**
   * Handle file selection with automatic info extraction
   */
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      console.log('File selected:', file.name); // Debug log
      
      setUploadForm(prev => ({ ...prev, pdfFile: file }));
      
      // Try to extract exam information from filename
      const extractedInfo = extractExamInfo(file.name);
      console.log('Extracted info:', extractedInfo); // Debug log
      
      if (extractedInfo) {
        console.log('Setting form with extracted info:', extractedInfo); // Debug log
        
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
          console.log('New form state:', newForm); // Debug log
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
        console.log('No info could be extracted from filename'); // Debug log
      }
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

  // Show all papers since filters were removed
  const filteredPapers = pastPapers;

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
          {showUploadForm ? <EyeOff size={16} /> : <Plus size={16} />}
          {showUploadForm ? 'Hide Upload Form' : 'Show Upload Form'}
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
          <h2>Upload Past Paper</h2>

          <form onSubmit={handleFileUpload}>
            <div className="form-row compact">
              <div className="form-group">
                <label>Exam Board *</label>
                <input
                  type="text"
                  value={uploadForm.examBoard}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, examBoard: e.target.value }))}
                  placeholder="AQA, Edexcel, OCR"
                  required
                />
              </div>
              <div className="form-group">
                <label>Year *</label>
                <input
                  type="number"
                  value={uploadForm.year}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, year: e.target.value }))}
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
                  onChange={(e) => setUploadForm(prev => ({ ...prev, level: e.target.value }))}
                  placeholder="Higher, Foundation, AS, A2"
                  required
                />
              </div>
              <div className="form-group">
                <label>Paper *</label>
                <input
                  type="text"
                  value={uploadForm.paper}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, paper: e.target.value }))}
                  placeholder="83001H, 1, 2, 3"
                  required
                />
              </div>
            </div>
            
            <div className="form-row compact">
              <div className="form-group">
                <label>Type *</label>
                <select
                  value={uploadForm.type}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, type: e.target.value }))}
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
                  onChange={(e) => setUploadForm(prev => ({ ...prev, qualification: e.target.value }))}
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
                <button type="submit" className="btn btn-primary upload-btn" disabled={loading}>
                  <Upload size={16} />
                  {loading ? 'Uploading...' : 'Upload Paper'}
                </button>
              </div>
            </div>
            



          </form>
        </div>
      )}



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
                  <h4>{paper.level} - {paper.paper}</h4>
                  <p className="paper-meta">
                    <span className="exam-board">{paper.examBoard}</span>
                    <span className="year">{paper.year}</span>
                    <span className="paper-type">{paper.type}</span>
                    <span className="qualification">{paper.qualification}</span>
                  </p>
                  
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
                        level: formData.get('level'),
                        paper: formData.get('paper'),
                        type: formData.get('type'),
                        qualification: formData.get('qualification')
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
                          name="level"
                          defaultValue={paper.level}
                          placeholder="Level"
                          required
                        />
                        <input
                          name="paper"
                          defaultValue={paper.paper}
                          placeholder="Paper Code"
                          required
                        />
                      </div>
                      <div className="form-row">
                        <select name="type" defaultValue={paper.type}>
                          <option value="Question Paper">Question Paper</option>
                          <option value="Mark Scheme">Mark Scheme</option>
                          <option value="Specimen">Specimen</option>
                          <option value="Practice">Practice</option>
                          <option value="Foundation">Foundation</option>
                          <option value="Higher">Higher</option>
                        </select>
                        <select name="qualification" defaultValue={paper.qualification}>
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

