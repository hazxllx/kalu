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

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
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

  static notImplemented(message = 'Not implemented yet') {
    return new ApiError(501, message);
  }
}
