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
    mode?: string;
    modeHistory?: Array<{
        mode: string;
        timestamp: string;
        costAtSwitch: number;
        apiRequestsAtSwitch?: number;
        geminiCostAtSwitch?: number;
        gptCostAtSwitch?: number;
        mathpixCostAtSwitch?: number;
    }>;
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
    const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
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

    const toggleExpanded = (sessionId: string) => {
        setExpandedSessions(prev => {
            const next = new Set(prev);
            if (next.has(sessionId)) {
                next.delete(sessionId);
            } else {
                next.add(sessionId);
            }
            return next;
        });
    };

    const formatDate = (timestamp: string) => {
        return new Date(timestamp).toLocaleString();
    };

    const formatMode = (mode?: string) => {
        if (!mode) return 'Unknown'; // Or 'Chat' if default
        // Capitalize first letter
        return mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-/g, ' ');
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
                            <div className="usage-summary-label">AI Cost</div>
                            <div className="usage-summary-value">${(usageSummary.totalGeminiCost + usageSummary.totalGptCost).toFixed(2)}</div>
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
                                            <th>Mode</th>
                                            <th>Model Used</th>
                                            <th>API Requests</th>
                                            <th>Total Cost</th>
                                            <th>AI Cost</th>
                                            <th>Mathpix Cost</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {usageData.map((session) => {
                                            const isExpanded = expandedSessions.has(session.sessionId);
                                            const hasHistory = session.modeHistory && session.modeHistory.length > 1;

                                            return (
                                                <React.Fragment key={session.sessionId}>
                                                    <tr className={isExpanded ? 'usage-row-expanded' : ''}>
                                                        <td>{formatDate(session.createdAt)}</td>
                                                        <td className="mode-cell">
                                                            {hasHistory ? (
                                                                <button
                                                                    className="mode-expand-btn"
                                                                    onClick={() => toggleExpanded(session.sessionId)}
                                                                >
                                                                    {isExpanded ? (
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                                                    ) : (
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                                                    )}
                                                                    {formatMode(session.mode)}
                                                                </button>
                                                            ) : (
                                                                formatMode(session.mode)
                                                            )}
                                                        </td>
                                                        <td>{session.modelUsed}</td>
                                                        <td>{session.apiRequests || 0}</td>
                                                        <td>${session.totalCost.toFixed(4)}</td>
                                                        <td>${((session.geminiCost || 0) + (session.gptCost || 0)).toFixed(4)}</td>
                                                        <td>${session.mathpixCost.toFixed(4)}</td>
                                                    </tr>
                                                    {isExpanded && session.modeHistory && session.modeHistory.map((h, i, arr) => {
                                                        // Calculate deltas
                                                        let usageCost = 0;
                                                        // let apiRequests = 0; // Not used
                                                        // let aiCost = 0; // Not used
                                                        // let mCost = 0; // Not used

                                                        if (i < arr.length - 1) {
                                                            const next = arr[i + 1];
                                                            usageCost = next.costAtSwitch - h.costAtSwitch;
                                                        } else {
                                                            // Last item -> diff with session totals
                                                            usageCost = session.totalCost - h.costAtSwitch;
                                                        }

                                                        // Fallback for API/AI/Mathpix if snapshot unavailable (legacy)
                                                        const apiDelta = (h.apiRequestsAtSwitch !== undefined && i < arr.length - 1)
                                                            ? (arr[i + 1].apiRequestsAtSwitch! - h.apiRequestsAtSwitch!)
                                                            : (h.apiRequestsAtSwitch !== undefined)
                                                                ? (session.apiRequests - h.apiRequestsAtSwitch!)
                                                                : null;

                                                        const aiCostDelta = (h.geminiCostAtSwitch !== undefined && h.gptCostAtSwitch !== undefined && i < arr.length - 1)
                                                            ? ((arr[i + 1].geminiCostAtSwitch! + arr[i + 1].gptCostAtSwitch!) - (h.geminiCostAtSwitch! + h.gptCostAtSwitch!))
                                                            : (h.geminiCostAtSwitch !== undefined && h.gptCostAtSwitch !== undefined)
                                                                ? ((session.geminiCost + session.gptCost) - (h.geminiCostAtSwitch! + h.gptCostAtSwitch!))
                                                                : null;

                                                        return (
                                                            <tr key={`${session.sessionId}-hist-${i}`} className="usage-history-row">
                                                                <td style={{ paddingLeft: '32px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                    {new Date(h.timestamp).toLocaleString(undefined, {
                                                                        year: 'numeric', month: '2-digit', day: '2-digit',
                                                                        hour: '2-digit', minute: '2-digit'
                                                                    })}
                                                                </td>
                                                                <td style={{ fontSize: '12px' }}>{formatMode(h.mode)}</td>
                                                                <td className="text-muted" style={{ textAlign: 'center' }}>-</td>
                                                                <td style={{ fontSize: '12px' }}>{apiDelta !== null ? apiDelta : '-'}</td>
                                                                <td style={{ fontSize: '12px' }}>${usageCost > 0 ? usageCost.toFixed(4) : '0.0000'}</td>
                                                                <td style={{ fontSize: '12px' }}>{aiCostDelta !== null ? `$${aiCostDelta.toFixed(4)}` : '-'}</td>
                                                                <td></td> {/* Mathpix column removed/empty per request */}
                                                            </tr>
                                                        );
                                                    })}
                                                </React.Fragment>
                                            );
                                        })}
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
