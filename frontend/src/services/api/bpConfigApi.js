// frontend/src/services/api/bpConfigApi.js
import { api } from './apiClient';
import { setBloodPressureConfig } from '../../../../shared/bloodPressure.js';

const applyConfig = (config) => {
  if (!config?.thresholds || !setBloodPressureConfig(config)) {
    throw new Error('The server returned an invalid blood-pressure configuration.');
  }
  return config;
};

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
  get: async () => applyConfig(await api.get('/bp-config')),
  updateThresholds: async (payload) => applyConfig(await api.put('/bp-config/thresholds', payload)),
};

export default bpConfigApi;
