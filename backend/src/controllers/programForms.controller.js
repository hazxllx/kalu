import * as service from '../services/programForms.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

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
}) });

export const update = async (req, res) => sendData(res, { record: await service.update({
  user: req.user,
  kind: req.params.kind,
  id: req.params.id,
  payload: req.body?.record || req.body || {},
}) });

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
