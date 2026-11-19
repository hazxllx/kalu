import ApiError from '../utils/apiError.js';

/**
 * @module middleware/validate
 *
 * Request-input validation and sanitization middleware factory for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> [authenticate -> authorize] -> validate(validator, part) -> controller -> service -> repository/Supabase`
 *
 * Accepts a validator function receiving `(req[part], req)` and returning either
 * `{ value }` on success (replacing `req[part]` with normalized/coerced input)
 * or `{ error }` on failure (forwarded as a 400 `ApiError.badRequest` whose
 * field errors are formatted under `details` / `errors` by `errorHandler`).
 * Intentionally schema-library-agnostic so plain JS validators and schema
 * wrappers share the same contract:
 *
 *   router.post('/', validate(createResidentValidator), controller.create);
 */

/**
 * Creates an Express middleware that validates and normalizes `req[part]`.
 *
 * @param {Function} validator - Validator `(input, req) => { value?, error? }`.
 * @param {string} [part='body'] - Request property to validate (`'body'`, `'query'`, `'params'`).
 * @returns {Function} Express middleware `(req, res, next)`.
 */
const validate = (validator, part = 'body') => (req, res, next) => {
  try {
    const result = validator(req[part], req);
    if (result && result.error) {
      return next(ApiError.badRequest('Validation failed', result.error));
    }
    if (result && 'value' in result) {
      req[part] = result.value;
    }
    return next();
  } catch (err) {
    return next(ApiError.badRequest(err.message || 'Validation failed'));
  }
};

export default validate;
