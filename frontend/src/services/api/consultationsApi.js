import { api } from './apiClient';

/**
 * Consultations API backed by the scope-enforced visits workflow.
 */
export const consultationsApi = {
  list: (params) => api.get('/consultations', { params }),
  get: (id) => api.get(`/consultations/${id}`),
  create: (payload) => api.post('/consultations', payload),
  update: (id, payload) => api.put(`/consultations/${id}`, payload),
  remove: (id) => api.delete(`/consultations/${id}`),
};

export default consultationsApi;
