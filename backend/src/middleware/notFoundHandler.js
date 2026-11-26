// backend/src/middleware/notFoundHandler.js
import ApiError from '../utils/apiError.js';

/**
 * @module middleware/notFoundHandler
 *
 * Fallback 404 middleware for KALUSAGAP — registered in `app.js` after all
 * `/api/...` route mounts and immediately before `errorHandler`:
 *   `route (no match) -> notFoundHandler -> errorHandler`
 *
 * Forwards an `ApiError.notFound` (404) so unmatched HTTP methods or paths
 * return the exact same `{ error: { message } }` JSON envelope as domain errors.
 */

/**
 * Forwards a 404 `ApiError` for any unmatched Express route.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
};

export default notFoundHandler;
