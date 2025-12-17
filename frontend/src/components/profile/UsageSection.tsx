import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { Sparkles, Zap, Activity, ChevronRight, ChevronDown } from 'lucide-react';
import CreditIcon from '../common/CreditIcon';
import API_CONFIG from '../../config/api';

interface UsageRecord {
    // ... same as before
    sessionId: string;
    userId: string;
    createdAt: string;
    totalCost: number;
    modelCost: number;
    mathpixCost: number;
    mode?: string;
    modelUsed: string;
    modeHistory?: Array<{
        mode: string;
        timestamp: string;
        costAtSwitch: number;
        modelCostAtSwitch: number;
        modelUsed: string;
    }>;
}

interface UsageSummary {
    totalCost: number;
    totalModelCost: number;
    totalMathpixCost: number;
    totalApiRequests: number;
    totalSessions: number;
}

const UsageSection: React.FC = () => {
    const { getAuthToken, user } = useAuth(); // Added user
    const { planId } = useSubscription();
    const navigate = useNavigate();

    const [usageData, setUsageData] = useState<UsageRecord[]>([]);
    const [usageSummary, setUsageSummary] = useState<UsageSummary>({
        totalCost: 0,
        totalModelCost: 0,
        totalMathpixCost: 0,
        totalApiRequests: 0,
        totalSessions: 0
    });
    const [usageFilter] = useState<string>('month');
    const [loading, setLoading] = useState<boolean>(false);
    const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

    // New state for credits
    const [userCredits, setUserCredits] = useState<{ remainingCredits: number; totalCredits: number } | null>(null);

    // Fetch Credits
    useEffect(() => {
        const fetchCredits = async () => {
            if (!user?.uid) return;
            try {
                const timestamp = Date.now();
                const response = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}?t=${timestamp}`, {
                    cache: 'no-store'
                });
                if (response.ok) {
                    const data = await response.json();
                    setUserCredits(data);
                }
            } catch (error) {
                console.error('Error fetching credits:', error);
            }
        };
        fetchCredits();
    }, [user?.uid]);

    const loadUsageData = useCallback(async (filter: string) => {
        try {
            setLoading(true);
            const authToken = await getAuthToken();
            if (!authToken) return;

            const response = await fetch(`${API_CONFIG.BASE_URL}/api/usage/me?filter=${filter}`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (!response.ok) throw new Error('Failed to fetch usage data');

            const data = await response.json();
            setUsageData(data.usage || []);
            setUsageSummary(data.summary || {
                totalCost: 0,
                totalModelCost: 0,
                totalMathpixCost: 0,
                totalApiRequests: 0,
                totalSessions: 0
            });
        } catch (error) {
            console.error('Error loading usage data:', error);
        } finally {
            setLoading(false);
        }
    }, [getAuthToken]);

    useEffect(() => {
        loadUsageData(usageFilter);
    }, [usageFilter, loadUsageData]);

    const toggleExpand = (sessionId: string) => {
        setExpandedSessions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(sessionId)) {
                newSet.delete(sessionId);
            } else {
                newSet.add(sessionId);
            }
            return newSet;
        });
    };

    const formatDate = (timestamp: string) => {
        return new Date(timestamp).toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(',', '');
    };

    const formatMode = (mode?: string) => {
        if (!mode) return 'Chat Session';
        return mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-/g, ' ');
    };

    const getPlanDisplayName = () => {
        if (!planId) return 'Free';
        return planId.charAt(0).toUpperCase() + planId.slice(1);
    };

    return (
        <div className="usage-container">
            {/* Top Summary Box */}
            <div className="usage-summary-box">
                <div className="usage-plan-header">
                    <div className="usage-plan-name">{getPlanDisplayName()} Plan</div>
                    <button
                        className="usage-upgrade-btn"
                        onClick={() => {
                            window.dispatchEvent(new CustomEvent('OPEN_PROFILE_MODAL', { detail: { tab: 'plan' } }));
                        }}
                    >
                        {planId === 'free' ? 'Upgrade' : 'Manage Subscription'}
                    </button>
                </div>

                {/* Credits Balance Row - Added per request */}
                {userCredits && (
                    <div className="usage-stat-row">
                        <div className="usage-stat-label">
                            <CreditIcon size={14} />
                            <span>Credit Balance</span>
                        </div>
                        <div className="usage-stat-value">
                            <span className={userCredits.remainingCredits < 5 ? 'low-credits' : ''}>
                                {userCredits.remainingCredits}
                            </span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9em' }}> / {userCredits.totalCredits}</span>
                        </div>
                    </div>
                )}

                <div className="usage-stat-row">
                    <div className="usage-stat-label">
                        <Sparkles size={14} />
                        <span>Total Monthly Spend</span>
                    </div>
                    <div className="usage-stat-value">
                        {usageSummary.totalCost.toFixed(4)}
                    </div>
                </div>

                <div className="usage-stat-row">
                    <div className="usage-stat-label">
                        <Activity size={14} />
                        <span>Total Sessions</span>
                    </div>
                    <div className="usage-stat-value">
                        {usageSummary.totalSessions}
                    </div>
                </div>

                <div className="usage-stat-row">
                    <div className="usage-stat-label">
                        <Zap size={14} />
                        <span>API Requests</span>
                    </div>
                    <div className="usage-stat-value">
                        {usageSummary.totalApiRequests || 0}
                    </div>
                </div>
            </div>

            {/* Bottom Details List */}
            <div className="usage-details-list">
                <div className="usage-list-header">
                    <div style={{ paddingLeft: '24px' }}>Details</div>
                    <div>Date</div>
                    <div style={{ textAlign: 'right' }}>Cost</div>
                </div>

                <div className="usage-list-scroll">
                    {loading ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
                    ) : usageData.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>No usage records found for this month</div>
                    ) : (
                        usageData.map((session) => {
                            const hasHistory = session.modeHistory &&
                                session.modeHistory.length > 0 &&
                                !(session.modeHistory.length === 1 && session.modeHistory[0].costAtSwitch === 0);
                            const isExpanded = expandedSessions.has(session.sessionId);

                            return (
                                <>
                                    <div
                                        className="usage-list-item"
                                        onClick={hasHistory ? () => toggleExpand(session.sessionId) : undefined}
                                        style={{ cursor: hasHistory ? 'pointer' : 'default' }}
                                    >
                                        <div className="usage-row-toggle">
                                            {hasHistory ? (
                                                <div className="usage-chevron">
                                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </div>
                                            ) : (
                                                <div style={{ width: '14px', height: '14px' }}></div> // Spacer
                                            )}
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{formatMode(session.mode)}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{session.modelUsed}</div>
                                            </div>
                                        </div>
                                        <div className="usage-list-date">{formatDate(session.createdAt)}</div>
                                        <div className="usage-list-cost">{session.totalCost.toFixed(4)}</div>
                                    </div>

                                    {isExpanded && session.modeHistory && (
                                        session.modeHistory.map((historyItem, idx, arr) => {
                                            const nextItem = arr[idx + 1];
                                            const segmentCost = nextItem
                                                ? nextItem.costAtSwitch - historyItem.costAtSwitch
                                                : session.totalCost - historyItem.costAtSwitch;

                                            return (
                                                <div key={`${session.sessionId}-history-${idx}`} className="usage-list-subitem">
                                                    <div>
                                                        <div>{formatMode(historyItem.mode)} (Switch)</div>
                                                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{historyItem.modelUsed}</div>
                                                    </div>
                                                    <div>{formatDate(historyItem.timestamp)}</div>
                                                    <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                                        {Math.max(0, segmentCost).toFixed(4)}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default UsageSection;
