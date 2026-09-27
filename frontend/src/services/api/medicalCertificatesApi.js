import { api } from './apiClient';

/**
 * Medical certificate register API.
 *
 * Backed by /api/medical-certificates (Express + Supabase
 * `medical_certificates` / `medical_certificate_logs`).
 *
 * Roles (enforced server-side, not by the UI):
 *   RHU Personnel / PHN / MHO -> prepare a certificate and submit it for review
 *   PHN / MHO                 -> approve, issue or reject (the review actions)
 *   BHW / System Admin        -> 403
 *
 * The status vocabulary, purposes and legal transitions are served by
 * /meta so the register never has to keep its own copy in step with the API.
 */
export const medicalCertificatesApi = {
  meta: () => api.get('/medical-certificates/meta'),
  nextReference: () => api.get('/medical-certificates/next-reference'),

  list: (params) => api.get('/medical-certificates', { params }),
  get: (id) => api.get(`/medical-certificates/${id}`),

  create: (payload) => api.post('/medical-certificates', payload),
  update: (id, payload) => api.put(`/medical-certificates/${id}`, payload),
  changeStatus: (id, status, notes = '') =>
    api.patch(`/medical-certificates/${id}/status`, { status, notes }),

  submitForReview: (id) => medicalCertificatesApi.changeStatus(id, 'For Review'),
  approve: (id, notes = '') => medicalCertificatesApi.changeStatus(id, 'Approved', notes),
  issue: (id, notes = '') => medicalCertificatesApi.changeStatus(id, 'Issued', notes),
  reject: (id, notes) => medicalCertificatesApi.changeStatus(id, 'Rejected', notes),
  cancel: (id, notes = '') => medicalCertificatesApi.changeStatus(id, 'Cancelled', notes),
};

export default medicalCertificatesApi;
