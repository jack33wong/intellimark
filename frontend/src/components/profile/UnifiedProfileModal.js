import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, BarChart3, Settings, Crown, X } from 'lucide-react';
import './UnifiedProfileModal.css';
import AccountSection from './AccountSection';
import UsageSection from './UsageSection';
import SettingsSection from './SettingsSection';
import PlanSection from './PlanSection';

const UnifiedProfileModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('account'); // 'account', 'usage', 'settings', 'plan'
    const navigate = useNavigate();

    useEffect(() => {
        const handleOpen = (event) => {
            setIsOpen(true);
            if (event.detail && event.detail.tab) {
                setActiveTab(event.detail.tab);
            }
        };

        const handleCloseEvent = () => {
            setIsOpen(false);
        };

        window.addEventListener('OPEN_PROFILE_MODAL', handleOpen);
        window.addEventListener('CLOSE_PROFILE_MODAL', handleCloseEvent);

        return () => {
            window.removeEventListener('OPEN_PROFILE_MODAL', handleOpen);
            window.removeEventListener('CLOSE_PROFILE_MODAL', handleCloseEvent);
        };
    }, []);

    const handleClose = () => {
        setIsOpen(false);
    };

    if (!isOpen) return null;

    const renderContent = () => {
        switch (activeTab) {
            case 'account':
                return <AccountSection />;
            case 'usage':
                return <UsageSection />;
            case 'settings':
                return <SettingsSection />;
            case 'plan':
                return <PlanSection />;
            default:
                return <AccountSection />;
        }
    };

    return (
        <div className="unified-modal-overlay" onClick={handleClose}>
            <div className="unified-modal" onClick={(e) => e.stopPropagation()}>
                <div className="unified-modal-header">
                    <div className="unified-modal-title">User Profile Settings</div>
                    <button className="unified-modal-close" onClick={handleClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="unified-modal-body">
                    <div className="unified-sidebar">
                        <button
                            className={`unified-sidebar-item ${activeTab === 'account' ? 'active' : ''}`}
                            onClick={() => setActiveTab('account')}
                        >
                            <User />
                            Account
                        </button>
                        <button
                            className={`unified-sidebar-item ${activeTab === 'usage' ? 'active' : ''}`}
                            onClick={() => setActiveTab('usage')}
                        >
                            <BarChart3 />
                            Usage
                        </button>
                        <button
                            className={`unified-sidebar-item ${activeTab === 'settings' ? 'active' : ''}`}
                            onClick={() => setActiveTab('settings')}
                        >
                            <Settings />
                            Settings
                        </button>
                        <button
                            className={`unified-sidebar-item ${activeTab === 'plan' ? 'active' : ''}`}
                            onClick={() => setActiveTab('plan')}
                            style={{ color: activeTab === 'plan' ? 'var(--text-primary)' : 'var(--accent-color)' }}
                        >
                            <Crown size={16} />
                            Manage Plan
                        </button>
                    </div>

                    <div className="unified-content">
                        {renderContent()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UnifiedProfileModal;
