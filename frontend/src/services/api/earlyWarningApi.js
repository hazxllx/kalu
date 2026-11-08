import api from './apiClient';

const aggregatePayload = (payload, arrays, needsSummary = false) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !arrays.every((key) => Array.isArray(payload[key])) ||
      (needsSummary && (!payload.summary || typeof payload.summary !== 'object'))) {
    throw new Error('Aggregate analytics data is unavailable.');
  }
  return payload;
};

/**
 * Early Warning analytics API.
 *
 * `GET /api/analytics/early-warning` derives the barangay scope from the
 * authenticated session on the SERVER — a barangay-assigned Health
 * Supervisor always receives their own barangay's figures, and any attempt
 * to request another barangay is rejected with 403. A municipality-wide
 * caller (MHO / PHN) may optionally drill down to one of
 * their own barangays with `barangay`; passing another municipality's
 * barangay is still rejected server-side. While the request is in flight the
 * page shows its loading skeleton; an unreachable API leaves the empty state
 * in place rather than any fabricated figures.
 */
// Reporting filters apply only to the additive activity chart block.
export const fetchEarlyWarningData = async (barangay, { from = null, to = null, year = null } = {}) => {
  const params = {};
  if (barangay) params.barangay = barangay;
  if (from) params.from = from;
  if (to) params.to = to;
  if (year != null) params.year = year;
  const payload = await api.get('/analytics/early-warning', Object.keys(params).length ? { params } : undefined);
  return aggregatePayload(payload, ['consultationTrends', 'diseaseDistribution', 'riskDistribution'], true);
};

/**
 * Community Health Map data (barangay coordinates + real per-barangay case
 * metrics). Scope is resolved from the session on the SERVER: a barangay-
 * assigned Health Supervisor receives only their barangay; a municipality-wide
 * caller (MHO / PHN) receives every barangay in their municipality and may
 * drill into one with `barangay`. Optional condition, risk level, supported
 * consultation status and inclusive `from`/`to` filters are applied
 * server-side over real records — the client never sends a scope id it could
 * use to widen access.
 */
export const fetchCommunityMap = async ({
  barangay = null,
  condition = null,
  distinctResidents = false,
  status = null,
  riskLevel = null,
  from = null,
  to = null,
} = {}) => {
  const params = {};
  if (barangay) params.barangay = barangay;
  if (condition && condition !== 'All') params.condition = condition;
  if (distinctResidents) params.distinctResidents = 'true';
  if (status && status !== 'All') params.status = status;
  if (riskLevel && riskLevel !== 'All') params.riskLevel = riskLevel;
  if (from) params.from = from;
  if (to) params.to = to;
  const payload = await api.get('/analytics/community-map', Object.keys(params).length ? { params } : undefined);
  return aggregatePayload(payload, ['barangays', 'conditionTotals'], true);
};

/** Monthly (Jan..Dec) case trend for the map's selected condition + scope. */
export const fetchCommunityMapTrends = async ({
  barangay = null,
  condition = null,
  distinctResidents = false,
  status = null,
  riskLevel = null,
  from = null,
  to = null,
  year = null,
} = {}) => {
  const params = {};
  if (barangay) params.barangay = barangay;
  if (condition && condition !== 'All') params.condition = condition;
  if (distinctResidents) params.distinctResidents = 'true';
  if (status && status !== 'All') params.status = status;
  if (riskLevel && riskLevel !== 'All') params.riskLevel = riskLevel;
  if (from) params.from = from;
  if (to) params.to = to;
  if (year) params.year = year;
  const payload = await api.get('/analytics/community-map/trends', Object.keys(params).length ? { params } : undefined);
  return aggregatePayload(payload, ['monthly']);
};

/** The disease/condition options for the filter dropdown (from the backend). */
export const fetchConditions = async () => {
  const payload = await api.get('/analytics/conditions');
  return aggregatePayload(payload, ['conditions']).conditions;
};

/**
 * Privacy-preserving household aggregates, scoped from the session on the
 * SERVER. The API returns totals at valid stored barangay reference points;
 * exact household coordinates, identifiers and resident identities are never
 * returned.
 */
export const fetchHouseholdMap = async ({ barangay = null } = {}) => {
  const params = {};
  if (barangay) params.barangay = barangay;
  const payload = await api.get('/analytics/household-map', Object.keys(params).length ? { params } : undefined);
  return aggregatePayload(payload, ['locations'], true);
};

export default { fetchEarlyWarningData, fetchCommunityMap, fetchCommunityMapTrends, fetchConditions, fetchHouseholdMap };
