import "server-only";

/** Error codes and their default HTTP status (design 6.3). */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  REVIEW_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ALREADY_PURCHASED: 409,
  INVALID_STATE: 409,
  INCOMPATIBLE_REQUEST: 409,
  OFFER_NOT_PURCHASABLE: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYPAL_INSTRUMENT_DECLINED: 422,
  PAYPAL_CAPTURE_DECLINED: 422,
  REFUND_NOT_ELIGIBLE: 422,
  PAYPAL_REFUND_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PAYPAL_UNAVAILABLE: 502,
  PAYPAL_CAPTURE_MISMATCH: 502,
  PAYPAL_NOT_CONFIGURED: 503,
  WEBHOOK_NOT_CONFIGURED: 503,
  AI_UNAVAILABLE: 503,
  WEBHOOK_VERIFICATION_FAILED: 400,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: "The request is invalid.",
  UNAUTHENTICATED: "Sign in to continue.",
  FORBIDDEN: "You do not have permission to do this.",
  NOT_FOUND: "Not found.",
  RATE_LIMITED: "Too many requests. Try again later.",
  INTERNAL_ERROR: "Something went wrong.",
};

export type AppErrorOptions = {
  /** Whether `message`/`details` may be shown to the client. Defaults to true; unknown errors are wrapped with false. */
  expose?: boolean;
  details?: unknown;
  cause?: unknown;
  headers?: Record<string, string>;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expose: boolean;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, status: number = ERROR_STATUS[code], message?: string, options: AppErrorOptions = {}) {
    super(message ?? DEFAULT_MESSAGES[code] ?? code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.expose = options.expose ?? true;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export type ErrorEnvelope = { error: { code: string; message: string; details?: unknown } };

export function errorEnvelope(error: AppError): ErrorEnvelope {
  const message = error.expose ? error.message : (DEFAULT_MESSAGES.INTERNAL_ERROR as string);
  return {
    error: {
      code: error.code,
      message,
      ...(error.details !== undefined && error.expose ? { details: error.details } : {}),
    },
  };
}
