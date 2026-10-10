import { api } from './apiClient';

/**
 * Admin Barangay Management API (admin-only backend). Thin wrapper over the
 * centralized apiClient. public.barangays is the source of truth; the backend
 * resolves the caller's admin role server-side and enforces safe-delete rules.
 *
 *   GET    /barangays          list (params: q, municipalityId, status)
 *   GET    /barangays/options  municipality + status choices for the editor
 *   POST   /barangays          create a barangay
 *   GET    /barangays/:id      one barangay + dependency summary
 *   PUT    /barangays/:id      update (rename propagates to denormalized names)
 *   DELETE /barangays/:id      delete when safe (409 with guidance when referenced)
 */
export const barangaysApi = {
  list: (params) => api.get('/barangays', { params }),
  options: () => api.get('/barangays/options'),
  get: (id) => api.get(`/barangays/${id}`),
  create: (barangay) => api.post('/barangays', barangay),
  update: (id, barangay) => api.put(`/barangays/${id}`, barangay),
  remove: (id) => api.delete(`/barangays/${id}`),
};

export default barangaysApi;
