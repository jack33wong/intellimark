import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { BarChart3, X } from 'lucide-react';
import './UsageModal.css';

interface UsageModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface UsageRecord {
    sessionId: string;
    userId: string;
    createdAt: string;
    totalCost: number;
    llmCost: number;
    geminiCost: number;
    gptCost: number;
    mathpixCost: number;
    modelUsed: string;
    apiRequests: number;
}

interface UsageSummary {
    totalCost: number;
    totalLLMCost: number;
    totalGeminiCost: number;
    totalGptCost: number;
    totalMathpixCost: number;
    totalUsers: number;
    totalSessions: number;
    totalApiRequests: number;
}

const UsageModal: React.FC<UsageModalProps> = ({ isOpen, onClose }) => {
    const { getAuthToken } = useAuth();
    const [usageData, setUsageData] = useState<UsageRecord[]>([]);
    const [usageSummary, setUsageSummary] = useState<UsageSummary>({
        totalCost: 0,
        totalLLMCost: 0,
        totalGeminiCost: 0,
        totalGptCost: 0,
        totalMathpixCost: 0,
        totalUsers: 1,
        totalSessions: 0,
        totalApiRequests: 0
    });
    const [usageFilter, setUsageFilter] = useState<string>('day');
    const [loading, setLoading] = useState<boolean>(false);

    const loadUsageData = useCallback(async (filter: string = 'day') => {
        try {
            setLoading(true);
            const authToken = await getAuthToken();
            if (!authToken) {
                console.error('No auth token available');
                return;
            }

            const response = await fetch(`http://localhost:5001/api/usage/me?filter=${filter}`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch usage data');
            }

            const data = await response.json();
            setUsageData(data.usage || []);
            setUsageSummary(data.summary || {
                totalCost: 0,
                totalLLMCost: 0,
                totalGeminiCost: 0,
                totalGptCost: 0,
                totalMathpixCost: 0,
                totalUsers: 1,
                totalSessions: 0,
                totalApiRequests: 0
            });
        } catch (error) {
            console.error('Error loading usage data:', error);
        } finally {
            setLoading(false);
        }
    }, [getAuthToken]);

    useEffect(() => {
        if (isOpen) {
            loadUsageData(usageFilter);
        }
    }, [isOpen, usageFilter, loadUsageData]);

    const formatDate = (timestamp: string) => {
        return new Date(timestamp).toLocaleString();
    };

    if (!isOpen) return null;

    return (
        <div className="usage-modal-overlay" onClick={onClose}>
            <div className="usage-modal" onClick={(e) => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="usage-modal-header">
                    <div className="usage-modal-title">
                        <BarChart3 size={24} />
                        <h2>My Usage Statistics</h2>
                    </div>
                    <button className="usage-modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {/* Modal Content */}
                <div className="usage-modal-content">
                    {/* Summary Header */}
                    <div className="usage-summary-header">
                        <div className="usage-summary-card">
                            <div className="usage-summary-label">Total Cost</div>
                            <div className="usage-summary-value">${usageSummary.totalCost.toFixed(2)}</div>
                        </div>
                        <div className="usage-summary-card">
                            <div className="usage-summary-label">Gemini Cost</div>
                            <div className="usage-summary-value">${usageSummary.totalGeminiCost.toFixed(2)}</div>
                        </div>
                        <div className="usage-summary-card">
                            <div className="usage-summary-label">GPT Cost</div>
                            <div className="usage-summary-value">${usageSummary.totalGptCost.toFixed(2)}</div>
                        </div>
                        <div className="usage-summary-card">
                            <div className="usage-summary-label">Mathpix Cost</div>
                            <div className="usage-summary-value">${usageSummary.totalMathpixCost.toFixed(2)}</div>
                        </div>
                        <div className="usage-summary-card">
                            <div className="usage-summary-label">Total Sessions</div>
                            <div className="usage-summary-value">{usageSummary.totalSessions}</div>
                        </div>
                        <div className="usage-summary-card">
                            <div className="usage-summary-label">API Requests</div>
                            <div className="usage-summary-value">{usageSummary.totalApiRequests || 0}</div>
                        </div>
                    </div>

                    {/* Filter Tabs */}
                    <div className="usage-filter-tabs">
                        <button
                            className={`usage-filter-tab ${usageFilter === 'day' ? 'usage-filter-tab--active' : ''}`}
                            onClick={() => setUsageFilter('day')}
                        >
                            Today
                        </button>
                        <button
                            className={`usage-filter-tab ${usageFilter === 'yesterday' ? 'usage-filter-tab--active' : ''}`}
                            onClick={() => setUsageFilter('yesterday')}
                        >
                            Yesterday
                        </button>
                        <button
                            className={`usage-filter-tab ${usageFilter === 'week' ? 'usage-filter-tab--active' : ''}`}
                            onClick={() => setUsageFilter('week')}
                        >
                            Week
                        </button>
                        <button
                            className={`usage-filter-tab ${usageFilter === 'month' ? 'usage-filter-tab--active' : ''}`}
                            onClick={() => setUsageFilter('month')}
                        >
                            Month
                        </button>
                        <button
                            className={`usage-filter-tab ${usageFilter === 'year' ? 'usage-filter-tab--active' : ''}`}
                            onClick={() => setUsageFilter('year')}
                        >
                            Year
                        </button>
                        <button
                            className={`usage-filter-tab ${usageFilter === 'all' ? 'usage-filter-tab--active' : ''}`}
                            onClick={() => setUsageFilter('all')}
                        >
                            All
                        </button>
                    </div>

                    {/* Usage Table */}
                    <div className="usage-table-section">
                        <h3 className="usage-table-title">Usage Records ({usageData.length})</h3>

                        {loading ? (
                            <div className="usage-empty-state">
                                <p>Loading usage data...</p>
                            </div>
                        ) : usageData.length === 0 ? (
                            <div className="usage-empty-state">
                                <p>No usage data found for this period</p>
                            </div>
                        ) : (
                            <div className="usage-table-container">
                                <table className="usage-table">
                                    <thead>
                                        <tr>
                                            <th>Created At</th>
                                            <th>Model Used</th>
                                            <th>API Requests</th>
                                            <th>Total Cost</th>
                                            <th>Gemini Cost</th>
                                            <th>GPT Cost</th>
                                            <th>Mathpix Cost</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {usageData.map((session) => (
                                            <tr key={session.sessionId}>
                                                <td>{formatDate(session.createdAt)}</td>
                                                <td>{session.modelUsed}</td>
                                                <td>{session.apiRequests || 0}</td>
                                                <td>${session.totalCost.toFixed(2)}</td>
                                                <td>${(session.geminiCost || 0).toFixed(2)}</td>
                                                <td>${(session.gptCost || 0).toFixed(2)}</td>
                                                <td>${session.mathpixCost.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UsageModal;
