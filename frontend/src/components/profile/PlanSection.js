import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Crown, CheckCircle, CreditCard, Calendar, AlertCircle } from 'lucide-react';
import CreditIcon from '../common/CreditIcon';
import SubscriptionService from '../../services/subscriptionService';
import API_CONFIG from '../../config/api';

const PlanSection = ({ onClose }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [subscription, setSubscription] = useState(null);
    const [credits, setCredits] = useState(null);
    const [loading, setLoading] = useState(true);
    const [cancellingSchedule, setCancellingSchedule] = useState(false);
    const [portalLoading, setPortalLoading] = useState(false);

    const refreshData = async () => {
        if (!user?.uid) return;
        try {
            const timestamp = Date.now();
            const subResponse = await SubscriptionService.getUserSubscription(user.uid);
            setSubscription(subResponse.subscription);

            const creditsResponse = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}?t=${timestamp}`, {
                cache: 'no-store'
            });
            if (creditsResponse.ok) {
                const creditsData = await creditsResponse.json();
                setCredits(creditsData);
            }
        } catch (error) {
            console.error('Error fetching plan data:', error);
        }
    };

    useEffect(() => {
        setLoading(true);
        refreshData().finally(() => setLoading(false));
    }, [user?.uid]);

    const formatDateShort = (timestamp) => {
        if (!timestamp) return '-';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const formatAmount = (amount, currency) => {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: currency?.toUpperCase() || 'GBP'
        }).format(amount / 100);
    };

    const handleCancelSchedule = async () => {
        if (!user?.uid) return;
        setCancellingSchedule(true);
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/cancel-schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.uid })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                await refreshData();
            } else {
                alert(data.error || 'Failed to cancel scheduled downgrade');
            }
        } catch (err) {
            console.error('Failed to cancel schedule:', err);
            alert('Error cancelling scheduled downgrade');
        } finally {
            setCancellingSchedule(false);
        }
    };

    const handleOpenBillingPortal = async () => {
        if (!user?.uid) return;
        setPortalLoading(true);
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/create-portal-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.uid,
                    returnUrl: window.location.href
                })
            });
            const data = await response.json();
            if (response.ok && data.url) {
                window.location.href = data.url;
            } else {
                alert(data.error || 'Failed to open billing portal');
            }
        } catch (err) {
            console.error('Error opening billing portal:', err);
            alert('Error opening billing portal');
        } finally {
            setPortalLoading(false);
        }
    };

    if (loading) {
        return <div className="plan-loading">Loading plan details...</div>;
    }

    const currentPlanId = subscription?.planId || 'free';
    const isFreePlan = currentPlanId === 'free';
    const hasScheduledChange = Boolean(subscription?.scheduledPlanId);
    const isScheduledCancel = subscription?.scheduledPlanId === 'free';

    const getCleanPlanTitle = (planId) => {
        switch (planId?.toLowerCase()) {
            case 'free':
                return 'Free Plan';
            case 'pro':
                return 'Pro Plan';
            case 'ultra':
                return 'Ultra Plan';
            case 'admin_test':
                return 'Admin Test Plan';
            default:
                return `${(planId || 'Free').charAt(0).toUpperCase() + (planId || 'free').slice(1)} Plan`;
        }
    };

    // Credit progress calculations
    const remainingCredits = typeof credits?.remainingCredits === 'number' ? credits.remainingCredits : (isFreePlan ? 10 : 0);
    const totalCredits = typeof credits?.totalCredits === 'number' ? credits.totalCredits : (isFreePlan ? 10 : 100);
    const isExhausted = remainingCredits <= 0;
    const progressPercent = isExhausted ? 100 : Math.max(0, Math.min(100, (remainingCredits / (totalCredits || 1)) * 100));

    let progressBarColor = '#10b981';
    if (isExhausted) {
        progressBarColor = 'rgba(239, 68, 68, 0.45)';
    } else if (progressPercent < 20 || remainingCredits < 5) {
        progressBarColor = '#f59e0b';
    }

    const hasStripeCustomer = subscription?.stripeCustomerId &&
        !subscription.stripeCustomerId.startsWith('cus_debug_') &&
        !subscription.stripeCustomerId.startsWith('cus_test_') &&
        !String(subscription.id || '').startsWith('admin_sub_');

    return (
        <div className="plan-container">
            {/* Plan Header Card */}
            <div className="plan-header-card">
                <div className="plan-title-row">
                    <div className="plan-identity">
                        <Crown size={20} className="plan-crown-icon" />
                        <span className="plan-name">{getCleanPlanTitle(currentPlanId)}</span>
                    </div>
                    {isScheduledCancel ? (
                        <span className="plan-status-pill canceling">
                            CANCELS ON {formatDateShort(subscription.currentPeriodEnd)}
                        </span>
                    ) : (
                        <span className="plan-status-pill active">
                            <CheckCircle size={12} />
                            ACTIVE
                        </span>
                    )}
                </div>
            </div>

            {/* Inline Cancellation Scheduled Box */}
            {hasScheduledChange && (
                <div className="plan-cancellation-box">
                    <div className="plan-cancellation-left">
                        <AlertCircle size={18} />
                        <span>
                            {isScheduledCancel ? (
                                <>Subscription will cancel on <strong>{new Date(subscription.scheduleEffectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>.</>
                            ) : (
                                <>Downgrade to <strong>{SubscriptionService.getPlanDisplayName(subscription.scheduledPlanId)}</strong> scheduled for <strong>{new Date(subscription.scheduleEffectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>.</>
                            )}
                        </span>
                    </div>
                    <button
                        className="plan-dont-cancel-btn"
                        onClick={handleCancelSchedule}
                        disabled={cancellingSchedule}
                    >
                        {cancellingSchedule ? 'Reverting...' : "Don't Cancel"}
                    </button>
                </div>
            )}

            {/* Details Grid */}
            <div className="plan-details-grid">
                {/* Price / Amount */}
                <div className="plan-detail-row">
                    <div className="plan-detail-label">
                        <CreditCard size={16} />
                        <span>PRICE</span>
                    </div>
                    <div className="plan-detail-value">
                        {isFreePlan
                            ? '£0.00 / month'
                            : `${formatAmount(subscription.amount, subscription.currency)} / ${subscription.billingCycle || 'month'}`}
                    </div>
                </div>

                {/* Current Period - Paid Plans */}
                {!isFreePlan && subscription?.currentPeriodStart && subscription?.currentPeriodEnd && (
                    <div className="plan-detail-row">
                        <div className="plan-detail-label">
                            <Calendar size={16} />
                            <span>CURRENT PERIOD</span>
                        </div>
                        <div className="plan-detail-value">
                            {formatDateShort(subscription.currentPeriodStart)} - {formatDateShort(subscription.currentPeriodEnd)}
                        </div>
                    </div>
                )}

                {/* Next Billing - Paid Plans */}
                {!isFreePlan && subscription?.currentPeriodEnd && (
                    <div className="plan-detail-row">
                        <div className="plan-detail-label">
                            <Calendar size={16} />
                            <span>{isScheduledCancel ? 'EXPIRATION DATE' : 'NEXT BILLING'}</span>
                        </div>
                        <div className="plan-detail-value">
                            {formatDateShort(subscription.currentPeriodEnd)}
                        </div>
                    </div>
                )}

                {/* Live Credit Usage Progress Bar */}
                <div className="plan-detail-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px', padding: '8px 0' }}>
                    <div className="plan-credit-header">
                        <div className="plan-detail-label">
                            <CreditIcon size={16} />
                            <span>CREDITS REMAINING</span>
                        </div>
                        <div className="plan-credit-counts">
                            {isExhausted ? (
                                <span style={{ color: '#f87171', fontWeight: 600 }}>
                                    {remainingCredits.toFixed(2)} / {totalCredits.toFixed(2)} (Exhausted)
                                </span>
                            ) : (
                                <>
                                    <span style={{ fontWeight: 600 }}>
                                        {remainingCredits.toFixed(2)}
                                    </span>
                                    <span className="credits-total">/ {totalCredits.toFixed(2)}</span>
                                </>
                            )}
                            {remainingCredits < 5 && (
                                <button
                                    className="plan-topup-btn-small"
                                    onClick={() => {
                                        if (onClose) onClose();
                                        navigate('/pricing', { state: { fromApp: true, source: 'profile_plan_modal' } });
                                    }}
                                >
                                    Top Up / Upgrade
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="plan-progress-bar-bg">
                        <div
                            className="plan-progress-bar-fill"
                            style={{
                                width: `${progressPercent}%`,
                                backgroundColor: progressBarColor
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Action Buttons Footer */}
            <div className="plan-actions-footer">
                <button
                    className="manage-subscription-btn"
                    onClick={() => {
                        if (onClose) onClose();
                        navigate('/pricing', { state: { fromApp: true, source: 'profile_plan_modal' } });
                    }}
                >
                    Change / Upgrade Plan
                </button>
                {hasStripeCustomer && (
                    <button
                        className="plan-portal-btn"
                        onClick={handleOpenBillingPortal}
                        disabled={portalLoading}
                    >
                        {portalLoading ? 'Connecting to Stripe...' : 'Billing & Invoices'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default PlanSection;
