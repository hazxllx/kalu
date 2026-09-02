import { api } from './apiClient';

/**
 * Health records API (role-scoped: Health Supervisor / PHN). Returns 501 until
 * the verified schema is connected.
 */
export const healthRecordsApi = {
  list: (params) => api.get('/health-records', { params }),
  get: (id) => api.get(`/health-records/${id}`),
  create: (payload) => api.post('/health-records', payload),
  update: (id, payload) => api.put(`/health-records/${id}`, payload),
  remove: (id) => api.delete(`/health-records/${id}`),
};

export default healthRecordsApi;
