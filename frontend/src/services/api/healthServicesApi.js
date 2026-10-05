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
  assign: (id, personnelId) => api.post(`/health-services/${id}/assign`, { personnelId }),
  unassign: (id, personnelId) => api.delete(`/health-services/${id}/assign/${personnelId}`),
};

export default healthServicesApi;
