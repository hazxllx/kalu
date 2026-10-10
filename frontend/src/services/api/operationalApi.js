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
export const notificationsApi = resource('notifications');

export default { followUpsApi, tclApi, maternalApi, maternalVisitsApi, immunizationsApi, notificationsApi };