import { api } from './apiClient';

/**
 * Referrals API — barangay-scoped referral coordination workflow
 * (Health Supervisor / PHN / MHO write; resident reads their own).
 *
 * Backed by /api/referrals (Express + Supabase `health_referrals`). Payloads
 * use the persisted snake_case shape; `residentId` identifies the resident on
 * create (the server derives barangay/municipality scope from the resident).
 */
export const referralsApi = {
  list: (params) => api.get('/referrals', { params }),
  get: (id) => api.get(`/referrals/${id}`),
  create: (record) => api.post('/referrals', { record }),
  update: (id, record) => api.put(`/referrals/${id}`, { record }),
  updateStatus: (id, record) => api.put(`/referrals/${id}/status`, { record }),
  remove: (id) => api.delete(`/referrals/${id}`),
};

export default referralsApi;
