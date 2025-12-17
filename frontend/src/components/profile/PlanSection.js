import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Crown, CheckCircle, CreditCard, Calendar, AlertCircle } from 'lucide-react';
import CreditIcon from '../common/CreditIcon';
import SubscriptionService from '../../services/subscriptionService';
import API_CONFIG from '../../config/api';

const PlanSection = () => {
    const { user } = useAuth();
    const [subscription, setSubscription] = useState(null);
    const [credits, setCredits] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!user?.uid) return;
            setLoading(true);
            try {
                const timestamp = Date.now();

                // Fetch Subscription
                const subResponse = await SubscriptionService.getUserSubscription(user.uid);
                setSubscription(subResponse.subscription);

                // Fetch Credits
                const creditsResponse = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}?t=${timestamp}`, {
                    cache: 'no-store'
                });
                if (creditsResponse.ok) {
                    const creditsData = await creditsResponse.json();
                    setCredits(creditsData);
                }
            } catch (error) {
                console.error('Error fetching plan data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [user]);

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        return new Date(timestamp * 1000).toLocaleDateString('en-US', {
            year: 'numeric', // Changed to 2-digit based on screenshot usually being short, or keeping consistent
            month: 'short',
            day: 'numeric'
        }).replace(/(\d{4})/, (y) => y.slice(2)); // Hacky 2-digit year "Jan 10, 26" format style if needed, or just use standard
    };

    // Custom formatter to match screenshot "Jan 10, 26"
    const formatDateShort = (timestamp) => {
        if (!timestamp) return '-';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ", " + date.getFullYear().toString().slice(2);
    };

    const formatAmount = (amount, currency) => {
        return new Intl.NumberFormat('en-GB', { // Screenshot shows £
            style: 'currency',
            currency: currency?.toUpperCase() || 'GBP'
        }).format(amount / 100);
    };

    if (loading) {
        return <div className="plan-loading">Loading plan details...</div>;
    }

    if (!subscription || subscription.status !== 'active') {
        return (
            <div className="plan-container">
                <div className="plan-empty-state">
                    <Crown size={48} className="plan-icon-large" />
                    <h3>No Active Plan</h3>
                    <p>Upgrade to Pro to unlock advanced features.</p>
                    <button className="action-btn primary" onClick={() => window.location.href = '/upgrade'}>
                        Upgrade Now
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="plan-container">
            {/* Plan Header Card */}
            <div className="plan-header-card">
                <div className="plan-title-row">
                    <div className="plan-identity">
                        <Crown size={20} className="plan-crown-icon" />
                        <span className="plan-name">{SubscriptionService.getPlanDisplayName(subscription.planId)} Plan</span>
                    </div>
                    <div className="plan-status-badge">
                        <CheckCircle size={14} />
                        <span>{subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}</span>
                    </div>
                </div>
            </div>

            {/* Details Grid */}
            <div className="plan-details-grid">

                {/* Amount */}
                <div className="plan-detail-row">
                    <div className="plan-detail-label">
                        <CreditCard size={16} />
                        <span>AMOUNT</span>
                    </div>
                    <div className="plan-detail-value">
                        {formatAmount(subscription.amount, subscription.currency)} <span className="plan-interval">/{subscription.billingCycle}</span>
                    </div>
                </div>

                {/* Current Period */}
                <div className="plan-detail-row">
                    <div className="plan-detail-label">
                        <Calendar size={16} />
                        <span>CURRENT PERIOD</span>
                    </div>
                    <div className="plan-detail-value">
                        {formatDateShort(subscription.currentPeriodStart)} - {formatDateShort(subscription.currentPeriodEnd)}
                    </div>
                </div>

                {/* Next Billing */}
                <div className="plan-detail-row">
                    <div className="plan-detail-label">
                        <Calendar size={16} />
                        <span>NEXT BILLING</span>
                    </div>
                    <div className="plan-detail-value">
                        {formatDateShort(subscription.currentPeriodEnd)}
                    </div>
                </div>

                {/* Credits */}
                {credits && (
                    <div className="plan-detail-row">
                        <div className="plan-detail-label">
                            <CreditIcon size={16} />
                            <span>CREDITS</span>
                        </div>
                        <div className="plan-detail-value">
                            <span className={credits.remainingCredits < 0 ? 'credits-negative' : ''}>
                                {credits.remainingCredits}
                            </span>
                            <span className="credits-total"> / {credits.totalCredits}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Scheduled Downgrade Warning */}
            {subscription?.scheduledPlanId && (
                <div className="plan-warning-box">
                    <AlertCircle size={14} />
                    <span>
                        Downgrade to <strong>{subscription.scheduledPlanId}</strong> scheduled for{' '}
                        {new Date(subscription.scheduleEffectiveDate).toLocaleDateString()}
                    </span>
                </div>
            )}

            {/* Manage Button */}
            <button
                className="manage-subscription-btn"
                onClick={() => window.location.href = '/upgrade'} // Or open stripe portal if available
            >
                Manage Subscription
            </button>
        </div>
    );
};

export default PlanSection;
