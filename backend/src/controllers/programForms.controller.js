/**
 * Health program form controller (TCL, NCD, oral health, environmental, and screening forms).
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> [idempotency] -> programForms.controller -> programForms.service -> repository/Supabase`
 *
 * Manages structured clinical data collection forms for specific DOH/FHSIS health programs.
 * Forms are scoped by resident or household and can be filtered by date range. Form schemas
 * are defined in `config/programFormSchemas.js` and validated server-side, with support for
 * idempotent creation, optimistic concurrency (`If-Match` / `expected_revision`), and offline sync.
 */
import * as service from '../services/programForms.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import { isSyncRequest } from '../utils/syncConcurrency.js';

/**
 * Extracts the `If-Match` HTTP precondition header case-insensitively from `req`
 * for optimistic concurrency control on form updates.
 *
 * @param {Object} req - Express request.
 * @returns {string|undefined} Raw `If-Match` header value if present.
 */
const readIfMatch = (req) => {
  const headers = req?.headers || {};
  if (Object.prototype.hasOwnProperty.call(headers, 'if-match')) return headers['if-match'];
  if (Object.prototype.hasOwnProperty.call(headers, 'If-Match')) return headers['If-Match'];
  return req?.get?.('If-Match');
};

/**
 * Handles `GET /:kind` — lists program form records of schema `req.params.kind`
 * within `req.user`'s scope, filtered by optional `residentId`, `householdId`,
 * `from`, and `to` query parameters via `service.list()`.
 * Responds with `200 OK` (`{ rows }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.kind` and filter query params.
 * @param {Object} res - Express response.
 */
export const list = async (req, res) => sendData(res, { rows: await service.list({
  user: req.user,
  kind: req.params.kind,
  residentId: req.query.residentId || null,
  householdId: req.query.householdId || null,
  from: req.query.from || null,
  to: req.query.to || null,
}) });

/**
 * Handles `POST /:kind` — creates a new program form record of schema `req.params.kind`
 * from `req.body.record` (or `req.body`), forwarding `req.idempotencyKey` and offline
 * sync flag (`isSyncRequest(req)`) to `service.create()`.
 * Responds with `201 Created` (`sendCreated`) containing `{ record }`.
 *
 * @param {Object} req - Express request with `params.kind`, form payload in `body`, and optional `idempotencyKey`.
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
 * Handles `PUT`/`PATCH /:kind/:id` — updates program form record `req.params.id` of
 * schema `req.params.kind`, passing `If-Match` (`ifMatch`), `expectedRevision`
 * (`expected_revision` / `expectedRevision` / `baseRevision`), and `isSyncRequest(req)`
 * to `service.update()`. Responds with `200 OK` (`{ record }`) via `sendData`.
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
    ifMatch: readIfMatch(req),
    expectedRevision,
    isSync: isSyncRequest(req),
  }) });
};

/**
 * Handles `DELETE /:kind/:id` — deletes program form record `req.params.id` of
 * schema `req.params.kind` within `req.user`'s scope via `service.remove()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `params.kind`, `params.id`, and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const remove = async (req, res) => sendData(res, await service.remove({
  user: req.user,
  kind: req.params.kind,
  id: req.params.id,
}));

/**
 * Handles `GET /oral/statistics` — calculates aggregated oral health indicators and
 * coverage rates within `req.user`'s scope across optional `from`, `to`, and
 * denominator `population` query parameters via `service.oralStatistics()`.
 * Responds with `200 OK` (`{ statistics }`) via `sendData`.
 *
 * @param {Object} req - Express request with optional `from`, `to`, and `population` query params.
 * @param {Object} res - Express response.
 */
export const oralStatistics = async (req, res) => sendData(res, { statistics: await service.oralStatistics({
  user: req.user,
  from: req.query.from || null,
  to: req.query.to || null,
  population: req.query.population || null,
}) });

export default { list, create, update, remove, oralStatistics };
