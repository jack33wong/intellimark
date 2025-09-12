/**
 * Custom hook for subscription delay management
 * Handles rate limiting based on subscription type
 */

import { useState, useCallback, useMemo } from 'react';

export const useSubscriptionDelay = () => {
  // Subscription type for delay calculation (can be made dynamic later)
  const [subscriptionType, setSubscriptionType] = useState('free'); // 'free', 'pro', 'enterprise'
  const [lastRequestTime, setLastRequestTime] = useState(0);
  const [isDelayActive, setIsDelayActive] = useState(false);
  const [delayCountdown, setDelayCountdown] = useState(0);
  
  // Subscription delay configuration (in milliseconds) - configurable via .env.local
  const subscriptionDelays = useMemo(() => ({
    free: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_FREE) || 3000,      // 3 seconds default
    pro: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_PRO) || 1000,        // 1 second default
    enterprise: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_ENTERPRISE) || 0    // 0 seconds default
  }), []);
  
  // Get delay for current subscription
  const getCurrentDelay = useCallback(() => subscriptionDelays[subscriptionType] || parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_DEFAULT) || 3000, [subscriptionType, subscriptionDelays]);
  
  // Check if enough time has passed since last request
  const canMakeRequest = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const requiredDelay = getCurrentDelay();
    return timeSinceLastRequest >= requiredDelay;
  }, [lastRequestTime, getCurrentDelay]);
  
  // Get remaining delay time
  const getRemainingDelay = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const requiredDelay = getCurrentDelay();
    return Math.max(0, requiredDelay - timeSinceLastRequest);
  }, [lastRequestTime, getCurrentDelay]);

  // Update last request time
  const updateLastRequestTime = useCallback(() => {
    setLastRequestTime(Date.now());
  }, []);

  // Start delay countdown
  const startDelayCountdown = useCallback(() => {
    setIsDelayActive(true);
    const remaining = getRemainingDelay();
    setDelayCountdown(remaining);
    
    const interval = setInterval(() => {
      const newRemaining = getRemainingDelay();
      setDelayCountdown(newRemaining);
      
      if (newRemaining <= 0) {
        setIsDelayActive(false);
        clearInterval(interval);
      }
    }, 100);
    
    return interval;
  }, [getRemainingDelay]);

  return {
    // State
    subscriptionType,
    setSubscriptionType,
    isDelayActive,
    delayCountdown,
    
    // Actions
    canMakeRequest,
    getRemainingDelay,
    updateLastRequestTime,
    startDelayCountdown,
    getCurrentDelay
  };
};
