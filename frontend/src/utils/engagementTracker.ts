import API_CONFIG from '../config/api';

interface SessionEngagementState {
  sessionId: string;
  userId: string | null;
  totalPages: number;
  activeAccumulatedMs: number;
  lastActiveResumeAt: number | null;
  currentPageIndex: number;
  lastPageEnteredAt: number | null;
  pageDwellMs: Map<number, number>;
  openedSplitMode: boolean;
  questionNavClicks: number;
  summaryChipClicks: number;
  lastFlushedActiveMs: number;
  lastFlushedPagesCount: number;
  lastInteractionAt: number;
}

const IDLE_TIMEOUT_MS = 60000; // Pause timer if no scroll/click/key/touch for 60s

class EngagementTracker {
  private state: SessionEngagementState | null = null;
  private listenersBound = false;
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityEventAt = 0;

  private bindGlobalListeners() {
    if (this.listenersBound || typeof window === 'undefined') return;
    this.listenersBound = true;

    document.addEventListener('visibilitychange', () => {
      if (!this.state) return;
      if (document.visibilityState === 'hidden') {
        this.pauseTimers();
        this.flush('tab_hidden');
      } else {
        // Only resume if still on /app
        if (window.location.pathname.startsWith('/app')) {
          this.state.lastInteractionAt = Date.now();
          this.resumeTimers();
          this.scheduleMilestoneCheck();
        } else {
          this.stopSession('unmount');
        }
      }
    });

    window.addEventListener('pagehide', () => {
      if (this.state) {
        this.pauseTimers();
        this.flush('page_unload');
      }
    });

    const onUserActivity = () => {
      if (!this.state) return;
      const now = Date.now();
      if (now - this.lastActivityEventAt < 2000) return;
      this.lastActivityEventAt = now;
      this.state.lastInteractionAt = now;

      if (
        document.visibilityState === 'visible' &&
        window.location.pathname.startsWith('/app') &&
        this.state.lastActiveResumeAt === null
      ) {
        this.resumeTimers();
        this.scheduleMilestoneCheck();
      }
    };

    window.addEventListener('pointerdown', onUserActivity, { passive: true });
    window.addEventListener('keydown', onUserActivity, { passive: true });
    window.addEventListener('touchstart', onUserActivity, { passive: true });
    window.addEventListener('scroll', onUserActivity, { passive: true, capture: true });
  }

  private clearTimers() {
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
  }

  private scheduleMilestoneCheck() {
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    if (!this.state) return;

    // First milestone at 4s so newly marked sessions appear immediately in Admin Usage;
    // subsequent active checkpoints every 20s while actively reading.
    const delayMs = this.state.lastFlushedActiveMs === 0 ? 4000 : 20000;
    this.checkpointTimer = setTimeout(() => {
      if (!this.state) return;
      if (!window.location.pathname.startsWith('/app')) {
        this.stopSession('unmount');
        return;
      }
      if (document.visibilityState === 'visible') {
        this.flush('checkpoint');
        this.resumeTimers();
        this.scheduleMilestoneCheck();
      }
    }, delayMs);
  }

  private startIdleMonitor() {
    if (this.idleCheckTimer) clearInterval(this.idleCheckTimer);
    this.idleCheckTimer = setInterval(() => {
      if (!this.state) {
        this.clearTimers();
        return;
      }
      if (!window.location.pathname.startsWith('/app')) {
        this.stopSession('unmount');
        return;
      }
      const now = Date.now();
      if (
        this.state.lastActiveResumeAt !== null &&
        now - this.state.lastInteractionAt > IDLE_TIMEOUT_MS
      ) {
        // User has been idle for >60s: pause active timer and flush progress so far
        this.pauseTimers();
        this.flush('checkpoint');
      }
    }, 10000);
  }

  /**
   * Stop tracking the current session completely (e.g., when navigating to /admin,
   * starting a new upload, or switching to another user's session as Admin).
   */
  public stopSession(reason: 'session_switch' | 'unmount' = 'unmount') {
    if (!this.state) return;
    this.pauseTimers();
    this.flush(reason);
    this.clearTimers();
    this.state = null;
  }

