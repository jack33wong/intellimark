export type ErrorCategory = 'user_fixable' | 'system';

export type UserErrorCode =
  | 'PDF_UNREADABLE'
  | 'PDF_PAGE_LIMIT_EXCEEDED'
  | 'PDF_OVERSIZED_PAGE'
  | 'PDF_CONTINUOUS_PAGE'
  | 'PDF_TOO_BLURRY'
  | 'SYSTEM_ERROR';

export interface UserFacingErrorOptions {
  code: UserErrorCode;
  category: ErrorCategory;
  userMessage: string;
  technicalMessage?: string;
  shouldAlertAdmin?: boolean;
}

/**
 * Standardized error for surfacing plain-language, actionable messages in the UI
 * without leaking internal stack traces or file paths.
 */
export class UserFacingError extends Error {
  public readonly code: UserErrorCode;
  public readonly category: ErrorCategory;
  public readonly userMessage: string;
  public readonly shouldAlertAdmin: boolean;

  constructor(options: UserFacingErrorOptions) {
    super(options.technicalMessage || options.userMessage);
    this.name = 'UserFacingError';
    this.code = options.code;
    this.category = options.category;
    this.userMessage = options.userMessage;
    this.shouldAlertAdmin = options.shouldAlertAdmin ?? options.category === 'system';
    Object.setPrototypeOf(this, UserFacingError.prototype);
  }
}
