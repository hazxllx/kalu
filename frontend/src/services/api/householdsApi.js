import { api } from './apiClient';

/**
 * Households API. Thin wrapper over the centralized apiClient.
 *
 * Live endpoints (role-scoped: BHW / Health Supervisor / PHN):
 *   GET    /households                    list + search, scope-enforced
 *   GET    /households/:id                single household incl. members
 *   POST   /households                    register (risk computed server-side)
 *   PUT    /households/:id                permitted updates / HS verification
 *   POST   /households/:id/members        add a member
 *   DELETE /households/:id/members/:mid   remove a member
 */
export const householdsApi = {
  list: (params) => api.get('/households', { params }),
  get: (id) => api.get(`/households/${id}`),
  create: (payload) => api.post('/households', payload),
  update: (id, payload) => api.put(`/households/${id}`, payload),
  addMember: (id, member) => api.post(`/households/${id}/members`, { member }),
  removeMember: (id, memberId) => api.delete(`/households/${id}/members/${memberId}`),
};

export default householdsApi;
