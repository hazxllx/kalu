// backend/src/controllers/residents.controller.js
/**
 * Resident directory, health record, and self-service profile controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> [barangayScope / idempotency] -> residents.controller -> residents.service -> repository/Supabase`
 *
 * Serves two distinct caller contexts:
 * 1. Authorized health staff: barangay/municipality-scoped directory search, filter
 *    metadata, resident intake (`Idempotency-Key`), optimistic-concurrency profile
 *    edits (`If-Match` required), and portal login account invitation.
 * 2. Authenticated residents: self-service contact profile updates and filtered read
 *    access to their own completed consultations (ownership derived solely from `req.user`).
 */
import * as residentsService from '../services/residents.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import ApiError from '../utils/apiError.js';
import { getResidentRiskClinicalDetails as loadResidentRiskClinicalDetails, getResidentRiskSummaryRecords } from '../services/residentRisk.service.js';

/**
 * Handles `GET /residents` — lists resident records within `req.user`'s geographic
 * scope, filtered by `q`, `barangay`, `barangayId`/`barangay_id`, `zone`, `riskLevel`,
 * `limit`, `offset`, and `verifiedOnly` (`?verified=true` or `?status=approved|verified`).
 * Delegates to `residentsService.listResidents()` and responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with search, scope, risk, verification, and pagination query params.
 * @param {Object} res - Express response.
 */
export const listResidents = async (req, res) => {
  // Verified-only directory: `?verified=true` (or `?status=approved|verified`).
  // The actual verified rule (approved individual verification OR membership of
  // a Verified household) and the barangay/municipality scope are enforced in
  // the service — this only reads the caller's intent.
  const statusParam = String(req.query.status || '').trim().toLowerCase();
  const verifiedOnly =
    req.query.verified === 'true' || statusParam === 'approved' || statusParam === 'verified';
  const result = await residentsService.listResidents({
    user: req.user,
    q: req.query.q,
    barangay: req.query.barangay,
    barangayId: req.query.barangayId ?? req.query.barangay_id,
    zone: req.query.zone,
    limit: req.query.limit,
    offset: req.query.offset,
    verifiedOnly,
    riskLevel: req.query.riskLevel,
  });
  sendData(res, result);
};

/**
 * Handles `GET /residents/filters` — returns barangay, zone, and directory filter
 * options scoped to `req.user` via `residentsService.getResidentDirectoryFilters()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with authenticated `user`.
 * @param {Object} res - Express response.
 */
export const getDirectoryFilters = async (req, res) => {
  const filters = await residentsService.getResidentDirectoryFilters({ user: req.user });
  sendData(res, filters);
};

const optionalText = (value, max = 120) => {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) {
    throw ApiError.badRequest('One or more resident risk filters are invalid.');
  }
  return value.trim() || null;
};

const optionalDate = (value, name) => {
  if (value === undefined || value === '') return null;
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw ApiError.badRequest(`${name} must be a valid YYYY-MM-DD date.`);
  }
  return value;
};

const boundedInteger = (value, fallback, min, max, name) => {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw ApiError.badRequest(`${name} is invalid.`);
  return number;
};

export const getResidentRiskSummary = async (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  const from = optionalDate(req.query.from, 'Start date');
  const to = optionalDate(req.query.to, 'End date');
  if (from && to && from > to) throw ApiError.badRequest('Start date must be on or before end date.');
  const zoneText = optionalText(req.query.zone, 8);
  const zone = zoneText === null ? null : boundedInteger(zoneText, null, 1, 32767, 'Zone');
  const limit = boundedInteger(req.query.limit, 25, 1, 100, 'Page size');
  const offset = boundedInteger(req.query.offset, 0, 0, 1000000, 'Page offset');
  const barangayId = optionalText(req.query.barangayId, 80);
  if (barangayId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(barangayId)) {
    throw ApiError.badRequest('Barangay filter is invalid.');
  }
  const result = await getResidentRiskSummaryRecords({
    user: req.user,
    filters: {
      barangayId,
      zone,
      riskLevel: optionalText(req.query.riskLevel, 20),
      assessmentStatus: optionalText(req.query.assessmentStatus, 20),
      from,
      to,
      indicator: optionalText(req.query.indicator, 40),
      search: optionalText(req.query.search, 120),
      limit,
      offset,
    },
  });
  sendData(res, result);
};

export const getResidentRiskClinicalDetails = async (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  const result = await loadResidentRiskClinicalDetails({ user: req.user, residentId: req.params.id });
  sendData(res, result);
};

/**
 * Handles `POST /residents` — creates a new resident record from `req.body.resident`
 * (or `req.body`), forwarding `req.idempotencyKey` (or `idempotency-key` header)
 * and `req.user` to `residentsService.createResident()`.
 * Responds with `201 Created` (`sendCreated`) containing `{ resident }`.
 *
 * @param {Object} req - Express request with resident payload in `body` and optional idempotency key.
 * @param {Object} res - Express response.
 */
