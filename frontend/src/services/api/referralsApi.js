import { api } from './apiClient.js';

/**
 * Canonical referrals: sender-managed routing, individual recipient inbox and
 * recipient decisions. Historical REF-* IDs resolve to the same canonical row.
 *
 * Backed by /api/referrals (Express + Supabase `health_referrals`). Payloads
 * use the persisted snake_case shape; `residentId` identifies the resident on
 * create (the server derives barangay/municipality scope from the resident).
 */
export const referralsApi = {
  list: (params, options) => api.get('/referrals', { ...options, params }),
  inbox: (params, options) => api.get('/referrals/incoming', { ...options, params }),
  recipients: (params, options) => api.get('/referrals/recipients', { ...options, params }),
  get: (id, options) => api.get(`/referrals/${encodeURIComponent(id)}`, options),
  getByVisit: (id, options) => api.get(`/referrals/visits/${encodeURIComponent(id)}`, options),
  create: (record, options) => api.post('/referrals', { record }, options),
  update: (id, record, options) => api.put(`/referrals/${encodeURIComponent(id)}`, { record }, options),
  updateStatus: (id, record, options) => api.put(`/referrals/${encodeURIComponent(id)}/status`, { record }, options),
  // Compatibility only: the server cancels, never deletes history or FKs.
  remove: (id, options) => api.delete(`/referrals/${encodeURIComponent(id)}`, options),
};

export default referralsApi;
