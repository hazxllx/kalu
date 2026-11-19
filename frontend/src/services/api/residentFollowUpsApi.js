import { api } from './apiClient';

/**
 * Resident-facing follow-up API (resident self-service).
 *
 * Talks ONLY to the dedicated resident endpoints (`/resident/follow-ups`). The
 * backend derives ownership from the authenticated session, so no resident id
 * is ever sent from the client. Residents never call the staff
 * `/operational/followups` endpoints.
 */
export const residentFollowUpsApi = {
  list: () => api.get('/resident/follow-ups'),
  get: (id) => api.get(`/resident/follow-ups/${id}`),
  approve: (id) => api.post(`/resident/follow-ups/${id}/approve`, {}),
  reject: (id, reason) => api.post(`/resident/follow-ups/${id}/reject`, { reason }),
  request: (request) => api.post('/schedule-requests', request),
  listScheduleRequests: () => api.get('/schedule-requests'),
  decideScheduleRequest: (id, decision, reviewReason = '') => api.put(`/schedule-requests/${id}`, { decision, reviewReason }),
};

export default residentFollowUpsApi;
