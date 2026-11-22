import * as service from '../services/calendarActivities.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

export const list = async (req, res) => sendData(res, {
  rows: await service.listActivities({ user: req.user, ...req.query }),
});

export const create = async (req, res) => sendCreated(res, {
  record: await service.createActivity({ user: req.user, payload: req.body }),
});

export const update = async (req, res) => sendData(res, {
  record: await service.updateActivity({ user: req.user, id: req.params.id, payload: req.body }),
});

export const remove = async (req, res) => sendData(res, {
  record: await service.deleteActivity({ user: req.user, id: req.params.id }),
});

export default { list, create, update, remove };
