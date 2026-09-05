import * as analyticsService from '../services/analytics.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * GET /api/analytics/early-warning
 *
 * Early Warning module payload. The barangay scope is resolved from the
 * authenticated session by `resolveBarangayScope` — a barangay-scoped Health
 * Supervisor always receives their own barangay's data only, regardless of
 * any filter, URL parameter or id they supply. Municipality-wide callers may
 * optionally drill down with `?barangay=`.
 */
export const getEarlyWarning = async (req, res) => {
  const barangay = req.assignedBarangay || (typeof req.query.barangay === 'string' ? req.query.barangay.trim() : '') || null;
  const data = await analyticsService.getEarlyWarning({ barangay, user: req.user });
  sendData(res, data);
};

export default { getEarlyWarning };
