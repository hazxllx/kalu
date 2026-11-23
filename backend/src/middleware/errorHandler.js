import env from '../config/env.js';

/**
 * @module middleware/errorHandler
 *
 * Centralized Express error-handling middleware for KALUSAGAP — registered last
 * in `app.js` at the end of the pipeline:
 *   `route -> authenticate -> authorize -> controller -> service -> repository/Supabase -> errorHandler`
 *
 * Every middleware, controller, and service reports failures by throwing an
 * `ApiError` (see `utils/apiError.js`) or rejecting inside `utils/asyncHandler.js`,
 * keeping HTTP error serialization consistent across the entire backend.
 *
 * Stable JSON response envelope returned to the frontend:
 *   `{ "error": { "message": "...", "code"?: "...", "details"?: ..., "errors"?: ... } }`
 *
 * Security & privacy guarantees:
 *   - Unexpected 5xx errors return a generic message in production so internal
 *     database errors, table names, stack traces, file paths, and patient health
 *     information (PHI) are never leaked to clients.
 *   - Server errors log `req.requestId` (assigned by `requestLogger`) for log
 *     correlation without logging request bodies or headers.
 *   - Only application-defined uppercase machine codes (`^[A-Z][A-Z0-9_]+$`) are
 *     exposed; low-level Postgres/driver codes (e.g. `'23505'`) stay private.
 */

/**
 * Formats operational (`ApiError`) and unhandled errors into KALUSAGAP's standard
 * JSON error response.
 *
 * @param {Object} err - Thrown error or `ApiError` instance.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback (required 4-argument signature).
 */
// eslint-disable-next-line no-unused-vars -- Express requires the 4-arg signature
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;
  const clinicalRequest = /(?:^|\/)(?:intake|phn)(?:\/|$)/.test(req.path || '');

  if (clinicalRequest) {
    // Database error messages and URL identifiers can contain clinical data.
    // Keep operational correlation without logging values, paths, or stacks.
    const code = typeof err.code === 'string' && /^[A-Z0-9_]+$/.test(err.code) ? err.code : 'REQUEST_FAILED';
    if (isServerError) console.error(`[requestId=${req.requestId || 'unknown'}] Clinical request failed`, { method: req.method, statusCode, code });
  } else if (isServerError) {
    console.error(`[requestId=${req.requestId || 'unknown'}] Unhandled error on ${req.method} ${req.path}:`, err.message);
    if (!env.isProduction && err.stack) console.error(err.stack);
  } else if (!env.isProduction) {
    // Client errors (4xx) are silent in production, but during development we
    // log the real message and any field details so a 400/409 during flows
    // like registration can be diagnosed instead of appearing as an opaque
    // "Request failed with status 400" in the browser.
    console.warn(
      `Client error ${statusCode} on ${req.method} ${req.path}:`,
      err.message,
      err.details ? JSON.stringify(err.details) : '',
    );
  }

  const message = clinicalRequest && isServerError
    ? 'The clinical operation could not be confirmed. Your entries are still available; retry using the same form.'
    : isServerError && env.isProduction && err.code !== 'ACCOUNT_CREATED_EMAIL_FAILED'
    ? 'Something went wrong. Please try again later.'
    : err.message || 'Unexpected error';

  // `details` is the legacy field-errors carrier (kept for existing clients).
  // When it is a plain object of field -> message we also expose it as
  // `errors`, which is the documented validation shape. Arrays of messages
  // (service-level domain validation) remain under `details` only.
  const isFieldErrorMap =
    !isServerError && err.details && typeof err.details === 'object' && !Array.isArray(err.details);

  // Only app-level machine codes (DUPLICATE_RECORD, STALE_REVISION, ...) are
  // exposed. Database driver codes such as '23505' never match this pattern.
  const hasPublicCode =
    typeof err.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(err.code);

  res.status(statusCode).json({
    error: {
      message,
      ...(hasPublicCode ? { code: err.code } : {}),
      ...(!isServerError && err.details ? { details: err.details } : {}),
      ...(isFieldErrorMap ? { errors: err.details } : {}),
    },
  });
};

export default errorHandler;
