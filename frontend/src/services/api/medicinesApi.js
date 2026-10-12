import { api } from './apiClient';

/**
 * Medicine catalog API (generic-first, searchable by generic OR brand name).
 *
 *   list({ q, source, includeInactive }) -> { medicines: [...] }
 *   create(payload)                      -> { medicine }
 *   update(id, payload)                  -> { medicine }
 *   setActive(id, active)                -> { medicine }
 *
 * Catalog reads are available to clinical roles (consultation form search);
 * writes are admin-only (enforced server-side). There is no stock/availability
 * tracking on medicines.
 */
export const medicinesApi = {
  list: (params) => api.get('/medicines', { params }),
  create: (payload) => api.post('/medicines', payload),
  update: (id, payload) => api.put(`/medicines/${id}`, payload),
  setActive: (id, active) => api.patch(`/medicines/${id}/active`, { active }),
};

export default medicinesApi;
