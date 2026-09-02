import { api } from './apiClient';

/**
 * Referrals API (role-scoped: Health Supervisor / PHN / MHO). Returns 501 until
 * the verified schema is connected.
 */
export const referralsApi = {
  list: (params) => api.get('/referrals', { params }),
  get: (id) => api.get(`/referrals/${id}`),
  create: (payload) => api.post('/referrals', payload),
  update: (id, payload) => api.put(`/referrals/${id}`, payload),
  remove: (id) => api.delete(`/referrals/${id}`),
};

export default referralsApi;
