import { api } from './apiClient';
import { memoryCache } from '../../utils/memoryCache';

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

const MEDICINE_LIST_TTL = 15 * 60 * 1000; // 15 minutes

export const medicinesApi = {
  list: (params) => {
    // Cache full catalog (no query), invalidate on mutations
    if (!params || Object.keys(params).length === 0) {
      return memoryCache.getOrFetch(
        'medicines:catalog',
        () => api.get('/medicines', { params }),
        MEDICINE_LIST_TTL
      );
    }
    return api.get('/medicines', { params });
  },
  create: (payload) => {
    memoryCache.invalidate('medicines:catalog');
    return api.post('/medicines', payload);
  },
  update: (id, payload) => {
    memoryCache.invalidate('medicines:catalog');
    return api.put(`/medicines/${id}`, payload);
  },
  setActive: (id, active) => {
    memoryCache.invalidate('medicines:catalog');
    return api.patch(`/medicines/${id}/active`, { active });
  },
};

export default medicinesApi;
