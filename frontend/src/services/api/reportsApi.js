import { api } from './apiClient';
import { loadServerRows } from '@/lib/serverRows';

/**
 * Reports API — role-routed report submission (PHN -> MHO, Health Supervisor
 * -> RHU). Backed by /api/reports (Express + Supabase public.reports). The
 * sender, sender role, municipality/barangay scope and recipient routing are
 * all resolved server-side from the authenticated session.
 */
export const reportsApi = {
  meta: (options) => api.get('/reports/meta', options),
  // box: 'incoming' (routed to me) | 'outgoing' (reports I sent)
  list: (params, options) => api.get('/reports', { ...options, params }),
  listAll: (params, options) => loadServerRows((page) => reportsApi.list({ ...params, ...page }, options)),
  get: (id, options) => api.get(`/reports/${id}`, options),
  create: (payload, options) => api.post('/reports', payload, options),
  submit: (id, options) => api.patch(`/reports/${id}/submit`, {}, options),
  // Recipient marks Received / Reviewed / Rejected.
  review: (id, payload, options) => api.patch(`/reports/${id}/review`, payload, options),
  // Sender replaces the persisted snapshot after a report is returned.
  resubmit: (id, payload, options) => api.patch(`/reports/${id}/resubmit`, payload, options),
};

export default reportsApi;
