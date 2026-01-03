import React, { useState, useEffect } from 'react';
import { Settings, Moon, Sun, Monitor } from 'lucide-react';
import useTheme from '../../hooks/useTheme';
import { STORAGE_KEYS, AI_MODELS } from '../../utils/constants';

const SettingsSection = () => {
    // Theme management via hook
    const { theme, setTheme } = useTheme();

    // Model management - synced with localStorage and other components
    const [selectedModel, setSelectedModel] = useState(() => {
        return localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) || AI_MODELS.GEMINI_2_0_FLASH;
    });

    const models = [
        {
            id: AI_MODELS.GEMINI_2_0_FLASH,
            name: 'Gemini 2.0 Flash',
            description: 'Answers quickly'
        },
        {
            id: AI_MODELS.GEMINI_2_5_FLASH,
            name: 'Gemini 2.5 Flash',
            description: 'Solves complex problems'
        },
        {
            id: AI_MODELS.GEMINI_3_FLASH_PREVIEW,
            name: 'Gemini 3.0 Flash',
            description: 'For advanced math & code'
        },
        {
            id: AI_MODELS.OPENAI_GPT_4O,
            name: 'GPT-4o',
            description: 'Latest advanced model'
        },
    ];

    // Sync with other components via window event
    useEffect(() => {
        const handleModelSync = (event) => {
            const newModel = event.detail;
            if (newModel && newModel !== selectedModel) {
                setSelectedModel(newModel);
            }
        };

        window.addEventListener('modelChanged', handleModelSync);
        return () => {
            window.removeEventListener('modelChanged', handleModelSync);
        };
    }, [selectedModel]);

    const handleModelChange = (modelId) => {
        setSelectedModel(modelId);
        localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, modelId);
        // Dispatch event for MarkingPageContext and other listeners
        window.dispatchEvent(new CustomEvent('modelChanged', { detail: modelId }));
    };

    const handleThemeChange = (newTheme) => {
        setTheme(newTheme);
    };

    return (
        <div className="settings-page">
            {/* Page Title */}
            <div className="settings-page-header">
                <h1 className="settings-page-title">Settings</h1>
            </div>

            {/* Appearance Section */}
            <div className="settings-section">
                <h2 className="settings-section-title">Appearance</h2>

                {/* Theme Setting */}
                <div className="settings-item">
                    <label className="settings-item-label">Theme</label>
                    <div className="theme-options">
                        <button
                            className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('light')}
                        >
                            <div className="theme-preview light-preview">
                                <Sun size={20} />
                            </div>
                            <span className="theme-option-label">Light</span>
                        </button>

                        <button
                            className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('dark')}
                        >
                            <div className="theme-preview dark-preview">
                                <Moon size={20} />
                            </div>
                            <span className="theme-option-label">Dark</span>
                        </button>

                        <button
                            className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('system')}
                        >
                            <div className="theme-preview system-preview">
                                <Monitor size={20} />
                            </div>
                            <span className="theme-option-label">Follow System</span>
                        </button>
                    </div>
                </div>

            </div>

            {/* AI Preferences Section */}
            <div className="settings-section">
                <h2 className="settings-section-title">AI Preferences</h2>
                <div className="settings-item">
                    <label className="settings-item-label">Default Model</label>
                    <div className="model-options-container">
                        {models.map(model => (
                            <button
                                key={model.id}
                                className={`model-option-btn ${selectedModel === model.id ? 'active' : ''}`}
                                onClick={() => handleModelChange(model.id)}
                            >
                                <div className="model-info">
                                    <span className="model-name">
                                        {model.name}
                                    </span>
                                    <span className="model-id">{model.description}</span>
                                </div>
                                {selectedModel === model.id && (
                                    <div className="check-icon">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsSection;
