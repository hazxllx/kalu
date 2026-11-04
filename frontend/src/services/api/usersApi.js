import { api } from './apiClient';

/**
 * Admin User Management API (admin-only backend). Thin wrapper over the
 * centralized apiClient. The `profiles` table is the source of truth; the
 * backend resolves the caller's admin role server-side.
 *
 *   GET /users            list accounts (params: q, role, status, limit, offset)
 *   GET /users/options    role and geographic assignment choices
 *   GET /users/summary    real account totals (all / active / pending / disabled)
 *   POST /users           provision an account with approval and activation choices
 *   GET /users/:id        one account
 *   PUT /users/:id        update profile fields / role / status
 *   POST /users/:id/access-reset send a password recovery email
 *   POST /users/:id/lifecycle admin personnel approval, suspension, and email actions
 *   GET /users/:id/history personnel audit and notification history
 *   DELETE /users/:id     permanently delete the account (requires email confirmation)
 */
export const usersApi = {
  list: (params) => api.get('/users', { params }),
  options: () => api.get('/users/options'),
  summary: (params) => api.get('/users/summary', { params }),
  create: (user, options = {}) => api.post('/users', { user }, options),
  get: (id) => api.get(`/users/${id}`),
  update: (id, user) => api.put(`/users/${id}`, { user }),
  resetAccess: (id) => api.post(`/users/${id}/access-reset`, {}),
  lifecycle: (id, payload) => api.post(`/users/${id}/lifecycle`, payload),
  history: (id) => api.get(`/users/${id}/history`),
  remove: (id, confirmEmail) => api.delete(`/users/${id}`, { body: { confirmEmail } }),
};

export default usersApi;
