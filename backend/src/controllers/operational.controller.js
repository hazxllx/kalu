import * as service from '../services/operational.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

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
}) });
export const update = async (req, res) => sendData(res, { record: await service.update({
  user: req.user,
  kind: req.params.kind,
  id: req.params.id,
  payload: req.body?.record || req.body || {},
}) });
export const remove = async (req, res) => sendData(res, await service.remove({ user: req.user, kind: req.params.kind, id: req.params.id }));

export default { list, create, update, remove };