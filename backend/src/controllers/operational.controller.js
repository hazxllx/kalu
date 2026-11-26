// backend/src/controllers/operational.controller.js
/**
 * Operational tracking controller (visit plans, queue items, notifications, and related operational kinds).
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> [idempotency] -> operational.controller -> operational.service -> repository/Supabase`
 *
 * Manages operational records scoped by resident/barangay and filterable by status and date range.
 * Supports idempotent creation, optimistic concurrency (`If-Match` / `expected_revision`), and
 * offline-sync conflict awareness (`isSyncRequest`). Server-side timestamps are enforced in the
 * service layer; client-supplied timestamps are never trusted.
 */
import * as service from '../services/operational.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import { isSyncRequest } from '../utils/syncConcurrency.js';

/**
 * Extracts the `If-Match` HTTP precondition header case-insensitively from `req`
 * for optimistic concurrency checks during updates.
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
 * Handles `GET /:kind` — lists operational records of entity `req.params.kind`
 * within `req.user`'s scope, filtered by optional `residentId`, `status`, `from`,
 * and `to` query parameters via `service.list()`. Responds with `200 OK` (`{ rows }`).
 *
 * @param {Object} req - Express request with `params.kind` and filter query params.
 * @param {Object} res - Express response.
 */
export const list = async (req, res) => sendData(res, { rows: await service.list({
  user: req.user,
  kind: req.params.kind,
  residentId: req.query.residentId,
  status: req.query.status,
  from: req.query.from || null,
  to: req.query.to || null,
}) });

/**
 * Handles `POST /:kind` — creates a new operational record of entity `req.params.kind`
 * from `req.body.record` (or `req.body`), forwarding `req.idempotencyKey` and
 * offline sync metadata (`isSyncRequest(req)`) to `service.create()`.
 * Responds with `201 Created` (`sendCreated`) containing `{ record }`.
 *
 * @param {Object} req - Express request with `params.kind`, `body`, and optional `idempotencyKey`.
 * @param {Object} res - Express response.
 */
export const create = async (req, res) => sendCreated(res, { record: await service.create({
  user: req.user,
  kind: req.params.kind,
  payload: req.body?.record || req.body || {},
  idempotencyKey: req.idempotencyKey || null,
  isSync: isSyncRequest(req),
}) });

/**
 * Handles `PUT`/`PATCH /:kind/:id` — updates operational record `req.params.id` of
 * entity `req.params.kind` with optimistic concurrency preconditions (`If-Match` header
 * as `expectedUpdatedAt` and `expected_revision` / `expectedRevision` / `baseRevision`)
 * and offline sync detection (`isSyncRequest(req)`).
 * Delegates to `service.update()` and responds with `200 OK` (`{ record }`).
 *
 * @param {Object} req - Express request with `params.kind`, `params.id`, `If-Match`, and update `body`.
 * @param {Object} res - Express response.
 */
export const update = async (req, res) => {
  const payload = req.body?.record || req.body || {};
  const expectedRevision = payload.expected_revision ?? payload.expectedRevision ?? req.body?.expected_revision ?? req.body?.expectedRevision ?? req.body?.baseRevision;
  return sendData(res, { record: await service.update({
    user: req.user,
    kind: req.params.kind,
    id: req.params.id,
    payload,
    expectedUpdatedAt: readIfMatch(req),
    expectedRevision,
    isSync: isSyncRequest(req),
  }) });
};

/**
 * Handles `POST`/`PATCH` mark-all-read requests — marks all unread notifications
 * addressed to `req.user` as read via `service.markAllNotificationsRead()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with authenticated `user`.
 * @param {Object} res - Express response.
 */
export const markAllRead = async (req, res) => sendData(res, await service.markAllNotificationsRead({ user: req.user }));

/**
 * Handles `DELETE /:kind/:id` — removes operational record `req.params.id` of
 * entity `req.params.kind` within `req.user`'s scope via `service.remove()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `params.kind`, `params.id`, and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const remove = async (req, res) => sendData(res, await service.remove({ user: req.user, kind: req.params.kind, id: req.params.id }));

export default { list, create, update, markAllRead, remove };