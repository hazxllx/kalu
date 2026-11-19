import * as service from '../services/residentFollowups.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Resident self-service follow-up controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> residentFollowups.controller -> residentFollowups.service -> repository/Supabase`
 *
 * Ownership is always derived from the authenticated session (`req.user`) in the
 * service layer — the controller never passes a client-supplied resident id, and
 * the follow-up id in the URL is only ever matched against the caller's own
 * resident record.
 */

/**
 * Handles `GET /` — lists clinical follow-up schedules belonging to the
 * authenticated resident (`req.user`) via `service.listOwn()`.
 * Responds with `200 OK` (`{ rows }`) via `sendData`.
 *
 * @param {Object} req - Express request with authenticated resident `user`.
 * @param {Object} res - Express response.
 */
export const list = async (req, res) =>
  sendData(res, { rows: await service.listOwn({ user: req.user }) });

/**
 * Handles `GET /:id` — retrieves a single follow-up record (`req.params.id`)
 * verified against `req.user`'s own resident profile via `service.getOwn()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated resident `user`.
 * @param {Object} res - Express response.
 */
export const get = async (req, res) =>
  sendData(res, { record: await service.getOwn({ user: req.user, id: req.params.id }) });

/**
 * Handles `POST`/`PATCH /:id/approve` — confirms/approves follow-up `req.params.id`
 * on behalf of the authenticated resident (`req.user`) via `service.approveOwn()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated resident `user`.
 * @param {Object} res - Express response.
 */
export const approve = async (req, res) =>
  sendData(res, { record: await service.approveOwn({ user: req.user, id: req.params.id }) });

/**
 * Handles `POST`/`PATCH /:id/reject` — declines follow-up `req.params.id` with
 * optional `req.body.reason` on behalf of `req.user` via `service.rejectOwn()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id`, `{ reason }` in `body`, and resident `user`.
 * @param {Object} res - Express response.
 */
export const reject = async (req, res) =>
  sendData(res, { record: await service.rejectOwn({ user: req.user, id: req.params.id, reason: req.body?.reason }) });

export default { list, get, approve, reject };
