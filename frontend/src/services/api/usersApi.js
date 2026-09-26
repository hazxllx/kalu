import { api } from './apiClient';

/**
 * Admin User Management API (admin-only backend). Thin wrapper over the
 * centralized apiClient. The `profiles` table is the source of truth; the
 * backend resolves the caller's admin role server-side.
 *
 *   GET /users            list accounts (params: q, role, status, limit, offset)
 *   GET /users/:id        one account
 *   PUT /users/:id        update profile fields / role / status
 *
 * Account creation/deletion and credential changes are handled through the
 * Supabase Auth lifecycle, not this endpoint.
 */
export const usersApi = {
  list: (params) => api.get('/users', { params }),
  get: (id) => api.get(`/users/${id}`),
  update: (id, user) => api.put(`/users/${id}`, { user }),
};

export default usersApi;
