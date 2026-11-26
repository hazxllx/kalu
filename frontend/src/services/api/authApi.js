// frontend/src/services/api/authApi.js
import { api } from './apiClient';

/**
 * Auth API (Supabase-backed, via the Express backend).
 * The frontend usually authenticates through `@/lib/supabase` directly; these
 * helpers exist for flows that prefer to go through the backend.
 */
export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  requestPasswordReset: (email) => api.post('/auth/forgot-password', { email }),
  me: (options) => api.get('/auth/me', options),
  // Self-service update of the signed-in account's own contact number.
  updateMe: (payload) => api.patch('/auth/me', payload),
  logout: (options) => api.post('/auth/logout', undefined, options),
  personnelSetupStatus: (token) => api.get('/auth/personnel/setup-status', {
    headers: { Authorization: `Bearer ${token}` },
  }),
  personnelPasswordSetup: (password, token, recoverySecret) => api.post('/auth/personnel/password-setup', {
    password, ...(recoverySecret ? { recoverySecret } : {}),
  }, {
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  }),
  temporaryPersonnelPasswordChange: (password, token) => api.post('/auth/personnel/temporary-password-change', { password }, {
    headers: { Authorization: `Bearer ${token}` },
  }),
};

export default authApi;
