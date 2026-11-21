/**
 * Unexpected failures. Each subclass has a stable `code` that callers and
 * logs can branch on; `message` is for humans and may change.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  /** HTTP status the web boundary should use when this error escapes a route. */
  readonly httpStatus: number = 500;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly code = "validation_failed";
  override readonly httpStatus = 400;
  constructor(
    message: string,
    readonly issues: ReadonlyArray<{ path: string; message: string }> = [],
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = "not_found";
  override readonly httpStatus = 404;
}

export class UnauthorizedError extends AppError {
  readonly code = "unauthorized";
  override readonly httpStatus = 401;
}

export class ForbiddenError extends AppError {
  readonly code = "forbidden";
  override readonly httpStatus = 403;
}

export class ConflictError extends AppError {
  readonly code = "conflict";
  override readonly httpStatus = 409;
}

export class RateLimitedError extends AppError {
  readonly code = "rate_limited";
  override readonly httpStatus = 429;
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** A dependency (Spotify, Ticketmaster, the database) failed in a way we can't recover from here. */
export class UpstreamError extends AppError {
  readonly code = "upstream_failed";
  override readonly httpStatus = 502;
  constructor(
    readonly upstream: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
