import { api } from './apiClient';

/**
 * Consultations API (role-scoped: Health Supervisor / PHN). Returns 501 until
 * the verified schema is connected.
 */
export const consultationsApi = {
  list: (params) => api.get('/consultations', { params }),
  get: (id) => api.get(`/consultations/${id}`),
  create: (payload) => api.post('/consultations', payload),
  update: (id, payload) => api.put(`/consultations/${id}`, payload),
  remove: (id) => api.delete(`/consultations/${id}`),
};

export default consultationsApi;
