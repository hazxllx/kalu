import { api } from './apiClient';

/**
 * Auth API (Supabase-backed, via the Express backend).
 * The frontend usually authenticates through `@/lib/supabase` directly; these
 * helpers exist for flows that prefer to go through the backend.
 */
export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  // Self-service update of the signed-in account's own contact number.
  updateMe: (payload) => api.patch('/auth/me', payload),
  logout: () => api.post('/auth/logout'),
};

export default authApi;
