import { api } from './apiClient';

/**
 * Appointment booking API — backed by /api/appointments (Express + Supabase
 * public.appointments / appointment_schedules / appointment_blackouts).
 *
 * This module is BHW/staff-only. Residents no longer book or manage
 * appointments: the resident portal exposes a read-only Health Services
 * directory with a lightweight "I plan to visit" intent (see
 * `visitPlansApi`). Staff management + scheduling use the barangay-scoped staff
 * endpoints (authority re-enforced by the backend and Supabase RLS).
 */
export const appointmentsApi = {
  // Staff management
  list: (params) => api.get('/appointments', { params }),
  get: (id) => api.get(`/appointments/${id}`),
  approve: (id, payload) => api.post(`/appointments/${id}/approve`, payload || {}),
  decline: (id, reason) => api.post(`/appointments/${id}/decline`, { reason }),
  propose: (id, payload) => api.post(`/appointments/${id}/propose`, payload),
  cancel: (id, reason) => api.post(`/appointments/${id}/cancel`, { reason }),
  outcome: (id, status, note) => api.post(`/appointments/${id}/outcome`, { status, note }),

  // Schedule + closure configuration
  listSchedules: (serviceId) => api.get('/appointments/schedules', { params: { serviceId } }),
  createSchedule: (payload) => api.post('/appointments/schedules', payload),
  updateSchedule: (id, payload) => api.put(`/appointments/schedules/${id}`, payload),
  deleteSchedule: (id) => api.delete(`/appointments/schedules/${id}`),
  listBlackouts: (serviceId) => api.get('/appointments/blackouts', { params: { serviceId } }),
  createBlackout: (payload) => api.post('/appointments/blackouts', payload),
  deleteBlackout: (id) => api.delete(`/appointments/blackouts/${id}`),
};

export default appointmentsApi;
