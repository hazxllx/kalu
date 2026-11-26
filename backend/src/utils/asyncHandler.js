// backend/src/utils/asyncHandler.js
/**
 * @module utils/asyncHandler
 * @description Express promise-rejection bridge for asynchronous middleware and controllers.
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> controller -> service -> repository/Supabase`
 *
 * Express 4 does not automatically forward rejected promises from `async` route
 * handlers. Wrapping controllers (or async middleware) with `asyncHandler` ensures
 * any thrown `ApiError`, validation failure, or Supabase/repository exception is
 * passed to `next(err)` and formatted by `middleware/errorHandler.js` rather than
 * leaving the HTTP request hanging or crashing the process with an unhandled rejection.
 *
 * @example
 *   router.get('/', authenticate, authorize(roles), asyncHandler(residentsController.list));
 *
 * @param {Function} handler - Async or synchronous Express handler `(req, res, next) => Promise<*> | *`.
 * @returns {Function} Wrapped Express middleware function `(req, res, next) => void`.
 */
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export default asyncHandler;
