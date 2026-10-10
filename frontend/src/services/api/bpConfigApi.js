import { api } from './apiClient';

/**
 * Blood-pressure threshold configuration API.
 *
 *   get()                     -> { thresholds, labels, categories, defaults, source, updatedAt }
 *   updateThresholds(payload) -> same shape (admin only)
 *
 * The active thresholds are read by the consultation form to classify a
 * recorded reading; updates are admin-only (enforced server-side).
 */
export const bpConfigApi = {
  get: () => api.get('/bp-config'),
  updateThresholds: (payload) => api.put('/bp-config/thresholds', payload),
};

export default bpConfigApi;
