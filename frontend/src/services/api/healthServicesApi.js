import { api } from './apiClient';

/**
 * Health services API — scoped catalog + personnel assignment. Backed by
 * /api/health-services (Express + Supabase public.health_services and
 * public.health_service_assignments).
 *
 * Visibility, municipality/barangay scope and management authority are all
 * enforced server-side and by RLS; an assigned service appears in the assignee's
 * account via list({ mine: true }).
 */
export const healthServicesApi = {
   meta: () => api.get('/health-services/meta'),
   // params: { mine: true, category }
   // params: { from, to } for calendar scope
   // params: { service_id } | { resident_id } | { from, to } for dashboard listing
   listAttendance: (params) => api.get('/health-services/attendance', { params }),
  // Municipality-scoped barangays + facilities + categories for the create form.
  reference: () => api.get('/health-services/reference'),
  // params: { mine: true, category }
  list: (params) => api.get('/health-services', { params }),
  // Assignable personnel in the caller's municipality (managers only).
  personnel: () => api.get('/health-services/personnel'),
  get: (id) => api.get(`/health-services/${id}`),
  create: (payload) => api.post('/health-services', payload),
  // Update an existing service in place (content or status). Never creates a
  // new record — the id is preserved and registrations/attendance are kept.
  update: (id, payload) => api.patch(`/health-services/${id}`, payload),
  // Delete a service. The backend refuses (409) when the service has resident
  // registrations or attendance records, directing the caller to deactivate.
  remove: (id) => api.delete(`/health-services/${id}`),
  // Edit an existing service in place (never creates a new one).
  update: (id, payload) => api.patch(`/health-services/${id}`, payload),
  // Activate / deactivate (archive) a service — reversible soft status toggle.
  setActive: (id, active) => api.patch(`/health-services/${id}/active`, { active }),
  // Safe delete: refused by the backend (409) when resident registrations,
  // attendance, or appointments exist — deactivate instead in that case.
  remove: (id) => api.delete(`/health-services/${id}`),
  assign: (id, personnelId) => api.post(`/health-services/${id}/assign`, { personnelId }),
  unassign: (id, personnelId) => api.delete(`/health-services/${id}/assign/${personnelId}`),
  // Resident registrations (visit plans) for one service, with any recorded
  // attendance — the staff roster. Returns { service, registrations, counts }.
  registrations: (id) => api.get(`/health-services/${id}/registrations`),
  // Record / update attendance against a service + resident.
  createAttendance: (payload) => api.post('/health-services/attendance', payload),
  updateAttendance: (id, payload) => api.patch(`/health-services/attendance/${id}`, payload),
};

export default healthServicesApi;
