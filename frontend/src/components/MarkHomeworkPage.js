import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import './MarkHomeworkPage.css';

const MarkHomeworkPage = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const fileInputRef = useRef(null);

  const models = [
    { id: 'chatgpt-4o', name: 'ChatGPT-4o', description: 'Latest OpenAI model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google\'s advanced model' },
    { id: 'chatgpt-5', name: 'ChatGPT-5', description: 'Next generation AI' }
  ];

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setError(null);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please select a valid image file');
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setError(null);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please drop a valid image file');
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const processHomework = async () => {
    if (!selectedFile) {
      setError('Please select an image first');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('imageData', previewUrl);
      formData.append('model', selectedModel);

      const response = await fetch('/api/mark-homework/mark-homework', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: previewUrl,
          model: selectedModel
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to process homework');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="mark-homework-page">
      <div className="mark-homework-header">
        <h1>Mark Homework</h1>
        <p>Upload an image of homework to get AI-powered marking and feedback</p>
      </div>

      <div className="mark-homework-content">
        <div className="upload-section">
          <div className="model-selector">
            <label htmlFor="model-select">AI Model:</label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="model-dropdown"
            >
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`upload-area ${previewUrl ? 'has-preview' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            
            {!previewUrl ? (
              <div className="upload-placeholder">
                <Upload className="upload-icon" />
                <h3>Upload Homework Image</h3>
                <p>Drag and drop an image here, or click to browse</p>
                <span className="upload-hint">Supports JPG, PNG, GIF</span>
              </div>
            ) : (
              <div className="preview-container">
                <img src={previewUrl} alt="Homework preview" className="preview-image" />
                <div className="preview-overlay">
                  <button className="change-image-btn" onClick={(e) => {
                    e.stopPropagation();
                    resetForm();
                  }}>
                    Change Image
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="error-message">
              <AlertCircle className="error-icon" />
              <span>{error}</span>
            </div>
          )}

          <div className="action-buttons">
            <button
              className="process-btn"
              onClick={processHomework}
              disabled={!selectedFile || isProcessing}
            >
              {isProcessing ? (
                <>
                  <div className="loading-spinner"></div>
                  Processing...
                </>
              ) : (
                <>
                  <FileText className="btn-icon" />
                  Mark Homework
                </>
              )}
            </button>
            
            {selectedFile && (
              <button className="reset-btn" onClick={resetForm}>
                Reset
              </button>
            )}
          </div>
        </div>

        {result && (
          <div className="results-section">
            <div className="results-header">
              <CheckCircle className="success-icon" />
              <h2>Marking Complete</h2>
            </div>
            
            <div className="results-content">
              <div className="result-card">
                <h3>Extracted Text</h3>
                <div className="extracted-text">
                  {result.result?.ocrText || 'No text extracted'}
                </div>
              </div>

              <div className="result-card">
                <h3>Confidence Score</h3>
                <div className="confidence-score">
                  {((result.result?.confidence || 0) * 100).toFixed(1)}%
                </div>
              </div>

              {result.annotatedImage && (
                <div className="result-card">
                  <h3>Annotated Image</h3>
                  <div className="annotated-image">
                    <img src={result.annotatedImage} alt="Annotated homework" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkHomeworkPage;
