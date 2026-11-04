/**
 * Error type that carries an HTTP status code.
 *
 * Controllers and services throw these; `middleware/errorHandler.js` turns them
 * into a JSON response. This is why controllers do not need their own
 * try/catch blocks.
 */
export default class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }

  /**
   * Machine-readable conflict code (e.g. `DUPLICATE_RECORD`). Only set by the
   * factories below; the error handler exposes it to clients.
   */
  withCode(code) {
    this.code = code;
    return this;
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }

  static unsupportedMediaType(message = 'Unsupported media type') {
    return new ApiError(415, message);
  }

  static payloadTooLarge(message = 'Uploaded file is too large') {
    return new ApiError(413, message);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Resource already exists') {
    return new ApiError(409, message);
  }

  /** 409 for a record that already exists (offline sync: do not retry). */
  static duplicate(message = 'A matching record already exists', details) {
    return new ApiError(409, message, details).withCode('DUPLICATE_RECORD');
  }

  /** 409 for an optimistic-concurrency failure (record changed on the server). */
  static staleRevision(message = 'This record changed on the server', details) {
    return new ApiError(409, message, details).withCode('STALE_REVISION');
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }

  static unprocessable(message = 'Validation failed', details) {
    return new ApiError(422, message, details);
  }

  static notImplemented(message = 'Not implemented yet') {
    return new ApiError(501, message);
  }
}
