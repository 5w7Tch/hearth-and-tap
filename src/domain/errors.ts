const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_LATE_TO_CANCEL: 409,
  INVALID_POSTCODE: 422,
  OUT_OF_AREA: 422,
  INVALID_WINDOW: 422,
  NOT_EMERGENCY_ELIGIBLE: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  INTERNAL_ERROR: 500,
  UPSTREAM_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

/** An expected, customer-explainable failure. Anything else is a bug and surfaces as INTERNAL_ERROR. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: (typeof STATUS_BY_CODE)[ErrorCode];

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
