import api from './apiClient';

/**
 * Early Warning analytics API.
 *
 * `GET /api/analytics/early-warning` derives the barangay scope from the
 * authenticated session on the SERVER — a barangay-assigned Health
 * Supervisor always receives their own barangay's figures, and any attempt
 * to request another barangay is rejected with 403. This module therefore
 * sends no barangay parameter at all. While the request is in flight the page
 * shows its loading skeleton; an unreachable API leaves the empty state in
 * place rather than any fabricated figures.
 */
export const fetchEarlyWarningData = async () => {
  const payload = await api.get('/analytics/early-warning');
  return payload || null;
};

export default { fetchEarlyWarningData };
