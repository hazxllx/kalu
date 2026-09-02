/**
 * Wraps an async route handler so a rejected promise reaches Express'
 * error pipeline instead of hanging the request.
 *
 *   router.get('/', asyncHandler(residentsController.list));
 */
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export default asyncHandler;
