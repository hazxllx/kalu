// backend/src/controllers/staffAccounts.controller.js
import * as staffAccountsService from '../services/staffAccounts.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Personnel registration and operational account verification controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> [uploadStaffDocuments / authenticate -> authorize] -> staffAccounts.controller -> staffAccounts.service -> repository/Supabase`
 *
 * Endpoints handled:
 *   POST /register                  public: submit a personnel registration with optional verification files
 *   GET  /queue?status=&q=          reviewer: list requests for roles/barangays this account may approve
 *   GET  /pending-count             reviewer: pending badge count for navigation
 *   GET  /:id                       reviewer: inspect one personnel registration request
 *   POST /:id/approve               reviewer: approve and provision/activate staff access
 *   POST /:id/reject                reviewer: reject request (`reason` required)
 *   POST /:id/request-resubmission  reviewer: return request for correction (`reason` required)
 *
 * Reviewer identity is always derived from `req.user` in the session, never from the request body.
 */

/**
 * Handles `POST /register` — public endpoint that submits a personnel account
 * registration using form fields in `req.body` and optional multipart verification
 * documents parsed by `uploadStaffDocuments` into `req.staffDocuments`.
 * Delegates to `staffAccountsService.submitRequest()` and responds with `201 Created`
 * (`sendCreated`) containing `{ request }`.
 *
 * @param {Object} req - Express request with registration fields in `body` and optional `staffDocuments`.
 * @param {Object} res - Express response.
 */
export const register = async (req, res) => {
  // Verification document files (when the registration is multipart) are parsed
  // by uploadStaffDocuments into req.staffDocuments; a plain JSON registration
  // simply has none.
  const request = await staffAccountsService.submitRequest(req.body || {}, req.staffDocuments || []);
  sendCreated(res, { request });
};

/**
 * Handles `GET /queue` — lists personnel registration requests within the roles
 * and geographic scope `req.user` may review, filtered by `status`, search `q`,
 * `limit`, and `offset` via `staffAccountsService.listQueue()`.
 * Responds with `200 OK` (`{ rows, total, status }`) via `sendData`.
 *
 * @param {Object} req - Express request with `status`, `q`, `limit`, and `offset` query params.
 * @param {Object} res - Express response.
 */
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

/**
 * Handles `GET /pending-count` — returns the count of pending personnel account
 * verification requests actionable by `req.user` via `staffAccountsService.pendingCount()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with authenticated reviewer `user`.
 * @param {Object} res - Express response.
 */
export const pendingCount = async (req, res) => {
  const result = await staffAccountsService.pendingCount({ user: req.user });
  sendData(res, result);
};

/**
 * Handles `GET /:id` — retrieves a single personnel registration request
 * (`req.params.id`) within `req.user`'s review scope via `staffAccountsService.getRequest()`.
 * Responds with `200 OK` (`{ request }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and reviewer `user`.
 * @param {Object} res - Express response.
 */
export const getRequest = async (req, res) => {
  const request = await staffAccountsService.getRequest({ user: req.user, id: req.params.id });
  sendData(res, { request });
};

/**
 * Handles `POST /:id/approve` — approves personnel registration request `req.params.id`
 * with optional `req.body.remarks` on behalf of reviewer `req.user` via
 * `staffAccountsService.approve()`. Responds with `200 OK` (`{ request }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id`, optional `{ remarks }` in `body`, and reviewer `user`.
 * @param {Object} res - Express response.
 */
export const approve = async (req, res) => {
  const request = await staffAccountsService.approve({
    user: req.user,
    id: req.params.id,
    remarks: req.body?.remarks,
  });
  sendData(res, { request });
};

/**
 * Handles `POST /:id/reject` — rejects personnel registration request `req.params.id`
 * with required `req.body.reason` and optional `req.body.remarks` on behalf of reviewer
 * `req.user` via `staffAccountsService.reject()`. Responds with `200 OK` (`{ request }`).
 *
 * @param {Object} req - Express request with `params.id`, `{ reason, remarks }` in `body`, and reviewer `user`.
 * @param {Object} res - Express response.
 */
export const reject = async (req, res) => {
  const request = await staffAccountsService.reject({
    user: req.user,
    id: req.params.id,
    reason: req.body?.reason,
    remarks: req.body?.remarks,
  });
  sendData(res, { request });
};

/**
 * Handles `POST /:id/request-resubmission` — returns personnel registration request
 * `req.params.id` for correction/resubmission with `req.body.reason` and optional
 * `req.body.remarks` via `staffAccountsService.requestResubmission()`.
 * Responds with `200 OK` (`{ request }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id`, `{ reason, remarks }` in `body`, and reviewer `user`.
 * @param {Object} res - Express response.
 */
export const requestResubmission = async (req, res) => {
  const request = await staffAccountsService.requestResubmission({
    user: req.user,
    id: req.params.id,
    reason: req.body?.reason,
    remarks: req.body?.remarks,
  });
  sendData(res, { request });
};

export default { register, listQueue, pendingCount, getRequest, approve, reject, requestResubmission };
