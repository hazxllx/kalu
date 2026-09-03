import api from './apiClient';

/**
 * Early Warning analytics API.
 *
 * `GET /api/analytics/early-warning` derives the barangay scope from the
 * authenticated session on the SERVER — a barangay-assigned Health
 * Supervisor always receives their own barangay's figures, and any attempt
 * to request another barangay is rejected with 403. This module therefore
 * sends no barangay parameter at all. While the backend is not reachable
 * (local development), callers fall back to the scoped mock dataset.
 */
export const fetchEarlyWarningData = async () => {
  const payload = await api.get('/analytics/early-warning');
  return payload || null;
};

export default { fetchEarlyWarningData };
