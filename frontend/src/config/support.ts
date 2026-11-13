/**
 * Support email configuration.
 * Configurable via REACT_APP_SUPPORT_EMAIL in frontend/.env.local
 */
export const SUPPORT_EMAIL: string =
  process.env.REACT_APP_SUPPORT_EMAIL || 'support@aimarking.ai';

export interface SupportMailtoOptions {
  subject?: string;
  userEmail?: string | null;
  context?: string;
}

/**
 * Builds a pre-filled mailto: link so users can email support with account/session context.
 */
export const getSupportMailto = (options?: SupportMailtoOptions): string => {
  const subject = encodeURIComponent(options?.subject || 'AI Marking Support');
  const lines: string[] = [];
  if (options?.userEmail) {
    lines.push(`Account Email: ${options.userEmail}`);
  }
  if (options?.context) {
    lines.push(options.context);
  }
  lines.push('Issue / Question:');
  const body = encodeURIComponent(lines.join('\n') + '\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
};
