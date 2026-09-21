import * as consultationsService from '../services/consultations.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

export const list = async (req, res) => sendData(res, await consultationsService.list({ user: req.user, q: req.query.q }));
export const create = async (req, res) => sendCreated(res, { consultation: await consultationsService.create({ user: req.user, payload: req.body?.consultation || req.body || {} }) });
export const update = async (req, res) => sendData(res, { consultation: await consultationsService.update({ user: req.user, id: req.params.id, payload: req.body?.consultation || req.body || {} }) });

export default { list, create, update };