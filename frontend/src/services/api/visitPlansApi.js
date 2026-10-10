import { api } from './apiClient';

/**
 * Resident Health Services directory + "I plan to visit" intent — backed by
 * /api/resident/* (Express + Supabase public.visit_plans, reusing the
 * health_services catalog and appointment_schedules/blackouts for availability).
 *
 * Resident self-service only: ownership and barangay/RHU scope are derived from
 * the authenticated session server-side, so no resident id is sent from the
 * client. This is deliberately separate from the staff appointment system — a
 * resident never sees an appointment status, approval queue or plan dashboard.
 */
export const visitPlansApi = {
  // Active services for the resident's barangay health center + its RHU,
  // grouped by facility, each with its schedule summary and the resident's own
  // active plan (if any).
  directory: () => api.get('/resident/health-services'),
  // Selectable visit days for one service (next 14 days, service weekdays only,
  // minus closures). params: { from, to } optional.
  availability: (serviceId, params) => api.get(`/resident/health-services/${serviceId}/availability`, { params }),
  // Record a visit intent. payload: { serviceId, plannedDate, note? }.
  create: (payload) => api.post('/resident/visit-plans', payload),
  // Remove (cancel) the resident's own future plan.
  remove: (id) => api.delete(`/resident/visit-plans/${id}`),
  // Optional: the resident's own active plans (used to render inline lines).
  list: (serviceId) => api.get('/resident/visit-plans', { params: serviceId ? { service_id: serviceId } : undefined }),
};

export default visitPlansApi;
