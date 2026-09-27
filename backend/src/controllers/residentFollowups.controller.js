import * as service from '../services/residentFollowups.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Resident follow-up endpoints. Ownership is always derived from the
 * authenticated session in the service layer — the controller never passes a
 * client-supplied resident id, and the follow-up id in the URL is only ever
 * matched against the caller's own resident record.
 */

export const list = async (req, res) =>
  sendData(res, { rows: await service.listOwn({ user: req.user }) });

export const get = async (req, res) =>
  sendData(res, { record: await service.getOwn({ user: req.user, id: req.params.id }) });

export const approve = async (req, res) =>
  sendData(res, { record: await service.approveOwn({ user: req.user, id: req.params.id }) });

export const reject = async (req, res) =>
  sendData(res, { record: await service.rejectOwn({ user: req.user, id: req.params.id, reason: req.body?.reason }) });

export default { list, get, approve, reject };
