import { api } from './apiClient';

/**
 * Risk assessment configuration API.
 *
 * Reads the authoritative resident risk criteria + thresholds (clinical /
 * monitoring roles + admin) and lets the System Administrator edit them. The
 * backend recomputes affected residents on every change, so the new
 * classification propagates everywhere resident risk is shown.
 */
export const riskConfigApi = {
  get: () => api.get('/risk-config'),
  updateThresholds: (payload) => api.put('/risk-config/thresholds', payload),
  saveCriterion: (payload) =>
    payload?.code && payload?.exists
      ? api.put(`/risk-config/criteria/${encodeURIComponent(payload.code)}`, payload)
      : api.post('/risk-config/criteria', payload),
  deleteCriterion: (code) => api.delete(`/risk-config/criteria/${encodeURIComponent(code)}`),
  recalculate: () => api.post('/risk-config/recalculate', {}),
};

export default riskConfigApi;
