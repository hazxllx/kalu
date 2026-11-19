/**
 * @module utils/apiResponse
 * @description Standard HTTP JSON response envelope helpers for KALUSAGAP controllers.
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> controller -> service -> repository/Supabase`
 *
 * Controllers invoke these helpers after a service completes to serialize payloads
 * into a predictable envelope that mirrors the error structure produced by
 * `middleware/errorHandler.js`:
 *   `{ "data": <payload>, "meta": <optional> }`
 *
 * Centralizing response formatting guarantees every API endpoint exposes a
 * consistent contract for the frontend API client and offline sync layer.
 */

/**
 * Sends a JSON success response wrapped in `{ data, meta? }`.
 * Omits the `meta` key entirely when `meta` is undefined or falsy.
 *
 * @param {Object} res - Express response object.
 * @param {*} data - Primary response payload returned by the service layer.
 * @param {Object} [options={}] - Optional response metadata and status override.
 * @param {number} [options.status=200] - HTTP status code to send.
 * @param {Object} [options.meta] - Optional pagination, filter, or sync metadata.
 * @returns {Object} Express response instance.
 */
export const sendData = (res, data, { status = 200, meta } = {}) =>
  res.status(status).json({ data, ...(meta ? { meta } : {}) });

/**
 * Sends a `201 Created` JSON response wrapped in `{ data, meta? }` after
 * creating a new domain record.
 *
 * @param {Object} res - Express response object.
 * @param {*} data - Newly created resource payload.
 * @param {Object} [meta] - Optional response metadata.
 * @returns {Object} Express response instance.
 */
export const sendCreated = (res, data, meta) => sendData(res, data, { status: 201, meta });

/**
 * Sends an empty `204 No Content` response for deletions or acknowledgements
 * that return no response body.
 *
 * @param {Object} res - Express response object.
 * @returns {Object} Express response instance.
 */
export const sendNoContent = (res) => res.status(204).send();

export default { sendData, sendCreated, sendNoContent };
