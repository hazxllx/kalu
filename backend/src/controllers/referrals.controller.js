import * as service from '../services/referrals.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import { isSyncRequest } from '../utils/syncConcurrency.js';

/**
 * Health Supervisor and clinical referral coordination controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> referrals.controller -> referrals.service -> repository/Supabase`
 *
 * Thin HTTP layer over `referrals.service`: coordinates inter-station referrals
 * (BHC to RHU / PHN / MHO), recipient discovery, visit-linked referral lookups,
 * optimistic concurrency (`If-Match` / `expected_version`), and offline sync support.
 * The service enforces role/barangay scope and derives the acting user strictly from
 * `req.user` (never from the request body).
 */

/**
 * Extracts the `If-Match` HTTP precondition header case-insensitively from `req`
 * for optimistic concurrency validation on referral updates.
 *
 * @param {Object} req - Express request.
 * @returns {string|undefined} Raw `If-Match` header value if provided.
 */
const readIfMatch = (req) => {
  const headers = req?.headers || {};
  if (Object.prototype.hasOwnProperty.call(headers, 'if-match')) return headers['if-match'];
  if (Object.prototype.hasOwnProperty.call(headers, 'If-Match')) return headers['If-Match'];
  return req?.get?.('If-Match');
};

/**
 * Handles `GET /` — lists referrals visible to `req.user`, filtered by optional
 * `residentId`, `status`, and `box` (`incoming` or `outgoing`) query parameters
 * via `service.list()`. Responds with `200 OK` (`{ rows }`) via `sendData`.
 *
 * @param {Object} req - Express request with optional `residentId`, `status`, and `box` query params.
 * @param {Object} res - Express response.
 */
export const list = async (req, res) =>
  sendData(res, { rows: await service.list({ user: req.user, residentId: req.query.residentId, status: req.query.status, box: req.query.box }) });

/**
 * Handles `GET /incoming` — lists referrals routed into `req.user`'s station/role
 * (`box: 'incoming'`), optionally filtered by `req.query.status`, via `service.list()`.
 * Responds with `200 OK` (`{ rows }`) via `sendData`.
 *
 * @param {Object} req - Express request with optional `status` query param and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const incoming = async (req, res) =>
  sendData(res, { rows: await service.list({ user: req.user, status: req.query.status, box: 'incoming' }) });

/**
 * Handles `GET /recipients` — returns eligible referral destination facilities/roles
 * for `req.user`, optionally scoped to `req.query.residentId`, via `service.listRecipients()`.
 * Responds with `200 OK` (`{ rows }`) via `sendData`.
 *
 * @param {Object} req - Express request with optional `residentId` query param.
 * @param {Object} res - Express response.
 */
export const recipients = async (req, res) =>
  sendData(res, { rows: await service.listRecipients({ user: req.user, residentId: req.query.residentId }) });

/**
 * Handles `GET /by-visit/:visitId` — retrieves the referral associated with
 * consultation/visit `req.params.visitId` within `req.user`'s scope via `service.getByVisitId()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.visitId` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const getByVisit = async (req, res) =>
  sendData(res, { record: await service.getByVisitId({ user: req.user, visitId: req.params.visitId }) });

/**
 * Handles `GET /:id` — retrieves a single referral record (`req.params.id`)
 * within `req.user`'s scope via `service.getById()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const get = async (req, res) =>
  sendData(res, { record: await service.getById({ user: req.user, id: req.params.id }) });

/**
 * Handles `POST /` — creates a new referral record from `req.body.record` (or `req.body`)
 * on behalf of `req.user` via `service.create()`.
 * Responds with `201 Created` (`sendCreated`) containing `{ record }`.
 *
 * @param {Object} req - Express request with referral payload in `body` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const create = async (req, res) =>
  sendCreated(res, { record: await service.create({ user: req.user, payload: req.body?.record || req.body || {} }) });

/**
 * Handles `PUT`/`PATCH /:id` — updates referral `req.params.id` with fields from
 * `req.body.record` (or `req.body`), forwarding `If-Match` (`ifMatch`) and offline
 * sync flag (`isSyncRequest(req)`) to `service.update()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id`, `If-Match`, and update payload in `body`.
 * @param {Object} res - Express response.
 */
export const update = async (req, res) =>
  sendData(res, {
    record: await service.update({
      user: req.user,
      id: req.params.id,
      payload: req.body?.record || req.body || {},
      ifMatch: readIfMatch(req),
      isSync: isSyncRequest(req),
    }),
  });

/**
 * Handles `PATCH /:id/status` — transitions referral `req.params.id` to `body.status`
 * with optional `resolution_notes`, optimistic version (`expected_version ?? version`),
 * `If-Match` (`ifMatch`), and `isSyncRequest(req)` via `service.updateStatus()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and status transition payload in `body`.
 * @param {Object} res - Express response.
 */
export const updateStatus = async (req, res) => {
  const body = req.body?.record || req.body || {};
  return sendData(res, {
    record: await service.updateStatus({
      user: req.user,
      id: req.params.id,
      status: body.status,
      resolutionNotes: body.resolution_notes,
      version: body.expected_version ?? body.version,
      ifMatch: readIfMatch(req),
      isSync: isSyncRequest(req),
    }),
  });
};

/**
 * Handles `DELETE /:id` — deletes referral `req.params.id` within `req.user`'s
 * scope via `service.remove()`. Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const remove = async (req, res) =>
  sendData(res, await service.remove({ user: req.user, id: req.params.id }));

export default { list, incoming, recipients, getByVisit, get, create, update, updateStatus, remove };