export const createResident = async (req, res) => {
  const resident = await residentsService.createResident({
    payload: req.body?.resident || req.body || {},
    user: req.user,
    idempotencyKey: req.idempotencyKey || req.headers['idempotency-key'] || null,
  });
  sendCreated(res, { resident });
};

/**
 * Handles `GET /residents/:id` — retrieves a single resident record (`req.params.id`)
 * within `req.user`'s scope via `residentsService.getResident()`.
 * Responds with `200 OK` (`{ resident }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const getResident = async (req, res) => {
  const resident = await residentsService.getResident({ id: req.params.id, user: req.user });
  sendData(res, { resident });
};

/**
 * Handles `POST /residents/:id/account` — invites and links a portal login account
 * (`req.body.email`) for an existing resident record (`req.params.id`).
 * Route middleware enforces `accounts.create` permission, while `residentsService.createResidentLoginAccount()`
 * re-verifies role, barangay scope, and that the resident is not already linked.
 * Responds with `201 Created` (`sendCreated`) containing `{ resident }`.
 *
 * @param {Object} req - Express request with `params.id`, `{ email }` in `body`, and staff `user`.
 * @param {Object} res - Express response.
 */
export const createResidentAccount = async (req, res) => {
  const resident = await residentsService.createResidentLoginAccount({
    id: req.params.id,
    email: req.body?.email,
    user: req.user,
  });
  sendCreated(res, { resident });
};

export const resendResidentInvitation = async (req, res) => {
  const resident = await residentsService.resendResidentInvitation({
    id: req.params.id,
    user: req.user,
  });
  sendData(res, { resident });
};

/**
 * Handles `PUT`/`PATCH /residents/:id` — updates resident record `req.params.id`
 * with `req.body.resident`. Enforces optimistic concurrency by requiring an `If-Match`
 * header (throws `428 REVISION_REQUIRED` `ApiError` when absent), parses the revision
 * precondition via `residentsService.parseResidentPrecondition()`, and delegates to
 * `residentsService.updateResident()`. Responds with `200 OK` (`{ resident }`).
 *
 * @param {Object} req - Express request with `params.id`, `If-Match` header, and `{ resident }` in `body`.
 * @param {Object} res - Express response.
 */
export const updateResident = async (req, res) => {
  const precondition = req.get('If-Match');
  if (!precondition) {
    throw new ApiError(428, 'Reopen the resident and include its revision before saving.').withCode('REVISION_REQUIRED');
  }
  const resident = await residentsService.updateResident({
    id: req.params.id,
    patch: req.body.resident || {},
    user: req.user,
    ...residentsService.parseResidentPrecondition(precondition),
  });
  sendData(res, { resident });
};

/**
 * Handles `PATCH /residents/me/profile` — resident self-service endpoint for updating
 * own mutable profile details (such as contact number) from `req.body`. Resident identity
 * is derived exclusively from `req.user` via `residentsService.updateOwnProfile()`.
 * Responds with `200 OK` (`{ profile }`) via `sendData`.
 *
 * @param {Object} req - Express request with authenticated resident `user` and profile fields in `body`.
 * @param {Object} res - Express response.
 */
export const updateMyProfile = async (req, res) => {
  const profile = await residentsService.updateOwnProfile({ user: req.user, payload: req.body || {} });
  sendData(res, { profile });
};

/**
 * Handles `GET /residents/me/health-records` — resident self-service endpoint returning
 * the caller's basic profile and own completed consultations (`req.user`, no client ID accepted).
 * Validates `from`, `to`, `serviceId`/`service_id`, `type`, and `status` query filters via
 * `residentsService.parseConsultationFilters()` (throwing `422 Unprocessable Entity` on invalid
 * filters) and applies them server-side via `residentsService.getOwnHealthRecords()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with authenticated resident `user` and consultation filter query params.
 * @param {Object} res - Express response.
 */
export const getMyHealthRecords = async (req, res) => {
  const { filters, errors } = residentsService.parseConsultationFilters({
    from: req.query.from,
    to: req.query.to,
    serviceId: req.query.serviceId ?? req.query.service_id,
    type: req.query.type,
    status: req.query.status,
  });
  if (errors.length) {
    throw ApiError.unprocessable('Please correct the consultation filters.', errors);
  }
  const data = await residentsService.getOwnHealthRecords({ user: req.user, filters });
  sendData(res, data);
};

export const getStaffHealthHistory = async (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  const data = await residentsService.getStaffHealthHistory({ user: req.user, residentId: req.params.id });
  sendData(res, data);
};

export default { listResidents, createResident, getResident, createResidentAccount, resendResidentInvitation, updateResident, updateMyProfile, getMyHealthRecords };
