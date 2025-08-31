import React, { useState, useRef } from 'react';
import { Upload, FileText, Loader2, XCircle, BookOpen } from 'lucide-react';
import './MarkHomeworkPage.css';

/**
 * Mark Homework Page Component
 * Handles image upload, processing, and displaying results
 */
function MarkHomeworkPage() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // API base URL
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';

  // Available AI models
  const aiModels = [
    { id: 'chatgpt-4o', name: 'ChatGPT 4o', description: 'Balanced performance and accuracy' },
    { id: 'chatgpt-5', name: 'ChatGPT 5', description: 'Latest model with enhanced capabilities' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google\'s advanced AI model' }
  ];

  /**
   * Handle file selection
   */
  const handleFileSelect = (file) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImage({
          file,
          dataUrl: e.target.result,
          name: file.name
        });
        setError(null);
        setResults(null);
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please select a valid image file');
    }
  };

  /**
   * Handle drag and drop events
   */
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  /**
   * Handle drop event
   */
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  /**
   * Process the uploaded image
   */
  const processImage = async () => {
    if (!selectedImage) return;

    setIsProcessing(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch(`${API_BASE}/api/mark-homework/mark-homework`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: selectedImage.dataUrl,
          model: selectedModel
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResults(data);
      } else {
        setError(data.error || 'Failed to process image');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Clear all data
   */
  const clearAll = () => {
    setSelectedImage(null);
    setResults(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Download results as JSON
   */
  const downloadResults = () => {
    if (!results) return;
    
    const dataStr = JSON.stringify(results, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mark-homework-results.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mark-homework-page">
      <div className="page-header">
        <div className="header-content">
          <BookOpen size={32} className="header-icon" />
          <div>
            <h1>Mark Homework</h1>
            <p>AI-powered homework marking and analysis</p>
          </div>
        </div>
      </div>

      <div className="page-content">
        {/* Model Selection */}
        <div className="model-selection">
          <h3>Select AI Model</h3>
          <div className="model-options">
            {aiModels.map((model) => (
              <label key={model.id} className="model-option">
                <input
                  type="radio"
                  name="model"
                  value={model.id}
                  checked={selectedModel === model.id}
                  onChange={(e) => setSelectedModel(e.target.value)}
                />
                <div className="model-info">
                  <div className="model-name">{model.name}</div>
                  <div className="model-description">{model.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Image Upload Section */}
        <div className="upload-section">
          <h3>Upload Homework Image</h3>
          
          {!selectedImage ? (
            <div
              className={`upload-area ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={48} className="upload-icon" />
              <p>Drag and drop an image here, or click to browse</p>
              <p className="upload-hint">Supports: JPG, PNG, GIF (Max: 10MB)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files[0] && handleFileSelect(e.target.files[0])}
                style={{ display: 'none' }}
              />
            </div>
          ) : (
            <div className="image-preview">
              <div className="preview-header">
                <h4>Selected Image: {selectedImage.name}</h4>
                <button onClick={clearAll} className="clear-btn">
                  <XCircle size={16} />
                  Clear
                </button>
              </div>
              <img 
                src={selectedImage.dataUrl} 
                alt="Homework preview" 
                className="preview-image"
              />
              <div className="preview-actions">
                <button 
                  onClick={processImage}
                  disabled={isProcessing}
                  className="process-btn"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={16} className="spinner" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <FileText size={16} />
                      Mark Homework
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-message">
            <XCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Results Display */}
        {results && (
          <div className="results-section">
            <div className="results-header">
              <h3>Marking Results</h3>
              <button onClick={downloadResults} className="download-btn">
                Download Results
              </button>
            </div>
            
            <div className="results-content">
              <div className="result-item">
                <h4>OCR Text</h4>
                <div className="ocr-text">
                  {results.result?.ocrText || 'No text extracted'}
                </div>
              </div>

              <div className="result-item">
                <h4>Confidence Score</h4>
                <div className="confidence-score">
                  {results.result?.confidence ? 
                    `${(results.result.confidence * 100).toFixed(1)}%` : 
                    'N/A'
                  }
                </div>
              </div>

              <div className="result-item">
                <h4>Image Dimensions</h4>
                <div className="dimensions">
                  {results.result?.imageDimensions ? 
                    `${results.result.imageDimensions.width} × ${results.result.imageDimensions.height} pixels` : 
                    'N/A'
                  }
                </div>
              </div>

              <div className="result-item">
                <h4>Bounding Boxes</h4>
                <div className="bounding-boxes">
                  {results.result?.boundingBoxes?.length > 0 ? 
                    `${results.result.boundingBoxes.length} text regions detected` : 
                    'No text regions detected'
                  }
                </div>
              </div>

              {results.annotatedImage && (
                <div className="result-item">
                  <h4>Annotated Image</h4>
                  <div className="annotated-image">
                    <div 
                      className="svg-overlay"
                      dangerouslySetInnerHTML={{ __html: results.annotatedImage }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MarkHomeworkPage;
