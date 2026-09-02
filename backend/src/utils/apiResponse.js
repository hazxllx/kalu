/**
 * Standard JSON response helpers.
 *
 * Success shape (mirrors the error shape in `middleware/errorHandler.js`):
 *   { "data": <payload>, "meta": <optional> }
 *
 * Keeping one place for success formatting means every endpoint returns a
 * predictable envelope, so the frontend API layer can unwrap it consistently.
 */
export const sendData = (res, data, { status = 200, meta } = {}) =>
  res.status(status).json({ data, ...(meta ? { meta } : {}) });

export const sendCreated = (res, data, meta) => sendData(res, data, { status: 201, meta });

export const sendNoContent = (res) => res.status(204).send();

export default { sendData, sendCreated, sendNoContent };
