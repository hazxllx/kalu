import * as staffAccountsService from '../services/staffAccounts.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Personnel registration + operational account verification endpoints.
 *
 *   POST /register            public: submit a personnel registration
 *   GET  /queue?status=&q=    reviewer: the roles this account may approve
 *   GET  /pending-count       reviewer: badge count for the navigation
 *   GET  /:id                 reviewer: one request
 *   POST /:id/approve         reviewer: approve
 *   POST /:id/reject          reviewer: reject (reason required)
 *
 * The reviewer identity is always taken from the session, never the body.
 */

export const register = async (req, res) => {
  // Verification document files (when the registration is multipart) are parsed
  // by uploadStaffDocuments into req.staffDocuments; a plain JSON registration
  // simply has none.
  const request = await staffAccountsService.submitRequest(req.body || {}, req.staffDocuments || []);
  sendCreated(res, { request });
};

export const listQueue = async (req, res) => {
  const result = await staffAccountsService.listQueue({
    user: req.user,
    status: req.query.status,
    q: req.query.q,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, { rows: result.rows, total: result.total, status: result.status });
};

export const pendingCount = async (req, res) => {
  const result = await staffAccountsService.pendingCount({ user: req.user });
  sendData(res, result);
};

export const getRequest = async (req, res) => {
  const request = await staffAccountsService.getRequest({ user: req.user, id: req.params.id });
  sendData(res, { request });
};

export const approve = async (req, res) => {
  const request = await staffAccountsService.approve({
    user: req.user,
    id: req.params.id,
    remarks: req.body?.remarks,
  });
  sendData(res, { request });
};

export const reject = async (req, res) => {
  const request = await staffAccountsService.reject({
    user: req.user,
    id: req.params.id,
    reason: req.body?.reason,
    remarks: req.body?.remarks,
  });
  sendData(res, { request });
};

export default { register, listQueue, pendingCount, getRequest, approve, reject };
