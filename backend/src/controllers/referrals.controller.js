import * as service from '../services/referrals.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

/**
 * Health Supervisor referral coordination controller.
 *
 * Thin HTTP layer over referrals.service — the service enforces role/scope and
 * derives the acting user from the authenticated session (never the body).
 */
export const list = async (req, res) =>
  sendData(res, { rows: await service.list({ user: req.user, residentId: req.query.residentId, status: req.query.status }) });

export const get = async (req, res) =>
  sendData(res, { record: await service.getById({ user: req.user, id: req.params.id }) });

export const create = async (req, res) =>
  sendCreated(res, { record: await service.create({ user: req.user, payload: req.body?.record || req.body || {} }) });

export const update = async (req, res) =>
  sendData(res, { record: await service.update({ user: req.user, id: req.params.id, payload: req.body?.record || req.body || {} }) });

export const updateStatus = async (req, res) => {
  const body = req.body?.record || req.body || {};
  return sendData(res, {
    record: await service.updateStatus({ user: req.user, id: req.params.id, status: body.status, resolutionNotes: body.resolution_notes }),
  });
};

export const remove = async (req, res) =>
  sendData(res, await service.remove({ user: req.user, id: req.params.id }));

export default { list, get, create, update, updateStatus, remove };
