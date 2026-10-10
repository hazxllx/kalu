import { api } from './apiClient';

/**
 * Medicine catalog API.
 *
 *   list({ q, source, includeInactive, facilityId }) -> { medicines: [...] }
 *   create(payload)                                   -> { medicine }
 *   update(id, payload)                               -> { medicine }
 *   setActive(id, active)                             -> { medicine }
 *   listAvailability(id)                              -> { availability: [...] }
 *   setAvailability(id, { facilityId, available, note }) -> { availability }
 *
 * Catalog reads are available to clinical roles (consultation form search);
 * writes are admin-only (enforced server-side).
 */
export const medicinesApi = {
  list: (params) => api.get('/medicines', { params }),
  facilities: () => api.get('/medicines/facilities'),
  create: (payload) => api.post('/medicines', payload),
  update: (id, payload) => api.put(`/medicines/${id}`, payload),
  setActive: (id, active) => api.patch(`/medicines/${id}/active`, { active }),
  listAvailability: (id) => api.get(`/medicines/${id}/availability`),
  setAvailability: (id, payload) => api.put(`/medicines/${id}/availability`, payload),
};

export default medicinesApi;
