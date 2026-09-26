import { api } from './apiClient';

const resource = (kind) => ({
  list: (params) => api.get(`/operational/${kind}`, { params }),
  create: (record) => api.post(`/operational/${kind}`, { record }),
  update: (id, record) => api.put(`/operational/${kind}/${id}`, { record }),
});

export const followUpsApi = resource('followups');
export const tclApi = resource('tcl');
export const maternalApi = resource('maternal');
export const immunizationsApi = resource('immunizations');
export const notificationsApi = resource('notifications');

export default { followUpsApi, tclApi, maternalApi, immunizationsApi, notificationsApi };