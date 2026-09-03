import api from './apiClient';

/**
 * Resident verification API.
 *
 * `GET /api/verifications/pending` and `POST /api/verifications/:ref/decision`
 * derive the barangay scope from the authenticated session on the SERVER —
 * a barangay-assigned Health Supervisor only ever receives (and can only
 * decide on) their own barangay's requests; out-of-scope references return
 * 404 and cross-barangay query parameters are rejected with 403. This module
 * therefore sends no barangay parameter. While the backend is not reachable
 * (local development), callers fall back to the scoped mock dataset.
 */
export const fetchPendingVerifications = async () => {
  const payload = await api.get('/verifications/pending');
  return payload?.pending || [];
};

export const fetchVerificationHistory = async () => {
  const payload = await api.get('/verifications/history');
  return payload?.history || [];
};

export const submitVerificationDecision = async ({ ref, decision, reason, remarks }) =>
  api.post(`/verifications/${encodeURIComponent(ref)}/decision`, { decision, reason, remarks });

export default { fetchPendingVerifications, fetchVerificationHistory, submitVerificationDecision };
