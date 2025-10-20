import type { Response } from 'express';

/**
 * Write a single SSE event. If isFinal is true, the caller should close the connection afterwards
 * using closeSseConnection. This helper does NOT end the response.
 */
export function sendSseUpdate(res: Response, data: any, isFinal: boolean = false): void {
  try {
    if (res.writableEnded) {
      console.warn('Attempted to write SSE after response ended. Skipping.');
      return;
    }
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
    // If compression or certain proxies are in play, flush helps. It is safe to check.
    const anyRes = res as any;
    if (typeof anyRes.flush === 'function') {
      try { anyRes.flush(); } catch {}
    }
  } catch (error) {
    console.error('SSE write error:', error);
  }
}

/** Safely closes the SSE connection (ends the HTTP response). */
export function closeSseConnection(res: Response): void {
  try {
    if (!res.writableEnded) {
      res.end();
    }
  } catch (error) {
    console.error('Failed to close SSE connection:', error);
  }
}


