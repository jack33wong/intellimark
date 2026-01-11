import React, { useState, useRef } from 'react';
import { Upload, FileText, ChevronRight, Loader2 } from 'lucide-react';
import './LandingPageUploadWidget.css';

interface LandingPageUploadWidgetProps {
    onUpload: (files: FileList | File[]) => void;
    examBoard: string;
    compact?: boolean;
}

const LandingPageUploadWidget: React.FC<LandingPageUploadWidgetProps> = ({ onUpload, examBoard, compact }) => {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onUpload(e.dataTransfer.files);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onUpload(e.target.files);
        }
    };

    if (compact) {
        return (
            <div className="compact-upload-widget">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    multiple
                    accept="image/*,application/pdf"
                />
                <button
                    className="cta-button-secondary"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload size={20} /> Upload Paper
                </button>
            </div>
        );
    }

    return (
        <div
            className={`landing-upload-widget ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
        >
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: 'none' }}
                multiple
                accept="image/*,application/pdf"
            />

            <div className="widget-content">
                <div className="icon-stack">
                    <Upload className="upload-icon" size={32} />
                    <FileText className="file-icon" size={48} />
                </div>
                <h3>Drop your {examBoard} Paper here</h3>

                <div className="file-support-labels">
                    <span className="file-badge">PDF</span>
                    <span className="file-badge">JPG</span>
                    <span className="file-badge">PNG</span>
                </div>

                <div className="widget-footer">
                    <span>Or browse files</span>
                    <ChevronRight size={16} />
                </div>
            </div>

            {/* Subtle Gradient Glow */}
            <div className="widget-glow" />
        </div>
    );
};

export default LandingPageUploadWidget;
