import api from './apiClient';

/**
 * Early Warning analytics API.
 *
 * `GET /api/analytics/early-warning` derives the barangay scope from the
 * authenticated session on the SERVER — a barangay-assigned Health
 * Supervisor always receives their own barangay's figures, and any attempt
 * to request another barangay is rejected with 403. A municipality-wide
 * caller (MHO / unassigned supervisor) may optionally drill down to one of
 * their own barangays with `barangay`; passing another municipality's
 * barangay is still rejected server-side. While the request is in flight the
 * page shows its loading skeleton; an unreachable API leaves the empty state
 * in place rather than any fabricated figures.
 */
export const fetchEarlyWarningData = async (barangay) => {
  const params = barangay ? { barangay } : undefined;
  const payload = await api.get('/analytics/early-warning', params ? { params } : undefined);
  return payload || null;
};

/**
 * Community Health Map data (barangay coordinates + real per-barangay case
 * metrics). Scope is resolved from the session on the SERVER: a barangay-
 * assigned Health Supervisor receives only their barangay; a municipality-wide
 * caller (MHO / PHN) receives every barangay in their municipality and may
 * drill into one with `barangay`. Optional `condition` + `from`/`to` filters
 * are applied server-side over real visit records — the client sends filters,
 * never a scope id it could use to widen access.
 */
export const fetchCommunityMap = async ({ barangay = null, condition = null, from = null, to = null } = {}) => {
  const params = {};
  if (barangay) params.barangay = barangay;
  if (condition && condition !== 'All') params.condition = condition;
  if (from) params.from = from;
  if (to) params.to = to;
  const payload = await api.get('/analytics/community-map', Object.keys(params).length ? { params } : undefined);
  return payload || { scope: 'municipality', barangays: [], summary: {} };
};

/** Monthly (Jan..Dec) case trend for the map's selected condition + scope. */
export const fetchCommunityMapTrends = async ({ barangay = null, condition = null, year = null } = {}) => {
  const params = {};
  if (barangay) params.barangay = barangay;
  if (condition && condition !== 'All') params.condition = condition;
  if (year) params.year = year;
  const payload = await api.get('/analytics/community-map/trends', Object.keys(params).length ? { params } : undefined);
  return payload || { monthly: [] };
};

/** The disease/condition options for the filter dropdown (from the backend). */
export const fetchConditions = async () => {
  const payload = await api.get('/analytics/conditions');
  return payload?.conditions || [];
};

export default { fetchEarlyWarningData, fetchCommunityMap, fetchCommunityMapTrends, fetchConditions };
