import { api } from './apiClient';
import { memoryCache } from '../../utils/memoryCache';

/**
 * Health services API — scoped catalog + personnel assignment. Backed by
 * /api/health-services (Express + Supabase public.health_services and
 * public.health_service_assignments).
 *
 * Visibility, municipality/barangay scope and management authority are all
 * enforced server-side and by RLS; an assigned service appears in the assignee's
 * account via list({ mine: true }).
 */

const METADATA_TTL = 15 * 60 * 1000; // 15 minutes
const REFERENCE_TTL = 10 * 60 * 1000; // 10 minutes

export const healthServicesApi = {
  meta: () => {
    return memoryCache.getOrFetch(
      'health-services:meta',
      () => api.get('/health-services/meta'),
      METADATA_TTL
    );
  },
  // params: { mine: true, category }
  // params: { from, to } for calendar scope
  // params: { service_id } | { resident_id } | { from, to } for dashboard listing
   listAttendance: (params) => api.get('/health-services/attendance', { params }),
  // Municipality-scoped barangays + facilities + categories for the create form.
  reference: () => {
    return memoryCache.getOrFetch(
      'health-services:reference',
      () => api.get('/health-services/reference'),
      REFERENCE_TTL
    );
  },
  // params: { mine: true, category }
  list: (params, options) => api.get('/health-services', { ...options, params }),
  // Assignable personnel in the caller's municipality (managers only).
  personnel: () => api.get('/health-services/personnel'),
  get: (id) => api.get(`/health-services/${id}`),
  create: (payload) => {
    memoryCache.invalidate('health-services:meta');
    memoryCache.invalidate('health-services:reference');
    return api.post('/health-services', payload);
  },
  // Update an existing service in place (content or status). Never creates a
  // new record — the id is preserved and registrations/attendance are kept.
  update: (id, payload) => {
    memoryCache.invalidate('health-services:meta');
    memoryCache.invalidate('health-services:reference');
    return api.patch(`/health-services/${id}`, payload);
  },
  // Delete a service. The backend refuses (409) when the service has resident
  // registrations or attendance records, directing the caller to deactivate.
  remove: (id) => {
    memoryCache.invalidate('health-services:meta');
    memoryCache.invalidate('health-services:reference');
    return api.delete(`/health-services/${id}`);
  },
  // Activate / deactivate (archive) a service — reversible soft status toggle.
  setActive: (id, active) => {
    memoryCache.invalidate('health-services:meta');
    memoryCache.invalidate('health-services:reference');
    return api.patch(`/health-services/${id}/active`, { active });
  },
  // Safe delete: refused by the backend (409) when resident registrations,
  // attendance, or appointments exist — deactivate instead in that case.
  assign: (id, personnelId) => api.post(`/health-services/${id}/assign`, { personnelId }),
  unassign: (id, personnelId) => api.delete(`/health-services/${id}/assign/${personnelId}`),
  // Resident registrations (visit plans) for one service, with any recorded
  // attendance — the staff roster. Returns { service, registrations, counts }.
  registrations: (id) => api.get(`/health-services/${id}/registrations`),
  // Record / update attendance against a service + resident.
  createAttendance: (payload) => api.post('/health-services/attendance', payload),
  updateAttendance: (id, payload) => api.patch(`/health-services/attendance/${id}`, payload),
  // Upload a health service attachment (memo or pubmat).
  uploadAttachment: (serviceId, attachmentType, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/health-services/${serviceId}/attachments/${attachmentType}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // Get a signed URL for downloading an attachment.
  getAttachmentSignedUrl: (serviceId, attachmentType) => api.get(`/health-services/${serviceId}/attachments/${attachmentType}`),
  // Delete a health service attachment.
  deleteAttachment: (serviceId, attachmentType) => api.delete(`/health-services/${serviceId}/attachments/${attachmentType}`),
};

export default healthServicesApi;
