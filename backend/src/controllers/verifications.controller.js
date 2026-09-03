import * as verificationsService from '../services/verifications.service.js';
import { sendData } from '../utils/apiResponse.js';
import ApiError from '../utils/apiError.js';

/**
 * Verification review endpoints (Health Supervisor / PHN).
 *
 * The barangay scope is resolved from the authenticated session by
 * `resolveBarangayScope`; the service additionally filters every record
 * against the caller's assignment, so a barangay-assigned Health Supervisor
 * can never list or decide on another barangay's verifications.
 */
export const listPending = async (req, res) => {
  const pending = await verificationsService.listPending({ user: req.user });
  sendData(res, { pending });
};

export const listHistory = async (req, res) => {
  const history = await verificationsService.listHistory({ user: req.user });
  sendData(res, { history });
};

export const decide = async (req, res) => {
  const { decision, reason, remarks } = req.body || {};
  const record = await verificationsService.decide({
    ref: req.params.ref,
    decision,
    reason,
    remarks,
    user: req.user,
  });
  if (!record) throw ApiError.notFound('Verification request not found');
  if (record.alreadyDecided) {
    throw new ApiError(409, 'This verification request has already been decided');
  }
  sendData(res, { verification: record });
};

export default { listPending, listHistory, decide };
