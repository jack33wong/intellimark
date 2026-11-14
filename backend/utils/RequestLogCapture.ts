import { AsyncLocalStorage } from 'node:async_hooks';
import { formatWithOptions } from 'node:util';

interface LogStore {
  submissionId: string;
  lines: string[];
  totalChars: number;
  truncated: boolean;
  startedAt: number;
}

export interface CapturedLogResult {
  logsText: string;
  lineCount: number;
  durationMs: number;
  truncated: boolean;
}

const MAX_LINES = 5000;
const MAX_CHARS = 2 * 1024 * 1024; // 2 MB cap per request

const logStorage = new AsyncLocalStorage<LogStore>();
let isInstalled = false;

function appendToActiveStore(level: 'LOG' | 'INFO' | 'WARN' | 'ERROR', args: any[]): void {
  const store = logStorage.getStore();
  if (!store || store.truncated) return;

  const timestamp = new Date().toISOString();
  const formatted = formatWithOptions({ depth: 3, maxStringLength: 1000, colors: false }, ...args);
  const entry = `[${timestamp}] [${level}] ${formatted}`;

  if (store.lines.length >= MAX_LINES || store.totalChars + entry.length > MAX_CHARS) {
    store.lines.push(`[${timestamp}] [WARN] --- Log capture truncated (exceeded ${MAX_LINES} lines or 2MB limit) ---`);
    store.truncated = true;
    return;
  }

  store.lines.push(entry);
  store.totalChars += entry.length + 1;
}

/**
 * Installs a lightweight, idempotent console interceptor so logs emitted inside
 * `runWithLogCapture` are isolated per async request via AsyncLocalStorage.
 */
export function ensureLogCaptureInstalled(): void {
  if (isInstalled) return;
  isInstalled = true;

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: any[]) => {
    appendToActiveStore('LOG', args);
    origLog(...args);
  };
  console.info = (...args: any[]) => {
    appendToActiveStore('INFO', args);
    origInfo(...args);
  };
  console.warn = (...args: any[]) => {
    appendToActiveStore('WARN', args);
    origWarn(...args);
  };
  console.error = (...args: any[]) => {
    appendToActiveStore('ERROR', args);
    origError(...args);
  };
}

/**
 * Executes an async marking function with isolated per-request console log capture.
 * Invokes `onFinish` in `finally` with the captured log text and duration.
 */
export async function runWithLogCapture<T>(
  submissionId: string,
  fn: () => Promise<T>,
  onFinish?: (captured: CapturedLogResult) => void | Promise<void>
): Promise<T> {
  ensureLogCaptureInstalled();

  const store: LogStore = {
    submissionId,
    lines: [],
    totalChars: 0,
    truncated: false,
    startedAt: Date.now(),
  };

  return logStorage.run(store, async () => {
    try {
      return await fn();
    } finally {
      if (onFinish) {
        const durationMs = Date.now() - store.startedAt;
        const logsText = store.lines.join('\n');
        await onFinish({
          logsText,
          lineCount: store.lines.length,
          durationMs,
          truncated: store.truncated,
        });
      }
    }
  });
}
