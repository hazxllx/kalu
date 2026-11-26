// backend/src/controllers/scheduleRequests.controller.js
import * as service from '../services/scheduleRequests.service.js';
import { sendData } from '../utils/apiResponse.js';

export const submit = async (req, res) => sendData(res, { request: await service.submit({ user: req.user, ...(req.body || {}) }) });
export const list = async (req, res) => sendData(res, { rows: await service.listForStaff({ user: req.user }) });
export const decide = async (req, res) => sendData(res, { request: await service.decide({ user: req.user, id: req.params.id, ...(req.body || {}) }) });
export default { submit, list, decide };
