/**
 * Operational tracking endpoints (visit plans, queue items, notifications).
 *
 * Manages operational records scoped by resident and filterable by status and date range.
 * Supports CRUD operations on various operational entities. Timestamps are enforced
 * server-side; client timestamps are never trusted.
 */
import * as service from '../services/operational.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import { isSyncRequest } from '../utils/syncConcurrency.js';

const readIfMatch = (req) => {
  const headers = req?.headers || {};
  if (Object.prototype.hasOwnProperty.call(headers, 'if-match')) return headers['if-match'];
  if (Object.prototype.hasOwnProperty.call(headers, 'If-Match')) return headers['If-Match'];
  return req?.get?.('If-Match');
};

export const list = async (req, res) => sendData(res, { rows: await service.list({
  user: req.user,
  kind: req.params.kind,
  residentId: req.query.residentId,
  status: req.query.status,
  from: req.query.from || null,
  to: req.query.to || null,
}) });
export const create = async (req, res) => sendCreated(res, { record: await service.create({
  user: req.user,
  kind: req.params.kind,
  payload: req.body?.record || req.body || {},
  idempotencyKey: req.idempotencyKey || null,
  isSync: isSyncRequest(req),
}) });
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
export const markAllRead = async (req, res) => sendData(res, await service.markAllNotificationsRead({ user: req.user }));
export const remove = async (req, res) => sendData(res, await service.remove({ user: req.user, kind: req.params.kind, id: req.params.id }));

export default { list, create, update, markAllRead, remove };