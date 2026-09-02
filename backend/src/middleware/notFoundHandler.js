import ApiError from '../utils/apiError.js';

/**
 * Catches any request that matched no route and hands a 404 to the error
 * handler, so unknown paths return the same JSON shape as every other error.
 */
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
};

export default notFoundHandler;
