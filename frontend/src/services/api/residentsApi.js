import { api } from './apiClient.js';

/**
 * Residents API. Thin wrapper over the centralized apiClient so components and
 * hooks never build resident URLs themselves.
 *
 * Live endpoints (role-scoped: Health Supervisor / PHN / MHO — NOT BHW):
 *   GET  /residents        directory listing + search, scope-enforced
 *   POST /residents        register a resident (validated, duplicate-guarded)
 *   GET  /residents/:id    single record (within the caller's scope)
 *   PUT  /residents/:id    permitted demographic corrections
 */
export const residentsApi = {
  list: (params) => api.get('/residents', { params }),
  get: (id) => api.get(`/residents/${id}`),
  create: (payload, options) => api.post('/residents', payload, options),
  update: (id, payload, options) => api.put(`/residents/${id}`, payload, options),
  remove: (id) => api.delete(`/residents/${id}`),
  // Invite + link a login account for an EXISTING resident record. The backend
  // creates the Supabase Auth user, links residents.auth_user_id, and leaves the
  // account Pending Activation. It never duplicates the resident or changes the
  // verification status.
  createAccount: (id, payload) => api.post(`/residents/${id}/account`, payload),
  // Resident self-service: update own profile (contact number). The resident is
  // derived from the authenticated session server-side; no id is sent.
  updateMine: (payload) => api.patch('/residents/me', payload),
  // Resident self-service: own health record (basic profile + own completed
  // consultations). Identity is resolved from the session; no id is sent.
  // Consultation-history filters (from/to date, serviceId, type, status) are
  // applied server-side to the caller's own records.
  myHealthRecords: (params) => api.get('/residents/me/health-records', { params }),
};

export default residentsApi;
