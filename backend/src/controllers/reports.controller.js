import * as service from '../services/reports.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Role-routed health report submission and review controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> reports.controller -> reports.service -> repository/Supabase`
 *
 * Endpoints handled:
 *   GET   /meta                     status vocabulary + allowed role-to-role routing paths
 *   GET   /?box=incoming|outgoing   reports routed to caller (`incoming`) or sent by caller (`outgoing`)
 *   GET   /:id                      single report (accessible to sender or in-scope recipient)
 *   POST  /                         create or submit a report (routed by role)
 *   POST  /:id/submit               submit a saved draft report into the recipient queue
 *   PATCH /:id/review               recipient records `Received`, `Reviewed`, or `Rejected`
 *   PATCH /:id/resubmit             sender updates content and resubmits a returned/rejected report
 */

/**
 * Handles `GET /meta` — returns report status vocabulary and permitted role
 * submission routes via `service.meta()`. Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
export const meta = async (req, res) => {
  sendData(res, service.meta());
};

/**
 * Handles `GET /` — lists reports in `req.user`'s `incoming` or `outgoing` mailbox
 * (`req.query.box`, defaulting to `'incoming'`), filtered by optional `req.query.status`
 * with pagination (`limit` default `200`, `offset` default `0`). When `limit` or `offset`
 * is explicitly supplied, requests total count metadata (`includeTotal: true`) and returns
 * `{ ...result, records: result.rows }`; otherwise returns `{ rows, records }` (`200 OK`).
 *
 * @param {Object} req - Express request with `box`, `status`, `limit`, and `offset` query params.
 * @param {Object} res - Express response.
 */
export const list = async (req, res) => {
  const box = String(req.query.box || 'incoming').toLowerCase() === 'outgoing' ? 'outgoing' : 'incoming';
  const includeTotal = req.query.limit !== undefined || req.query.offset !== undefined;
  const result = await service.list({ user: req.user, box, status: req.query.status, limit: req.query.limit || 200, offset: req.query.offset || 0, includeTotal });
  sendData(res, includeTotal ? { ...result, records: result.rows } : { rows: result, records: result });
};

/**
 * Handles `GET /:id` — retrieves report `req.params.id` if `req.user` is the sender
 * or an authorized in-scope recipient via `service.getById()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const get = async (req, res) => {
  const record = await service.getById({ user: req.user, id: req.params.id });
  sendData(res, { record });
};

/**
 * Handles `POST /` — creates a new report (draft or submitted) from `req.body`
 * routed according to `req.user`'s role via `service.create()`.
 * Responds with `201 Created` (`sendCreated`) containing `{ record }`.
 *
 * @param {Object} req - Express request with report payload in `body` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const create = async (req, res) => {
  const record = await service.create({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

/**
 * Handles `POST`/`PATCH /:id/submit` — promotes draft report `req.params.id`
 * owned by `req.user` to submitted status via `service.submitDraft()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const submitDraft = async (req, res) => {
  const record = await service.submitDraft({ user: req.user, id: req.params.id });
  sendData(res, { record });
};

/**
 * Handles `PATCH /:id/review` — records an authorized recipient's review decision
 * (`req.body.status`: Received / Reviewed / Rejected) and optional `req.body.remarks`
 * on report `req.params.id` via `service.review()`. Responds with `200 OK` (`{ record }`).
 *
 * @param {Object} req - Express request with `params.id`, `{ status, remarks }` in `body`, and `user`.
 * @param {Object} res - Express response.
 */
export const review = async (req, res) => {
  const record = await service.review({
    user: req.user,
    id: req.params.id,
    status: req.body?.status,
    remarks: req.body?.remarks,
  });
  sendData(res, { record });
};

/**
 * Handles `PATCH`/`POST /:id/resubmit` — updates `req.body.content` on a rejected
 * report (`req.params.id`) and resubmits it to the recipient queue via `service.resubmit()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id`, `{ content }` in `body`, and sender `user`.
 * @param {Object} res - Express response.
 */
export const resubmit = async (req, res) => {
  const record = await service.resubmit({
    user: req.user,
    id: req.params.id,
    content: req.body?.content,
  });
  sendData(res, { record });
};

export default { meta, list, get, create, submitDraft, review, resubmit };
