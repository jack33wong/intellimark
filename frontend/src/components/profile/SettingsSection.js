import React, { useState, useEffect } from 'react';
import { Settings, Moon, Sun, Monitor, Grid, List } from 'lucide-react';
import useTheme from '../../hooks/useTheme';

const SettingsSection = () => {
    // Theme management via hook
    const { theme, setTheme } = useTheme();

    // Gallery view preference - read from localStorage on mount
    const [galleryView, setGalleryView] = useState(() => {
        const saved = localStorage.getItem('galleryViewMode');
        return saved || 'grid'; // default to 'grid' if not set
    });

    // Save gallery view to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('galleryViewMode', galleryView);
        // Dispatch custom event so SimpleImageGallery can listen and update
        window.dispatchEvent(new CustomEvent('galleryViewModeChanged', { detail: galleryView }));
    }, [galleryView]);

    const handleThemeChange = (newTheme) => {
        setTheme(newTheme);
    };

    const handleGalleryViewChange = (newView) => {
        setGalleryView(newView);
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

                {/* Gallery View Setting */}
                <div className="settings-item">
                    <label className="settings-item-label">Gallery View</label>
                    <div className="theme-options">
                        <button
                            className={`theme-option ${galleryView === 'grid' ? 'active' : ''}`}
                            onClick={() => handleGalleryViewChange('grid')}
                        >
                            <div className="theme-preview">
                                <Grid size={20} />
                            </div>
                            <span className="theme-option-label">Grid View</span>
                        </button>

                        <button
                            className={`theme-option ${galleryView === 'horizontal' ? 'active' : ''}`}
                            onClick={() => handleGalleryViewChange('horizontal')}
                        >
                            <div className="theme-preview">
                                <List size={20} />
                            </div>
                            <span className="theme-option-label">Horizontal Scroll</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsSection;
