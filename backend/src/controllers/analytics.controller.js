// backend/src/controllers/analytics.controller.js
import * as analyticsService from '../services/analytics.service.js';
import { isApprovedBarangayName } from '../config/barangays.js';
import ApiError from '../utils/apiError.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Community Health Analytics & Spatial Surveillance Controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> resolveBarangayScope -> controller -> analytics.service -> repository / Supabase RPC
 *
 * Exposes read-only endpoints for the Early Warning dashboard, Community Health
 * Map (barangay case counts and monthly disease trends), supported condition
 * filter options, and aggregated Household Map markers. Enforces strict input
 * validation on date ranges, reporting years, condition names, risk levels,
 * and workflow statuses before delegating to `analytics.service.js`.
 */

/**
 * Extracts and trims a string query parameter from `req.query`, returning
 * `null` when absent, non-string, or blank.
 *
 * @param {Object} req - Express request object.
 * @param {string} key - Query parameter name.
 * @returns {string|null} Trimmed query value or `null`.
 */
const qstr = (req, key) => (typeof req.query?.[key] === 'string' ? req.query[key].trim() : '') || null;

/**
 * Validates that a string is a real calendar date in `YYYY-MM-DD` format,
 * rejecting impossible calendar rollovers (such as `2026-02-30`).
 *
 * @param {string} value - Candidate ISO date string.
 * @returns {boolean} `true` if `value` is a valid calendar date.
 */
const isDateOnly = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/**
 * Builds the caller's geographic analytics scope from the verified session and
 * optional `?barangay=` drill-down filter.
 *
 * Barangay-assigned staff (`req.assignedBarangay` populated by `resolveBarangayScope`)
 * are pinned to their assigned barangay. Municipality-wide callers may filter
 * by an approved barangay name (`422` if unrecognized).
 *
 * @param {Object} req - Authenticated Express request.
 * @returns {Object} Scope descriptor `{ actorId, barangay, municipalityId }`.
 * @throws {ApiError} 422 when `?barangay=` is not an approved barangay name.
 */
const authenticatedScope = (req) => {
  const requestedBarangay = qstr(req, 'barangay');
  if (requestedBarangay && !isApprovedBarangayName(requestedBarangay)) {
    throw ApiError.unprocessable('The selected barangay is not supported.');
  }
  return {
    actorId: req.user?.id || null,
    barangay: req.assignedBarangay || requestedBarangay,
    // Used by the explicit file driver only. PostgreSQL resolves the stored
    // profile's assignment using actorId and receives no municipality argument.
    municipalityId: req.user?.municipalityId || null,
  };
};

/**
 * Factory creating analytics route handlers with injectable service/RPC
 * dependencies (enabling isolated unit/integration tests without mutating globals).
 *
 * @param {Object} [options] - Optional `service` override and extra repository/RPC dependencies.
 * @returns {Object} Bound analytics controller handlers.
 */
