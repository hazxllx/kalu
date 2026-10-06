import api from './apiClient';

export const guardianLinksApi = {
  getMine: async () => api.get('/guardian-links/mine'),
  request: async ({ email, relationshipType }) =>
    api.post('/guardian-links/mine/request', { email, relationshipType }),
  cancel: async () => api.patch('/guardian-links/mine/cancel', {}),
  getIncoming: async () => {
    const payload = await api.get('/guardian-links/mine/incoming');
    return payload?.requests || [];
  },
  respond: async (id, decision) =>
    api.patch(`/guardian-links/${encodeURIComponent(id)}/respond`, { decision }),
  listForMinor: async (minorId) => {
    const payload = await api.get(`/guardian-links/minor/${encodeURIComponent(minorId)}`);
    return payload?.guardianLinks || [];
  },
  review: async (id, decision, note = '') =>
    api.patch(`/guardian-links/${encodeURIComponent(id)}/review`, { decision, note }),
};

export default guardianLinksApi;
