import React, { useState, useEffect } from 'react';
import { FileText, Camera, X } from 'lucide-react';
import './FileHandoff.css';

interface FileHandoffProps {
    onFilesSelected: (files: File[]) => void;
    onClose: () => void;
    onOpenCamera?: () => void;
}

export const FileHandoff: React.FC<FileHandoffProps> = ({ onFilesSelected, onClose, onOpenCamera }) => {
    const [handoffType, setHandoffType] = useState<'upload' | 'scan' | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const action = params.get('action');

        // Support both 'select' and 'upload' for file selection
        if (action === 'select' || action === 'upload') {
            setHandoffType('upload');
        } else if (action === 'scan') {
            setHandoffType('scan');
        }
    }, []);

    if (!handoffType) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            onFilesSelected(files);
            setHandoffType(null);
            // Clean the URL
            window.history.replaceState({}, '', '/app');
            onClose();
        }
    };

    const handleTriggerClick = (e: React.MouseEvent) => {
        if (handoffType === 'scan' && onOpenCamera) {
            e.preventDefault();
            onOpenCamera();
        }
    };

    return (
        <div className="handoff-overlay">
            <div className="handoff-card animate-handoff">
                <div className={`handoff-icon-wrapper ${handoffType}`}>
                    {handoffType === 'upload' ? (
                        <FileText size={32} />
                    ) : (
                        <Camera size={32} />
                    )}
                </div>

                <h3 className="handoff-title">
                    {handoffType === 'upload' ? 'Ready to Upload' : 'Ready to Scan'}
                </h3>
                <p className="handoff-subtitle">
                    Click below to provide your {handoffType === 'upload' ? 'PDF/JPG paper' : 'handwritten work'}.
                </p>

                <label className="handoff-trigger-button" onClick={handleTriggerClick}>
                    {handoffType === 'upload' ? 'Open File Explorer' : 'Open Camera'}
                    {!(handoffType === 'scan' && onOpenCamera) && (
                        <input
                            type="file"
                            className="hidden-input"
                            accept={handoffType === 'upload' ? ".pdf,.jpg,.jpeg,.png,image/*" : "image/*"}
                            capture={handoffType === 'scan' ? "environment" : undefined}
                            multiple={handoffType === 'upload'}
                            onChange={handleFileChange}
                        />
                    )}
                </label>

                <button
                    onClick={onClose}
                    className="handoff-cancel-btn"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};
