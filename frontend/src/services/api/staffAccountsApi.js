import { api } from './apiClient';

/**
 * Staff account registration + operational verification API.
 *
 * Backed by /api/staff-accounts (Express + Supabase `staff_account_requests`).
 *
 * Approval authority is decided on the server and re-checked in the database:
 *   PHN               -> Health Supervisor, RHU Personnel
 *   Health Supervisor -> BHW, Resident
 *   System Admin / MHO -> 403 on every queue and decision route.
 *
 * `register` is public: it creates the Supabase Auth identity at
 * `pending_verification`, which is what keeps the account out of the protected
 * system until an approver activates it.
 */
export const staffAccountsApi = {
  register: (payload) => api.post('/staff-accounts/register', payload),

  /** Queue for the roles the signed-in reviewer is responsible for. */
  listQueue: (params) => api.get('/staff-accounts/queue', { params }),
  get: (id) => api.get(`/staff-accounts/${id}`),

  /** Badge count for the reviewer's own pending approvals. */
  pendingCount: () => api.get('/staff-accounts/pending-count'),

  approve: (id, payload = {}) => api.post(`/staff-accounts/${id}/approve`, payload),
  reject: (id, payload = {}) => api.post(`/staff-accounts/${id}/reject`, payload),
};

export default staffAccountsApi;
