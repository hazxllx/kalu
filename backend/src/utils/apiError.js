/**
 * @module utils/apiError
 *
 * Operational HTTP error class used across KALUSAGAP middleware, controllers,
 * and services:
 *   `middleware / controller / service -> throw ApiError -> asyncHandler -> middleware/errorHandler`
 *
 * Carries an HTTP `statusCode`, a client-safe `message`, optional validation or
 * conflict `details` (field-error map exposed as `errors` + `details`, or domain
 * message array exposed as `details`), and an optional uppercase machine-readable
 * `code` (e.g. `DUPLICATE_RECORD`, `STALE_REVISION`, `PASSWORD_CHANGE_REQUIRED`,
 * `TEMPORARY_PASSWORD_EXPIRED`, `IDEMPOTENCY_KEY_REQUIRED`) so controllers never
 * need boilerplate `try / catch` blocks.
 */
export default class ApiError extends Error {
  /**
   * Constructs an operational API error with an explicit HTTP status code.
   *
   * @param {number} statusCode - HTTP response status code (e.g. 400, 401, 403, 404, 409, 503).
   * @param {string} message - Human-readable error message.
   * @param {*} [details] - Optional field-error map or domain validation details.
   */
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }

  /**
   * Attaches an uppercase machine-readable error code (e.g. `DUPLICATE_RECORD`,
   * `STALE_REVISION`, `PASSWORD_CHANGE_REQUIRED`). `middleware/errorHandler.js`
   * exposes codes matching `^[A-Z][A-Z0-9_]+$` to clients while keeping raw
   * database driver codes private.
   *
   * @param {string} code - Uppercase snake_case machine error code.
   * @returns {ApiError} This `ApiError` instance for fluent chaining.
   */
  withCode(code) {
    this.code = code;
    return this;
  }

  /** 400 Bad Request — malformed syntax, invalid parameters, or field validation errors. */
  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }

  /** 415 Unsupported Media Type — disallowed MIME type or mismatched file magic bytes. */
  static unsupportedMediaType(message = 'Unsupported media type') {
    return new ApiError(415, message);
  }

  /** 413 Payload Too Large — uploaded file exceeds configured byte size limit. */
  static payloadTooLarge(message = 'Uploaded file is too large') {
    return new ApiError(413, message);
  }

  /** 401 Unauthorized — missing, invalid, or expired Bearer session token. */
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  /** 403 Forbidden — authenticated caller lacks required role, permission, station, or barangay scope. */
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, message);
  }

  /** 404 Not Found — target route or scoped domain record does not exist. */
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  /** 409 Conflict — generic state conflict (e.g. reused idempotency key with different payload). */
  static conflict(message = 'Resource already exists') {
    return new ApiError(409, message);
  }

  /** 409 Conflict (`DUPLICATE_RECORD`) — matching record already exists; offline sync clients must not auto-retry. */
  static duplicate(message = 'A matching record already exists', details) {
    return new ApiError(409, message, details).withCode('DUPLICATE_RECORD');
  }

  /** 409 Conflict (`STALE_REVISION`) — optimistic-concurrency mismatch (`If-Match` / revision changed on server). */
  static staleRevision(message = 'This record changed on the server', details) {
    return new ApiError(409, message, details).withCode('STALE_REVISION');
  }

  /** 429 Too Many Requests — caller or upstream auth verification exceeded rate limits. */
  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }

  /** 422 Unprocessable Entity — syntactically valid payload failing semantic domain rules. */
  static unprocessable(message = 'Validation failed', details) {
    return new ApiError(422, message, details);
  }

  /** 501 Not Implemented — placeholder endpoint or unsupported capability. */
  static notImplemented(message = 'Not implemented yet') {
    return new ApiError(501, message);
  }
}
