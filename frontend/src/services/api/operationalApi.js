import { api } from './apiClient';

const resource = (kind) => ({
  list: (params) => api.get(`/operational/${kind}`, { params }),
  create: (record, options) => api.post(`/operational/${kind}`, { record }, options),
  update: (id, record, options) => api.put(`/operational/${kind}/${id}`, { record }, options),
  remove: (id) => api.delete(`/operational/${kind}/${id}`),
});

export const followUpsApi = resource('followups');
export const tclApi = resource('tcl');
export const maternalApi = resource('maternal');
export const maternalVisitsApi = resource('maternalvisits');
export const immunizationsApi = resource('immunizations');
export const notificationsApi = {
  ...resource('notifications'),
  // Mark one notification read. The empty record body is intentional — the
  // server sets `read_at` and ignores any client-supplied fields.
  markRead: (id, options) => api.put(`/operational/notifications/${id}`, { record: {} }, options),
  // Mark every unread notification for the authenticated user read in one
  // atomic request (avoids the per-row race of firing N parallel updates).
  markAllRead: (options) => api.put('/operational/notifications/read-all', { record: {} }, options),
};

export default { followUpsApi, tclApi, maternalApi, maternalVisitsApi, immunizationsApi, notificationsApi };