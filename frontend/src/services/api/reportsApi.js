import { api } from './apiClient';

/**
 * Reports API — role-routed report submission (PHN -> MHO, Health Supervisor
 * -> RHU). Backed by /api/reports (Express + Supabase public.reports). The
 * sender, sender role, municipality/barangay scope and recipient routing are
 * all resolved server-side from the authenticated session.
 */
export const reportsApi = {
  meta: () => api.get('/reports/meta'),
  // box: 'incoming' (routed to me) | 'outgoing' (reports I sent)
  list: (params) => api.get('/reports', { params }),
  get: (id) => api.get(`/reports/${id}`),
  create: (payload) => api.post('/reports', payload),
  // Recipient marks Received / Reviewed / Rejected.
  review: (id, payload) => api.patch(`/reports/${id}/review`, payload),
};

export default reportsApi;
