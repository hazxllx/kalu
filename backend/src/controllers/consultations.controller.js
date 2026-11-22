/**
 * Consultation endpoints for authorized health staff.
 *
 * Handles consultation creation, retrieval, listing with filters, and updates.
 * Authorization and scope enforcement are performed in the service layer.
 * Consultation vitals are validated server-side to prevent malformed clinical data.
 */
import * as consultationsService from '../services/consultations.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import ApiError from '../utils/apiError.js';

/**
 * List consultations with optional filters.
 *
 * Accepts date range (from/to), health service ID, and consultation status filters.
 * All filters are validated server-side before querying to provide clear error
 * messages instead of silently ignoring invalid values.
 *
 * @param {object} req.query
 *   - from: ISO date string (YYYY-MM-DD) for start of date range
 *   - to: ISO date string (YYYY-MM-DD) for end of date range
 *   - serviceId / service_id: UUID of health service to filter
 *   - status: consultation status (draft, submitted, received, in_review, referred, completed)
 *   - q: search query (resident name, etc)
 *   - limit: page size
 *   - offset: pagination offset
 * @returns Filtered consultation list with scope enforced by service layer
 * @throws {ApiError} 422 if filters are invalid or contradictory
 */
export const list = async (req, res) => {
  // Server-side consultation history filters (date range / health service /
  // consultation status). Validated here so an invalid range or unknown status
  // is a 422 with a clear message instead of a silently ignored filter.
  const { filters, errors } = consultationsService.parseListFilters({
    from: req.query.from,
    to: req.query.to,
    serviceId: req.query.serviceId ?? req.query.service_id,
    residentId: req.query.residentId ?? req.query.resident_id,
    status: req.query.status,
  });
  if (errors.length) {
    throw ApiError.unprocessable('Please correct the consultation filters.', errors);
  }
  return sendData(res, await consultationsService.list({ user: req.user, q: req.query.q, filters,
    limit: req.query.limit, offset: req.query.offset }));
};

/**
 * Retrieve a single consultation by ID.
 *
 * Authorization and scope checks (barangay/facility) are performed in the service.
 *
 * @param {string} req.params.id - Consultation ID
 * @param {object} req.user - Authenticated user from session
 * @returns Full consultation record with vitals, assessment, and treatment data
 * @throws {ApiError} 404 if consultation not found or out of scope
 */
export const get = async (req, res) => sendData(res, { consultation: await consultationsService.get({ user: req.user, id: req.params.id }) });

/**
 * Create a new consultation.
 *
 * Records vitals, assessment findings, treatment recommendations, and referral status.
 * Vitals are validated server-side to ensure clinical data integrity. Resident risk
 * is automatically recalculated and persisted. Idempotency keys prevent duplicate
 * consultations when offline clients retry.
 *
 * @param {object} req.body.consultation - Consultation payload with vitals, assessment, treatment
 * @param {string} req.idempotencyKey - Optional idempotency key for offline sync
 * @param {object} req.user - Authenticated user from session
 * @returns Created consultation with generated ID and timestamps
 * @throws {ApiError} 422 if vitals are outside plausible clinical ranges
 * @throws {ApiError} 409 if idempotency key already exists (duplicate)
 */
export const create = async (req, res) => sendCreated(res, {
  consultation: await consultationsService.create({
    user: req.user,
    payload: req.body?.consultation || req.body || {},
    idempotencyKey: req.idempotencyKey,
  }),
});

/**
 * Update an existing consultation.
 *
 * Allows correction of consultation data (vitals, assessment, treatment, referral status).
 * Resident risk is recalculated on update. Some fields may be locked by the service
 * after the consultation reaches certain statuses (e.g., referred consultations).
 *
 * @param {string} req.params.id - Consultation ID
 * @param {object} req.body.consultation - Partial consultation update payload
 * @param {object} req.user - Authenticated user from session
 * @returns Updated consultation record
 * @throws {ApiError} 404 if consultation not found or out of scope
 * @throws {ApiError} 422 if vitals are invalid or consultation is in a locked state
 */
export const update = async (req, res) => sendData(res, { consultation: await consultationsService.update({ user: req.user, id: req.params.id, payload: req.body?.consultation || req.body || {} }) });

export default { list, get, create, update };
