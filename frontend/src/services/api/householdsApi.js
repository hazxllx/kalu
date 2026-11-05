import { api } from './apiClient.js';

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
 *   GET    /households/:id/members/:mid/health   member health profile
 *   PUT    /households/:id/members/:mid/health   save member health profile
 *                                                (BMI recomputed server-side)
 */
export const householdsApi = {
  list: (params) => api.get('/households', { params }),
  monitoringSummary: () => api.get('/households/monitoring/summary'),
  searchResidents: (q) => api.get('/households/residents/search', { params: { q } }),
  get: (id) => api.get(`/households/${id}`),
  listVisits: (id) => api.get(`/households/${id}/visits`),
  createVisit: (id, visit, requestId = visit?.requestId) => api.post(
    `/households/${id}/visits`,
    { visit },
    { headers: requestId ? { 'Idempotency-Key': requestId } : {} },
  ),
  create: (payload, options) => api.post('/households', payload, options),
  update: (id, payload, options) => api.put(`/households/${id}`, payload, options),
  addMember: (id, member) => api.post(`/households/${id}/members`, { member }),
  updateMember: (id, memberId, member) => api.put(`/households/${id}/members/${memberId}`, { member }),
  removeMember: (id, memberId) => api.delete(`/households/${id}/members/${memberId}`),
  getMemberHealth: (id, memberId) => api.get(`/households/${id}/members/${memberId}/health`),
  saveMemberHealth: (id, memberId, health, options) =>
    api.put(`/households/${id}/members/${memberId}/health`, { health }, options),
};

export default householdsApi;
