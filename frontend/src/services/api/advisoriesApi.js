// frontend/src/services/api/advisoriesApi.js
import { api } from './apiClient';

export const advisoriesApi = {
  listActive: () => api.get('/advisories'),
  listAll: () => api.get('/advisories/admin'),
  create: (payload) => api.post('/advisories', payload),
  update: (id, payload) => api.put(`/advisories/${id}`, payload),
  setStatus: (id, isActive) => api.patch(`/advisories/${id}/status`, { isActive }),
  delete: (id) => api.delete(`/advisories/${id}`),
};

export default advisoriesApi;
