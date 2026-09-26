import { api } from './apiClient';

/**
 * FHSIS M1 reporting API (backend routes/m1.routes.js).
 *
 * The backend enforces barangay/municipality scope on every call from the
 * authenticated session; the client never sends a barangay id for a
 * barangay-scoped user. Every returned total is computed from real underlying
 * records and is traceable via drilldown().
 */
export const m1Api = {
  // Reference catalog (all indicators, grouped by section/subsection).
  catalog: () => api.get('/m1/catalog'),

  // Daily participants for a date (defaults to today server-side).
  daily: (params) => api.get('/m1/daily', { params }),

  // Full monthly report (all sections/indicators, even zeros).
  monthly: (params) => api.get('/m1/monthly', { params }),

  // Annual summary: 12-month matrix + annual total per indicator.
  annual: (params) => api.get('/m1/annual', { params }),

  // Underlying records behind one indicator total.
  drilldown: (code, params) => api.get(`/m1/drilldown/${encodeURIComponent(code)}`, { params }),

  // Report header + workflow metadata.
  getMeta: (params) => api.get('/m1/meta', { params }),
  saveMeta: (meta, params) => api.put('/m1/meta', { meta }, { params }),

  // Section-level remarks.
  saveRemarks: (code, body) => api.put(`/m1/remarks/${encodeURIComponent(code)}`, body),

  // Underlying event record CRUD (m1_records).
  createRecord: (record) => api.post('/m1/records', { record }),
  updateRecord: (id, record) => api.put(`/m1/records/${id}`, { record }),
  deleteRecord: (id) => api.delete(`/m1/records/${id}`),
};

export default m1Api;
