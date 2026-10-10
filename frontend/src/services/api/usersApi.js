import { api } from './apiClient';

/**
 * Admin User Management API (admin-only backend). Thin wrapper over the
 * centralized apiClient. The `profiles` table is the source of truth; the
 * backend resolves the caller's admin role server-side.
 *
 *   GET /users            list accounts (params: q, role, status, limit, offset)
 *   GET /users/options    role and geographic assignment choices
 *   GET /users/summary    real account totals (all / active / pending / disabled)
 *   POST /users           invite and provision an Auth account
 *   GET /users/:id        one account
 *   PUT /users/:id        update profile fields / role / status
 *   POST /users/:id/access-reset send a password recovery email
 *   DELETE /users/:id     permanently delete the account (requires email confirmation)
 */
export const usersApi = {
  list: (params) => api.get('/users', { params }),
  options: () => api.get('/users/options'),
  summary: () => api.get('/users/summary'),
  create: (user) => api.post('/users', { user }),
  get: (id) => api.get(`/users/${id}`),
  update: (id, user) => api.put(`/users/${id}`, { user }),
  resetAccess: (id) => api.post(`/users/${id}/access-reset`, {}),
  remove: (id, confirmEmail) => api.delete(`/users/${id}`, { body: { confirmEmail } }),
};

export default usersApi;
