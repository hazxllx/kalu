import ApiError from '../utils/apiError.js';

/**
 * Lightweight validation middleware factory.
 *
 * Accepts a validator function that receives the chosen request part (body by
 * default) and returns either `{ value }` on success or `{ error }` on failure.
 * This keeps controllers free of input-shape checks and gives a consistent 400
 * response. It is intentionally schema-library-agnostic: a validator can be a
 * plain function now and a zod/joi schema wrapper later.
 *
 *   router.post('/', validate(createResidentValidator), controller.create);
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