  /**
   * Start tracking engagement when a marked session is rendered.
   * Strictly tracks ONLY if the viewer is the session owner.
   */
  public startSession(
    sessionId: string,
    userId: string | null,
    totalPages: number,
    sessionOwnerId?: string | null
  ) {
    // Do not track outside /app
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/app')) {
      this.stopSession('unmount');
      return;
    }

    // Strict owner check: if sessionOwnerId is known and does not match the current viewer,
    // immediately stop any previous session timer and do NOT start tracking this session.
    if (
      sessionOwnerId &&
      sessionOwnerId !== 'guest' &&
      sessionOwnerId !== 'anonymous' &&
      userId !== sessionOwnerId
    ) {
      this.stopSession('session_switch');
      return;
    }

    if (!sessionId || sessionId.startsWith('temp-') || totalPages <= 0) return;
    this.bindGlobalListeners();

    // If switching from a different session, flush and stop the previous one first
    if (this.state && this.state.sessionId !== sessionId) {
      this.stopSession('session_switch');
    }

    // If already tracking this exact session, update totalPages/userId and ensure timers are running
    if (this.state && this.state.sessionId === sessionId) {
      this.state.totalPages = Math.max(this.state.totalPages, totalPages);
      if (userId) this.state.userId = userId;
      if (document.visibilityState === 'visible') {
        this.resumeTimers();
      }
      return;
    }

    const now = Date.now();
    const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;

    this.state = {
      sessionId,
      userId: userId || null,
      totalPages,
      activeAccumulatedMs: 0,
      lastActiveResumeAt: isVisible ? now : null,
      currentPageIndex: 0,
      lastPageEnteredAt: isVisible ? now : null,
      pageDwellMs: new Map([[0, 0]]),
      openedSplitMode: false,
      questionNavClicks: 0,
      summaryChipClicks: 0,
      lastFlushedActiveMs: 0,
      lastFlushedPagesCount: 0,
      lastInteractionAt: now
    };

