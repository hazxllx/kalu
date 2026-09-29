import * as service from '../services/reports.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Report endpoints (role-routed submission).
 *
 *   GET   /meta                     status vocabulary + allowed routes
 *   GET   /?box=incoming|outgoing   reports routed to me / reports I sent
 *   GET   /:id                      one report (sender or in-scope recipient)
 *   POST  /                         submit a report (routed by role)
 *   PATCH /:id/review               recipient marks Received / Reviewed / Rejected
 */

export const meta = async (req, res) => {
  sendData(res, service.meta());
};

export const list = async (req, res) => {
  const box = String(req.query.box || 'incoming').toLowerCase() === 'outgoing' ? 'outgoing' : 'incoming';
  const rows = await service.list({ user: req.user, box, status: req.query.status });
  sendData(res, { rows, records: rows });
};

export const get = async (req, res) => {
  const record = await service.getById({ user: req.user, id: req.params.id });
  sendData(res, { record });
};

export const create = async (req, res) => {
  const record = await service.create({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

export const review = async (req, res) => {
  const record = await service.review({
    user: req.user,
    id: req.params.id,
    status: req.body?.status,
    remarks: req.body?.remarks,
  });
  sendData(res, { record });
};

export default { meta, list, get, create, review };
