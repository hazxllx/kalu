import { api } from './apiClient';

/**
 * Residents API. Thin wrapper over the centralized apiClient so components and
 * hooks never build resident URLs themselves.
 *
 * Backend endpoints are role-scoped (Health Supervisor / PHN / MHO — NOT BHW)
 * and currently return 501 until the verified schema is connected.
 */
export const residentsApi = {
  list: (params) => api.get('/residents', { params }),
  get: (id) => api.get(`/residents/${id}`),
  create: (payload) => api.post('/residents', payload),
  update: (id, payload) => api.put(`/residents/${id}`, payload),
  remove: (id) => api.delete(`/residents/${id}`),
};

export default residentsApi;
