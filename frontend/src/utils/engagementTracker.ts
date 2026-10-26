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
}

class EngagementTracker {
  private state: SessionEngagementState | null = null;
  private listenersBound = false;

  private bindGlobalListeners() {
    if (this.listenersBound || typeof window === 'undefined') return;
    this.listenersBound = true;

    document.addEventListener('visibilitychange', () => {
      if (!this.state) return;
      if (document.visibilityState === 'hidden') {
        this.pauseTimers();
        this.flush('tab_hidden');
      } else {
        this.resumeTimers();
      }
    });

    window.addEventListener('pagehide', () => {
      if (this.state) {
        this.pauseTimers();
        this.flush('page_unload');
      }
    });
  }

  /**
   * Start tracking engagement when a marked session with annotated images is rendered.
   * Only tracks if the viewer is the session owner (ignores Admin / other users viewing shared or user history).
   */
  public startSession(
    sessionId: string,
    userId: string | null,
    totalPages: number,
    sessionOwnerId?: string | null
  ) {
    // If a known sessionOwnerId exists and does not match the current viewer, stop tracking
    if (
      sessionOwnerId &&
      sessionOwnerId !== 'guest' &&
      sessionOwnerId !== 'anonymous' &&
      userId !== sessionOwnerId
    ) {
      if (this.state) {
        this.pauseTimers();
        this.flush('session_switch');
        this.state = null;
      }
      return;
    }

    if (!sessionId || sessionId.startsWith('temp-') || totalPages <= 0) return;
    this.bindGlobalListeners();

    // If switching from a different session, flush the previous one first
    if (this.state && this.state.sessionId !== sessionId) {
      this.pauseTimers();
      this.flush('session_switch');
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
      lastFlushedActiveMs: 0
    };
  }

  /**
   * Call when the user views a specific page index (0-based) in Gallery, Split Mode, or Modal
   */
  public recordPageView(pageIndex: number) {
    if (!this.state || pageIndex < 0) return;
    const now = Date.now();

    if (this.state.lastPageEnteredAt !== null) {
      const elapsed = Math.max(0, now - this.state.lastPageEnteredAt);
      const prevDwell = this.state.pageDwellMs.get(this.state.currentPageIndex) || 0;
      this.state.pageDwellMs.set(this.state.currentPageIndex, prevDwell + elapsed);
    }

    this.state.currentPageIndex = pageIndex;
    if (!this.state.pageDwellMs.has(pageIndex)) {
      this.state.pageDwellMs.set(pageIndex, 0);
    }
    this.state.lastPageEnteredAt = document.visibilityState === 'visible' ? now : null;
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
      this.state.activeAccumulatedMs += Math.max(0, now - this.state.lastActiveResumeAt);
      this.state.lastActiveResumeAt = null;
    }

    if (this.state.lastPageEnteredAt !== null) {
      const elapsed = Math.max(0, now - this.state.lastPageEnteredAt);
      const prevDwell = this.state.pageDwellMs.get(this.state.currentPageIndex) || 0;
      this.state.pageDwellMs.set(this.state.currentPageIndex, prevDwell + elapsed);
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
  public flush(reason: 'tab_hidden' | 'page_unload' | 'session_switch' | 'unmount' = 'unmount') {
    if (!this.state) return;
    this.pauseTimers();

    // Only flush if sufficient new active time has accumulated since last flush
    // (10s debounce for tab_hidden to prevent rapid Alt+Tab Firestore writes; 2s for unload/session_switch)
    const minDeltaMs = reason === 'tab_hidden' ? 10000 : 2000;
    if (this.state.activeAccumulatedMs - this.state.lastFlushedActiveMs < minDeltaMs) {
      return;
    }

    this.state.lastFlushedActiveMs = this.state.activeAccumulatedMs;
    const totalActiveSec = Math.round((this.state.activeAccumulatedMs / 1000) * 10) / 10;

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
      if (navigator.sendBeacon) {
        const blob = new Blob([bodyStr], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          keepalive: true
        }).catch(() => {});
      }
    } catch (_) {}
  }
}

export const engagementTracker = new EngagementTracker();
export default engagementTracker;
