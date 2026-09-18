import env from '../config/env.js';

/**
 * Centralized error handler — the last middleware registered in `app.js`.
 *
 * Every controller and service reports failures by throwing (see
 * `utils/apiError.js`) or by rejecting inside `utils/asyncHandler.js`, so error
 * formatting lives here instead of being repeated in every controller.
 *
 * Response shape is stable for the frontend:
 *   { "error": { "message": "...", "details": ... } }
 *
 * Unexpected errors return a generic message in production: internal messages
 * can leak table names, file paths, and patient data.
 */
// eslint-disable-next-line no-unused-vars -- Express requires the 4-arg signature
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    console.error(`Unhandled error on ${req.method} ${req.path}:`, err.message);
    if (!env.isProduction && err.stack) console.error(err.stack);
  }

  const message = isServerError && env.isProduction
    ? 'Something went wrong. Please try again later.'
    : err.message || 'Unexpected error';

  // `details` is the legacy field-errors carrier (kept for existing clients).
  // When it is a plain object of field -> message we also expose it as
  // `errors`, which is the documented validation shape. Arrays of messages
  // (service-level domain validation) remain under `details` only.
  const isFieldErrorMap =
    err.details && typeof err.details === 'object' && !Array.isArray(err.details);

  res.status(statusCode).json({
    error: {
      message,
      ...(err.details ? { details: err.details } : {}),
      ...(isFieldErrorMap ? { errors: err.details } : {}),
    },
  });
};

export default errorHandler;
