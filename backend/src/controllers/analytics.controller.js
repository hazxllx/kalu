import * as analyticsService from '../services/analytics.service.js';
import { sendData } from '../utils/apiResponse.js';

const qstr = (req, key) => (typeof req.query[key] === 'string' ? req.query[key].trim() : '') || null;

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
  // Health Supervisor -> their assigned barangay (from the session). MHO and
  // other municipality-wide callers -> their municipality (from the session).
  // A client-supplied ?barangay= is only honoured for callers with no assigned
  // barangay (i.e. municipality-wide) AND is still constrained to their own
  // municipality by the residents filter below; a barangay-assigned supervisor
  // can never widen scope with it.
  const barangay = req.assignedBarangay || (typeof req.query.barangay === 'string' ? req.query.barangay.trim() : '') || null;
  const data = await analyticsService.getEarlyWarning({
    barangay,
    municipalityId: req.user?.municipalityId || null,
  });
  sendData(res, data);
};

/**
 * GET /api/analytics/community-map
 *
 * Barangay coordinates + real per-barangay case metrics for the Community
 * Health Map. Scope is resolved from the session: a barangay-assigned Health
 * Supervisor gets ONLY their barangay; a municipality-wide caller (MHO / PHN)
 * gets every barangay in their municipality, and may drill into one of their
 * own barangays with `?barangay=`. `resolveBarangayScope` has already rejected
 * any attempt by a barangay-scoped caller to widen scope, so honouring
 * `?barangay=` here is safe. Disease + date filters (`condition`, `from`,
 * `to`) are applied server-side over real visit records.
 */
export const getCommunityMap = async (req, res) => {
  const barangay =
    req.assignedBarangay || (typeof req.query.barangay === 'string' ? req.query.barangay.trim() : '') || null;
  const data = await analyticsService.getCommunityMap({
    barangay,
    municipalityId: req.user?.municipalityId || null,
    condition: qstr(req, 'condition'),
    from: qstr(req, 'from'),
    to: qstr(req, 'to'),
  });
  sendData(res, data);
};

/**
 * GET /api/analytics/community-map/trends
 *
 * Monthly (Jan..Dec) case trend for the map's selected condition, scoped
 * exactly like the community map.
 */
export const getCommunityMapTrends = async (req, res) => {
  const barangay =
    req.assignedBarangay || (typeof req.query.barangay === 'string' ? req.query.barangay.trim() : '') || null;
  const yearRaw = qstr(req, 'year');
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : new Date().getFullYear();
  const data = await analyticsService.getCommunityMapTrends({
    barangay,
    municipalityId: req.user?.municipalityId || null,
    condition: qstr(req, 'condition'),
    year,
  });
  sendData(res, data);
};

/** GET /api/analytics/conditions — the disease filter option list. */
export const getConditions = async (req, res) => {
  sendData(res, await analyticsService.getConditionOptions());
};

export default { getEarlyWarning, getCommunityMap, getCommunityMapTrends, getConditions };