export const createAnalyticsController = ({ service = analyticsService, ...dependencies } = {}) => {

/**
 * GET /api/analytics/early-warning
 *
 * Early Warning module payload. The barangay scope is resolved from the
 * authenticated session by `resolveBarangayScope` — a barangay-scoped Health
 * Supervisor always receives their own barangay's data only, regardless of
 * any filter, URL parameter or id they supply. Municipality-wide callers may
 * optionally drill down with `?barangay=`.
 *
 * Query params: `barangay` (optional), `from` (`YYYY-MM-DD`), `to` (`YYYY-MM-DD`),
 * `year` (4-digit reporting year). Validates date ordering and year format (`422`
 * on invalid inputs), calls `service.getEarlyWarning`, and returns `200` via `sendData`.
 */
const getEarlyWarning = async (req, res) => {
  // Health Supervisor -> their assigned barangay (from the session). MHO and
  // other municipality-wide callers -> their municipality (from the session).
  // A client-supplied ?barangay= is only honoured for callers with no assigned
  // barangay (i.e. municipality-wide) AND is still constrained to their own
  // municipality by the residents filter below; a barangay-assigned supervisor
  // can never widen scope with it.
  const scope = authenticatedScope(req);
  const from = qstr(req, 'from');
  const to = qstr(req, 'to');
  const yearRaw = qstr(req, 'year');
  if ((from && !isDateOnly(from)) || (to && !isDateOnly(to)) || (from && to && from > to)) {
    throw ApiError.unprocessable('Select a valid activity reporting date range.');
  }
  if (yearRaw && (!/^\d{4}$/.test(yearRaw) || Number(yearRaw) < 1)) {
    throw ApiError.unprocessable('Select a valid activity reporting year.');
  }
  const data = await service.getEarlyWarning({ ...scope, from, to, year: yearRaw ? Number(yearRaw) : null }, dependencies);
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
 * `?barangay=` here is safe. Condition, recorded risk, workflow status and
 * date filters are applied server-side over real visit records.
 */
const getCommunityMap = async (req, res) => {
  const scope = authenticatedScope(req);
  const status = qstr(req, 'status');
  const riskLevel = qstr(req, 'riskLevel');
  const condition = qstr(req, 'condition');
  const distinctResidents = qstr(req, 'distinctResidents');
  if (condition && condition !== 'All' && !service.CONDITION_NAMES.includes(condition)) {
    throw ApiError.unprocessable('The selected health condition is not supported.');
  }
  if (distinctResidents && !['true', 'false'].includes(distinctResidents.toLowerCase())) {
    throw ApiError.unprocessable('The distinct-resident option must be true or false.');
  }
  if (status && !service.COMMUNITY_MAP_STATUSES.includes(status.toLowerCase())) {
    throw ApiError.unprocessable('The selected case status is not supported.');
  }
  if (riskLevel && !service.COMMUNITY_MAP_RISK_LEVELS.includes(riskLevel)) {
    throw ApiError.unprocessable('The selected risk level is not supported.');
  }
  const from = qstr(req, 'from');
  const to = qstr(req, 'to');
  if ((from && !isDateOnly(from)) || (to && !isDateOnly(to)) || (from && to && from > to)) {
    throw ApiError.unprocessable('Select a valid community map date range.');
  }
  const data = await service.getCommunityMap({
    ...scope,
    condition,
    distinctResidents: distinctResidents?.toLowerCase() === 'true',
    status: status?.toLowerCase() || null,
    riskLevel: riskLevel || null,
    from,
    to,
  }, dependencies);
  sendData(res, data);
};

/**
 * GET /api/analytics/community-map/trends
 *
 * Monthly (Jan..Dec) case trend for the map's selected condition, scoped
 * exactly like the community map.
 */
const getCommunityMapTrends = async (req, res) => {
  const scope = authenticatedScope(req);
  const yearRaw = qstr(req, 'year');
  if (yearRaw && (!/^\d{4}$/.test(yearRaw) || Number(yearRaw) < 1)) {
    throw ApiError.unprocessable('Select a valid reporting year.');
  }
  // A missing year is resolved by PostgreSQL's Asia/Manila reporting calendar.
  const year = yearRaw ? Number(yearRaw) : null;
  const status = qstr(req, 'status');
  const riskLevel = qstr(req, 'riskLevel');
  const condition = qstr(req, 'condition');
  const distinctResidents = qstr(req, 'distinctResidents');
  if (distinctResidents && !['true', 'false'].includes(distinctResidents.toLowerCase())) {
    throw ApiError.unprocessable('The distinct-resident option must be true or false.');
  }
  if (condition && condition !== 'All' && !service.CONDITION_NAMES.includes(condition)) {
    throw ApiError.unprocessable('The selected health condition is not supported.');
  }
  const from = qstr(req, 'from');
  const to = qstr(req, 'to');
  if (status && !service.COMMUNITY_MAP_STATUSES.includes(status.toLowerCase())) {
    throw ApiError.unprocessable('The selected case status is not supported.');
  }
  if (riskLevel && !service.COMMUNITY_MAP_RISK_LEVELS.includes(riskLevel)) {
    throw ApiError.unprocessable('The selected risk level is not supported.');
  }
  if ((from && !isDateOnly(from)) || (to && !isDateOnly(to)) || (from && to && from > to)) {
    throw ApiError.unprocessable('Select a valid community map date range.');
  }
  const data = await service.getCommunityMapTrends({
    ...scope,
    condition,
    status: status?.toLowerCase() || null,
    riskLevel: riskLevel || null,
    from,
    to,
    year,
    distinctResidents: distinctResidents?.toLowerCase() === 'true',
  }, dependencies);
  sendData(res, data);
};

/**
 * GET /api/analytics/conditions
 *
 * Returns the canonical disease/condition filter vocabulary from
 * `service.getConditionOptions()` via `sendData` (`200 OK`) for analytics UI dropdowns.
 */
const getConditions = async (req, res) => {
  sendData(res, await service.getConditionOptions());
};

/**
 * GET /api/analytics/household-map
 *
 * Aggregated household totals at stored barangay reference points. Exact
 * household coordinates, identifiers and resident identities are not returned.
 * Resolves caller scope via `authenticatedScope(req)`, delegates to
 * `service.getHouseholdMap`, and responds with `200 OK` via `sendData`.
 */
const getHouseholdMap = async (req, res) => {
  const data = await service.getHouseholdMap(authenticatedScope(req), dependencies);
  sendData(res, data);
};

return { getEarlyWarning, getCommunityMap, getCommunityMapTrends, getConditions, getHouseholdMap };
};

export const { getEarlyWarning, getCommunityMap, getCommunityMapTrends, getConditions, getHouseholdMap } = createAnalyticsController();
export default { getEarlyWarning, getCommunityMap, getCommunityMapTrends, getConditions, getHouseholdMap };
