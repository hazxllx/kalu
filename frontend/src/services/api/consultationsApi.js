import { api } from './apiClient.js';

/**
 * Consultations API backed by the scope-enforced visits workflow.
 *
 * `list` accepts the server-side consultation-history filters:
 *   { q, from, to, serviceId, status, limit, offset } — the date range is inclusive on the
 * consultation date; serviceId is a public.health_services uuid; status is a
 * visits workflow status ('draft'…'completed'). Access remains session-scoped:
 * a resident always receives only their own records, staff only their scope.
 */
export const consultationsApi = {
  list: (params, options = {}) => api.get('/consultations', { ...options, params }),
  get: (id, options) => api.get(`/consultations/${id}`, options),
  create: (payload, options) => api.post('/consultations', payload, options),
  update: (id, payload, options) => api.put(`/consultations/${id}`, payload, options),
};

export default consultationsApi;
