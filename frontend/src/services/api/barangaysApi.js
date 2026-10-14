import { api } from './apiClient';

/**
 * Admin Barangay Management API (admin-only backend). Thin wrapper over the
 * centralized apiClient. public.barangays is the source of truth; the backend
 * resolves the caller's admin role server-side.
 *
 * Barangays are managed by Active/Inactive STATUS, not deletion — the delete
 * endpoint was removed, so there is no remove() here.
 *
 *   GET   /barangays              list (params: q, municipalityId, status)
 *   GET   /barangays/options      municipality + status choices for the editor
 *   POST  /barangays              create a barangay
 *   GET   /barangays/:id          one barangay + dependency summary
 *   PUT   /barangays/:id          update (rename propagates to denormalized names)
 *   PATCH /barangays/:id/status   change Active/Inactive status only
 */
export const barangaysApi = {
  list: (params) => api.get('/barangays', { params }),
  options: () => api.get('/barangays/options'),
  get: (id) => api.get(`/barangays/${id}`),
  create: (barangay) => api.post('/barangays', barangay),
  update: (id, barangay) => api.put(`/barangays/${id}`, barangay),
  // Dedicated status change (Active <-> Inactive). Inactive barangays keep all
  // their residents/records but are hidden from new selections.
  setStatus: (id, status) => api.patch(`/barangays/${id}/status`, { status }),
};

export default barangaysApi;
