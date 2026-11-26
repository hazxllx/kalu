// backend/src/validators/advisories.validators.js
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateId = (params = {}) => {
  const id = String(params.id || '').trim();
  return UUID_PATTERN.test(id)
    ? { value: { ...params, id } }
    : { error: { id: 'A valid advisory ID is required.' } };
};

const validateAdvisory = (body = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { body: 'An advisory object is required.' } };
  }
  const errors = {};
  const title = body.title == null ? null : typeof body.title === 'string' ? body.title.trim() : null;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const isActive = body.isActive === undefined ? true : body.isActive;
  const displayOrder = body.displayOrder === undefined ? 0 : body.displayOrder;

  if (!message) errors.message = 'An advisory message is required.';
  else if (message.length > 5000) errors.message = 'The advisory message must be 5,000 characters or fewer.';
  if (body.title != null && typeof body.title !== 'string') errors.title = 'The title must be text.';
  if (title !== null && title.length > 160) errors.title = 'The title must be 160 characters or fewer.';
  if (typeof isActive !== 'boolean') errors.isActive = 'Status must be active or inactive.';
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    errors.displayOrder = 'Display order must be a non-negative whole number.';
  }

  return Object.keys(errors).length
    ? { error: errors }
    : { value: { title: title || null, message, isActive, displayOrder } };
};

const validateStatus = (body = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { body: 'An advisory status object is required.' } };
  }
  return typeof body.isActive === 'boolean'
    ? { value: { isActive: body.isActive } }
    : { error: { isActive: 'Status must be active or inactive.' } };
};

export { validateAdvisory, validateId, validateStatus };
