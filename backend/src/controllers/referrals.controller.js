import * as service from '../services/referrals.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import { isSyncRequest } from '../utils/syncConcurrency.js';

const readIfMatch = (req) => {
  const headers = req?.headers || {};
  if (Object.prototype.hasOwnProperty.call(headers, 'if-match')) return headers['if-match'];
  if (Object.prototype.hasOwnProperty.call(headers, 'If-Match')) return headers['If-Match'];
  return req?.get?.('If-Match');
};

/**
 * Health Supervisor referral coordination controller.
 *
 * Thin HTTP layer over referrals.service — the service enforces role/scope and
 * derives the acting user from the authenticated session (never the body).
 */
export const list = async (req, res) =>
  sendData(res, { rows: await service.list({ user: req.user, residentId: req.query.residentId, status: req.query.status, box: req.query.box }) });

export const incoming = async (req, res) =>
  sendData(res, { rows: await service.list({ user: req.user, status: req.query.status, box: 'incoming' }) });

export const recipients = async (req, res) => {
  const result = await service.listRecipients({ user: req.user, residentId: req.query.residentId });
  return sendData(res, { rows: result.routes, referringFacility: result.referringFacility });
};

export const getByVisit = async (req, res) =>
  sendData(res, { record: await service.getByVisitId({ user: req.user, visitId: req.params.visitId }) });

export const get = async (req, res) =>
  sendData(res, { record: await service.getById({ user: req.user, id: req.params.id }) });

export const create = async (req, res) =>
  sendCreated(res, { record: await service.create({ user: req.user, payload: req.body?.record || req.body || {} }) });

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

export const remove = async (req, res) =>
  sendData(res, await service.remove({ user: req.user, id: req.params.id }));

export default { list, incoming, recipients, getByVisit, get, create, update, updateStatus, remove };
