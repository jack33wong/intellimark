import API_CONFIG from '../config/api';

const ANON_ID_KEY = 'aimarking_anon_id';
const AUTH_WALL_FUNNEL_KEY = 'aimarking_auth_wall_funnel';

let latestPreInspectSessionId = null;
let activeAuthWallState = null;

export const setLatestPreInspectSessionId = (sessionId) => {
  latestPreInspectSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
};

export const getLatestPreInspectSessionId = () => latestPreInspectSessionId;

const persistAuthWallState = (state) => {
  activeAuthWallState = state;
  try {
    if (state) {
      sessionStorage.setItem(AUTH_WALL_FUNNEL_KEY, JSON.stringify(state));
    } else {
      sessionStorage.removeItem(AUTH_WALL_FUNNEL_KEY);
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
};

const readAuthWallState = () => {
  if (activeAuthWallState) return activeAuthWallState;
  try {
    const raw = sessionStorage.getItem(AUTH_WALL_FUNNEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      activeAuthWallState = parsed;
      return parsed;
    }
  } catch {
    // Ignore malformed storage
  }
  return null;
};

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

export const getNavigationType = () => {
  try {
    const navEntry = performance.getEntriesByType?.('navigation')?.[0];
    return navEntry?.type || 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * @param {string} eventName
 * @param {Record<string, any>} [metadata]
 * @param {string | null} [userId]
 */
export const trackFunnelEvent = (eventName, metadata = {}, userId = null) => {
  try {
    const viewport =
      typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null;

    const payload = JSON.stringify({
      event: eventName,
      userId: userId || null,
      anonymousId: getAnonymousId(),
      path: window.location.pathname + window.location.search,
      origin: window.location.origin,
      viewport,
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

export const markAuthWallShown = ({
  trigger = 'marking_submit',
  fileCount = 0,
  preInspectSessionId = null
} = {}) => {
  const resolvedPreInspectSessionId = preInspectSessionId || getLatestPreInspectSessionId() || null;
  const state = {
    trigger,
    openedAt: Date.now(),
    fileCount: typeof fileCount === 'number' ? fileCount : 0,
    preInspectSessionId: resolvedPreInspectSessionId,
    outcomeFired: false
  };
  persistAuthWallState(state);

  trackFunnelEvent('auth_wall_shown', {
    type: 'funnel',
    trigger,
    fileCount: state.fileCount,
    preInspectSessionId: resolvedPreInspectSessionId
  }, null);
};

export const hasActiveMarkingAuthWall = () => {
  const state = readAuthWallState();
  return Boolean(state && state.trigger === 'marking_submit' && !state.outcomeFired);
};

export const markAuthWallCtaClicked = (step, button, preInspectSessionId = null) => {
  const state = readAuthWallState();
  if (!state || state.trigger !== 'marking_submit' || state.outcomeFired) {
    return;
  }
  const resolvedPreInspectSessionId =
    preInspectSessionId || state.preInspectSessionId || getLatestPreInspectSessionId() || null;

  trackFunnelEvent('auth_wall_cta_clicked', {
    type: 'funnel',
    step,
    button,
    preInspectSessionId: resolvedPreInspectSessionId
  }, null);
};

export const markAuthWallDismissed = (dismissMethod = 'close_button', step = 'interstitial') => {
  const state = readAuthWallState();
  if (!state || state.trigger !== 'marking_submit' || state.outcomeFired) {
    return;
  }
  const timeOpenMs = Math.max(0, Date.now() - (Number(state.openedAt) || Date.now()));
  persistAuthWallState(null);

  trackFunnelEvent('auth_wall_dismissed', {
    type: 'funnel',
    step,
    trigger: 'marking_submit',
    timeOpenMs,
    dismissMethod,
    preInspectSessionId: state.preInspectSessionId || null
  }, null);
};

/**
 * @param {string} [method]
 * @param {string | null} [userId]
 */
export const markAuthWallConverted = (method = 'email', userId = null) => {
  const state = readAuthWallState();
  if (!state || state.trigger !== 'marking_submit' || state.outcomeFired) {
    return;
  }
  const timeOpenMs = Math.max(0, Date.now() - (Number(state.openedAt) || Date.now()));
  persistAuthWallState(null);

  trackFunnelEvent('auth_wall_converted', {
    type: 'funnel',
    trigger: 'marking_submit',
    method,
    timeOpenMs,
    preInspectSessionId: state.preInspectSessionId || null
  }, userId);
};

/**
 * @param {string} step
 * @param {string} code
 * @param {{ fallback?: string | null, preInspectSessionId?: string | null }} [options]
 */
export const markAuthWallGoogleError = (step = 'interstitial', code = 'unknown', options = {}) => {
  const state = readAuthWallState();
  const resolvedPreInspectSessionId =
    options?.preInspectSessionId || state?.preInspectSessionId || getLatestPreInspectSessionId() || null;

  trackFunnelEvent('auth_wall_google_error', {
    type: 'funnel',
    step,
    code: code || 'unknown',
    ...(options?.fallback ? { fallback: options.fallback } : {}),
    preInspectSessionId: resolvedPreInspectSessionId
  }, null);
};
