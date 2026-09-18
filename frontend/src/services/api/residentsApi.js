import { api } from './apiClient';

/**
 * Residents API. Thin wrapper over the centralized apiClient so components and
 * hooks never build resident URLs themselves.
 *
 * Live endpoints (role-scoped: Health Supervisor / PHN / MHO — NOT BHW):
 *   GET  /residents        directory listing + search, scope-enforced
 *   POST /residents        register a resident (validated, duplicate-guarded)
 *   GET  /residents/:id    single record (within the caller's scope)
 *   PUT  /residents/:id    permitted demographic corrections
 */
export const residentsApi = {
  list: (params) => api.get('/residents', { params }),
  get: (id) => api.get(`/residents/${id}`),
  create: (payload) => api.post('/residents', payload),
  update: (id, payload) => api.put(`/residents/${id}`, payload),
  remove: (id) => api.delete(`/residents/${id}`),
};

export default residentsApi;
