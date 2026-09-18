import * as verificationsService from '../services/verifications.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Resident verification endpoints (manual Health Supervisor review).
 *
 * Staff review routes are authenticated, role-checked and barangay-scoped
 * (via `resolveBarangayScope` + the service's own scope check). The reviewer
 * identity is always taken from the session, never the request body.
 *
 *   GET   /me                        resident: own verification status + history
 *   PATCH /:id/resubmit              resident: resubmit own registration
 *   GET   /queue?status=             staff: pending/approved/rejected/... queue
 *   GET   /pending                   staff: pending queue (compat)
 *   GET   /history                   staff: recent decisions
 *   GET   /:id                       staff: one resident verification + history
 *   GET   /:id/history               staff: one resident's history
 *   PATCH /:id/approve               staff: approve
 *   PATCH /:id/reject                staff: reject (reason required)
 *   PATCH /:id/request-resubmission  staff: request resubmission (reason required)
 *   POST  /:ref/decision             staff: approve/reject (compat)
 */

export const listQueue = async (req, res) => {
  const result = await verificationsService.listQueue({
    user: req.user,
    status: req.query.status,
    q: req.query.q,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, { rows: result.rows, pending: result.rows, total: result.total, status: result.status });
};

export const listPending = async (req, res) => {
  const pending = await verificationsService.listPending({ user: req.user });
  sendData(res, { pending });
};

export const listHistory = async (req, res) => {
  const result = await verificationsService.listHistory({
    user: req.user,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, { history: result.rows, total: result.total });
};

export const getVerification = async (req, res) => {
  const result = await verificationsService.getVerification({ user: req.user, id: req.params.id });
  sendData(res, { verification: result.verification, history: result.history });
};

export const getHistory = async (req, res) => {
  const result = await verificationsService.getVerification({ user: req.user, id: req.params.id });
  sendData(res, { history: result.history });
};

export const approve = async (req, res) => {
  const verification = await verificationsService.approve({
    user: req.user,
    id: req.params.id,
    remarks: req.body?.remarks,
  });
  sendData(res, { verification });
};

export const reject = async (req, res) => {
  const verification = await verificationsService.reject({
    user: req.user,
    id: req.params.id,
    reason: req.body?.reason,
    remarks: req.body?.remarks,
  });
  sendData(res, { verification });
};

export const requestResubmission = async (req, res) => {
  const verification = await verificationsService.requestResubmission({
    user: req.user,
    id: req.params.id,
    reason: req.body?.reason,
    remarks: req.body?.remarks,
  });
  sendData(res, { verification });
};

export const resubmit = async (req, res) => {
  const verification = await verificationsService.resubmit({ user: req.user, id: req.params.id });
  sendData(res, { verification });
};

export const getMine = async (req, res) => {
  const result = await verificationsService.getMine({ user: req.user });
  sendData(res, result);
};

// Backward-compatible single-decision endpoint.
export const decide = async (req, res) => {
  const { decision, reason, remarks } = req.body || {};
  const verification = await verificationsService.decide({
    ref: req.params.ref,
    decision,
    reason,
    remarks,
    user: req.user,
  });
  sendData(res, { verification });
};

export default {
  listQueue,
  listPending,
  listHistory,
  getVerification,
  getHistory,
  approve,
  reject,
  requestResubmission,
  resubmit,
  getMine,
  decide,
};
