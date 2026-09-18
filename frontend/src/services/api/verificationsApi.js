import api from './apiClient';

/**
 * Resident verification API (manual Health Supervisor review).
 *
 * The barangay scope and the reviewer identity are derived from the
 * authenticated session on the SERVER. The browser never sends a reviewer id,
 * a barangay for a staff action, or a status transition.
 *
 * Staff (Health Supervisor / PHN):
 *   GET   /verifications/queue?status=pending|approved|rejected|resubmission_required|all
 *   GET   /verifications/:id
 *   GET   /verifications/:id/history
 *   PATCH /verifications/:id/approve
 *   PATCH /verifications/:id/reject
 *   PATCH /verifications/:id/request-resubmission
 *
 * Resident (own record only):
 *   GET   /verifications/me
 *   PATCH /verifications/:id/resubmit
 */

export const fetchVerificationQueue = async ({ status = 'pending', q = '' } = {}) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const payload = await api.get(`/verifications/queue?${params.toString()}`);
  return { rows: payload?.rows || [], total: payload?.total ?? 0 };
};

export const fetchPendingVerifications = async () => {
  const { rows } = await fetchVerificationQueue({ status: 'pending' });
  return rows;
};

export const fetchVerificationHistory = async () => {
  const payload = await api.get('/verifications/history');
  return payload?.history || [];
};

export const fetchResidentVerification = async (id) => {
  const payload = await api.get(`/verifications/${encodeURIComponent(id)}`);
  return { verification: payload?.verification || null, history: payload?.history || [] };
};

export const approveResident = async (id, { remarks } = {}) =>
  api.patch(`/verifications/${encodeURIComponent(id)}/approve`, { remarks });

export const rejectResident = async (id, { reason, remarks } = {}) =>
  api.patch(`/verifications/${encodeURIComponent(id)}/reject`, { reason, remarks });

export const requestResubmission = async (id, { reason, remarks } = {}) =>
  api.patch(`/verifications/${encodeURIComponent(id)}/request-resubmission`, { reason, remarks });

// Backward-compatible wrapper for the existing drawer/decision callers.
export const submitVerificationDecision = async ({ ref, decision, reason, remarks }) => {
  if (decision === 'approved') return approveResident(ref, { remarks });
  return rejectResident(ref, { reason, remarks });
};

// Resident self-service
export const fetchMyVerification = async () => {
  const payload = await api.get('/verifications/me');
  return {
    hasResidentRecord: Boolean(payload?.hasResidentRecord),
    verification: payload?.verification || null,
    history: payload?.history || [],
  };
};

export const resubmitOwnVerification = async (id) =>
  api.patch(`/verifications/${encodeURIComponent(id)}/resubmit`, {});

export default {
  fetchVerificationQueue,
  fetchPendingVerifications,
  fetchVerificationHistory,
  fetchResidentVerification,
  approveResident,
  rejectResident,
  requestResubmission,
  submitVerificationDecision,
  fetchMyVerification,
  resubmitOwnVerification,
};