    this.scheduleMilestoneCheck();
    this.startIdleMonitor();
  }

  /**
   * Call when the user views a specific page index (0-based) in Gallery, Split Mode, or Modal
   */
  public recordPageView(pageIndex: number) {
    if (!this.state || pageIndex < 0) return;
    const now = Date.now();
    this.state.lastInteractionAt = now;

    if (this.state.lastPageEnteredAt !== null) {
      const elapsed = Math.max(0, now - this.state.lastPageEnteredAt);
      const prevDwell = this.state.pageDwellMs.get(this.state.currentPageIndex) || 0;
      this.state.pageDwellMs.set(this.state.currentPageIndex, prevDwell + elapsed);
    }

    const isNewPage = !this.state.pageDwellMs.has(pageIndex);
    this.state.currentPageIndex = pageIndex;
    if (isNewPage) {
      this.state.pageDwellMs.set(pageIndex, 0);
    }
    this.state.lastPageEnteredAt = document.visibilityState === 'visible' ? now : null;

    // If the user just navigated to a new page and at least 3s have passed since last flush, flush checkpoint
    if (isNewPage && this.state.pageDwellMs.size > this.state.lastFlushedPagesCount) {
      this.pauseTimers();
      this.flush('checkpoint');
      if (document.visibilityState === 'visible') {
        this.resumeTimers();
      }
    }
  }

  public recordSplitModeOpen(initialPageIndex: number = 0) {
    if (!this.state) return;
    this.state.openedSplitMode = true;
    this.recordPageView(initialPageIndex);
  }

  public recordQuestionNavigation(targetPageIndex?: number) {
    if (!this.state) return;
    this.state.questionNavClicks += 1;
    if (typeof targetPageIndex === 'number' && targetPageIndex >= 0) {
      this.recordPageView(targetPageIndex);
    }
  }

  public recordSummaryChipClick() {
    if (!this.state) return;
    this.state.summaryChipClicks += 1;
  }

  private pauseTimers() {
    if (!this.state) return;
    const now = Date.now();

    if (this.state.lastActiveResumeAt !== null) {
      // Cap single uninterrupted slice to IDLE_TIMEOUT_MS so background sleep/wake never inflates time
      const rawDelta = Math.max(0, now - this.state.lastActiveResumeAt);
      const cappedDelta = Math.min(rawDelta, IDLE_TIMEOUT_MS + 15000);
      this.state.activeAccumulatedMs += cappedDelta;
      this.state.lastActiveResumeAt = null;
    }

    if (this.state.lastPageEnteredAt !== null) {
      const rawElapsed = Math.max(0, now - this.state.lastPageEnteredAt);
      const cappedElapsed = Math.min(rawElapsed, IDLE_TIMEOUT_MS + 15000);
      const prevDwell = this.state.pageDwellMs.get(this.state.currentPageIndex) || 0;
      this.state.pageDwellMs.set(this.state.currentPageIndex, prevDwell + cappedElapsed);
      this.state.lastPageEnteredAt = null;
    }
  }

  private resumeTimers() {
    if (!this.state) return;
    const now = Date.now();
    if (this.state.lastActiveResumeAt === null) {
      this.state.lastActiveResumeAt = now;
    }
    if (this.state.lastPageEnteredAt === null) {
      this.state.lastPageEnteredAt = now;
    }
  }

  /**
   * Flush cumulative engagement summary to backend
   */
  public flush(
    reason: 'tab_hidden' | 'page_unload' | 'session_switch' | 'unmount' | 'checkpoint' = 'unmount'
  ) {
    if (!this.state) return;
    this.pauseTimers();

    const isFirstFlush = this.state.lastFlushedActiveMs === 0;
    const hasNewPages = this.state.pageDwellMs.size > this.state.lastFlushedPagesCount;

    // For the very first flush of a session, flush after >= 1s so short visits on Safari are captured.
    // For subsequent tab_hidden events, require 10s delta to debounce rapid Alt+Tab switching.
    const minDeltaMs = isFirstFlush
      ? 1000
      : hasNewPages
      ? 2000
      : reason === 'tab_hidden' || reason === 'checkpoint'
      ? 10000
      : 2000;

    if (this.state.activeAccumulatedMs - this.state.lastFlushedActiveMs < minDeltaMs && !hasNewPages) {
      return;
    }

    this.state.lastFlushedActiveMs = this.state.activeAccumulatedMs;
    this.state.lastFlushedPagesCount = this.state.pageDwellMs.size;
    const totalActiveSec = Math.round((this.state.activeAccumulatedMs / 1000) * 10) / 10;
    if (totalActiveSec <= 0) return;

    const pageDwellSec: Record<string, number> = {};
    let pagesWithMeaningfulView = 0;

    Array.from(this.state.pageDwellMs.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([pageIdx, ms]) => {
        const sec = Math.round((ms / 1000) * 10) / 10;
        pageDwellSec[`p${pageIdx + 1}`] = sec;
        if (sec >= 1.0 || pageIdx === 0) {
          pagesWithMeaningfulView++;
        }
      });

    const uniquePagesViewed = Math.max(1, pagesWithMeaningfulView);
    const totalPages = Math.max(1, this.state.totalPages);
    const coveragePct = Math.min(100, Math.round((uniquePagesViewed / totalPages) * 100));

    let anonymousId = 'unknown';
    try {
      anonymousId = localStorage.getItem('aimarking_anon_id') || 'unknown';
    } catch (_) {}

    const payload = {
      event: 'marking_engagement_summary',
      userId: this.state.userId || 'guest',
      anonymousId,
      path: window.location.pathname,
      timestamp: new Date().toISOString(),
      sessionId: this.state.sessionId,
      flushReason: reason,
      totalActiveSec,
      totalPages,
      uniquePagesViewed,
      coveragePct,
      viewedAllPages: uniquePagesViewed >= totalPages,
      openedSplitMode: this.state.openedSplitMode,
      questionNavClicks: this.state.questionNavClicks,
      summaryChipClicks: this.state.summaryChipClicks,
      pageDwellSec
    };

    const url = `${API_CONFIG?.BASE_URL || ''}/api/config/telemetry`;
    const bodyStr = JSON.stringify(payload);

    try {
      // Use text/plain for sendBeacon so cross-origin requests in Safari/WebKit
      // are CORS-safelisted simple requests (no OPTIONS preflight drop on unload/hide).
      if (navigator.sendBeacon && (reason === 'page_unload' || reason === 'tab_hidden')) {
        const blob = new Blob([bodyStr], { type: 'text/plain;charset=UTF-8' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: bodyStr,
          keepalive: true
        }).catch(() => {});
      }
    } catch (_) {}
  }
}

export const engagementTracker = new EngagementTracker();
export default engagementTracker;
