import { api } from './apiClient';

/**
 * Consultations API backed by the scope-enforced visits workflow.
 *
 * `list` accepts the server-side consultation-history filters:
 *   { q, from, to, serviceId, status } — the date range is inclusive on the
 * consultation date; serviceId is a public.health_services uuid; status is a
 * visits workflow status ('draft'…'completed'). Access remains session-scoped:
 * a resident always receives only their own records, staff only their scope.
 */
export const consultationsApi = {
  list: (params) => api.get('/consultations', { params }),
  get: (id) => api.get(`/consultations/${id}`),
  create: (payload) => api.post('/consultations', payload),
  update: (id, payload) => api.put(`/consultations/${id}`, payload),
};

export default consultationsApi;
