import API_CONFIG from '../config/api';

const ANON_ID_KEY = 'aimarking_anon_id';

export const getAnonymousId = () => {
  try {
    let anonId = localStorage.getItem(ANON_ID_KEY);
    if (!anonId) {
      anonId = 'anon_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
      localStorage.setItem(ANON_ID_KEY, anonId);
    }
    return anonId;
  } catch {
    return 'anon_private_tab';
  }
};

export const trackFunnelEvent = (eventName, metadata = {}, userId = null) => {
  try {
    const payload = JSON.stringify({
      event: eventName,
      userId: userId || null,
      anonymousId: getAnonymousId(),
      path: window.location.pathname + window.location.search,
      origin: window.location.origin,
      timestamp: new Date().toISOString(),
      ...metadata
    });

    const baseUrl = API_CONFIG?.BASE_URL || process.env.REACT_APP_API_URL || '';
    const endpoint = `${baseUrl}/api/config/telemetry`;

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
      navigator.sendBeacon(endpoint, blob);
    } else {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }
  } catch (_) {
    // Telemetry must never throw or interrupt user flow
  }
};
