import { api } from './apiClient';

export const municipalityOnboardingApi = {
  submit: (payload) => api.post('/municipality-onboarding', payload),
  getStatus: (reference) => api.get(`/municipality-onboarding/${encodeURIComponent(reference)}`),
  resubmit: (reference, payload) => api.post(`/municipality-onboarding/${encodeURIComponent(reference)}/resubmit`, payload),
  getVerification: (token) => api.get(`/municipality-onboarding/verification/${encodeURIComponent(token)}`),
  decideVerification: (token, payload) => api.post(`/municipality-onboarding/verification/${encodeURIComponent(token)}/decision`, payload),
};

export default municipalityOnboardingApi;