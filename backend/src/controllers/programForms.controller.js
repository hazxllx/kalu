/**
 * Health program form endpoints (TCL, NCD, oral health assessments).
 *
 * Manages structured data collection forms for specific health programs.
 * Forms are scoped by resident or household and can be filtered by date range.
 * Form schemas are defined in config/programFormSchemas.js and validated server-side.
 */
import * as service from '../services/programForms.service.js';
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
  residentId: req.query.residentId || null,
  householdId: req.query.householdId || null,
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
    ifMatch: readIfMatch(req),
    expectedRevision,
    isSync: isSyncRequest(req),
  }) });
};

export const remove = async (req, res) => sendData(res, await service.remove({
  user: req.user,
  kind: req.params.kind,
  id: req.params.id,
}));

export const oralStatistics = async (req, res) => sendData(res, { statistics: await service.oralStatistics({
  user: req.user,
  from: req.query.from || null,
  to: req.query.to || null,
  population: req.query.population || null,
}) });

export default { list, create, update, remove, oralStatistics };
