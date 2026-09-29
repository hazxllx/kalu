import { api } from "./apiClient";

/**
 * Role & permission matrix API (BUG-011).
 *
 * The authoritative access-control configuration lives in PostgreSQL
 * (public.role_permissions) behind /api/roles. localStorage is no longer the
 * source of truth: the matrix is loaded from and saved to the server, writes
 * are admin-only (API + RLS), and every change is audited server-side.
 */
export const rolesApi = {
  /** Full stored matrix: { [role]: { [permissionId]: granted } }. */
  getMatrix: async () => {
    const payload = await api.get("/roles/permissions");
    return payload?.matrix || {};
  },
  /** Replace one role's overrides (administrators only). */
  updateRolePermissions: (role, permissions) =>
    api.patch(`/roles/${role}/permissions`, { permissions }),
};

export default rolesApi;
