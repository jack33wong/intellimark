import React, { useState } from 'react';
import { Settings, Moon, Sun, Monitor } from 'lucide-react';

const SettingsSection = () => {
    // Basic state for appearance, persistence would need Context or localStorage
    const [theme, setTheme] = useState('dark'); // 'dark', 'light', 'system'

    const handleThemeChange = (newTheme) => {
        setTheme(newTheme);
        // Actual implementation would go here (e.g., document.body.classList...)
        // For now, this is a UI mockup as requested.
    };

    return (
        <div className="settings-section-container">
            <div className="section-title">
                <Settings size={24} />
                <h2>Settings</h2>
            </div>

            <div className="section-group">
                <div className="section-group-header">
                    <h3>Appearance</h3>
                </div>

                <div className="appearance-options" style={{ display: 'flex', gap: '16px' }}>
                    <button
                        className={`appearance-option-btn ${theme === 'light' ? 'active' : ''}`}
                        onClick={() => handleThemeChange('light')}
                        style={{
                            flex: 1,
                            padding: '16px',
                            borderRadius: '8px',
                            border: `1px solid ${theme === 'light' ? 'var(--text-brand)' : 'var(--border-subtle)'}`,
                            background: 'var(--background-secondary)',
                            color: 'var(--text-primary)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer'
                        }}
                    >
                        <Sun size={24} />
                        <span>Light</span>
                    </button>

                    <button
                        className={`appearance-option-btn ${theme === 'dark' ? 'active' : ''}`}
                        onClick={() => handleThemeChange('dark')}
                        style={{
                            flex: 1,
                            padding: '16px',
                            borderRadius: '8px',
                            border: `1px solid ${theme === 'dark' ? 'var(--text-brand)' : 'var(--border-subtle)'}`,
                            background: 'var(--background-secondary)',
                            color: 'var(--text-primary)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer'
                        }}
                    >
                        <Moon size={24} />
                        <span>Dark</span>
                    </button>

                    <button
                        className={`appearance-option-btn ${theme === 'system' ? 'active' : ''}`}
                        onClick={() => handleThemeChange('system')}
                        style={{
                            flex: 1,
                            padding: '16px',
                            borderRadius: '8px',
                            border: `1px solid ${theme === 'system' ? 'var(--text-brand)' : 'var(--border-subtle)'}`,
                            background: 'var(--background-secondary)',
                            color: 'var(--text-primary)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer'
                        }}
                    >
                        <Monitor size={24} />
                        <span>System</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsSection;
