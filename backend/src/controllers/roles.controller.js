// backend/src/controllers/roles.controller.js
/**
 * Role and permission matrix controller (BUG-011).
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> roles.controller -> roles.service -> repository/Supabase`
 *
 * Endpoints handled:
 *   GET   /api/roles/permissions          read the full RBAC permission matrix (authenticated staff)
 *   PATCH /api/roles/:role/permissions    replace permission overrides for one role (admin only)
 */
import * as rolesService from '../services/roles.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Handles `GET /api/roles/permissions` — returns the effective role-to-permission
 * matrix visible to `req.user` via `rolesService.getPermissionMatrix()`.
 * Responds with `200 OK` (`{ matrix }`) via `sendData`.
 *
 * @param {Object} req - Express request with authenticated `user`.
 * @param {Object} res - Express response.
 */
export const getPermissions = async (req, res) => {
  const matrix = await rolesService.getPermissionMatrix({ user: req.user });
  sendData(res, { matrix });
};

/**
 * Handles `PATCH /api/roles/:role/permissions` — replaces custom permission
 * overrides for role `req.params.role` with `req.body.permissions` on behalf of
 * admin `req.user` via `rolesService.updateRolePermissions()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `params.role`, `{ permissions }` in `body`, and admin `user`.
 * @param {Object} res - Express response.
 */
export const updateRolePermissions = async (req, res) => {
  const result = await rolesService.updateRolePermissions({
    user: req.user,
    role: req.params.role,
    permissions: req.body.permissions || {},
  });
  sendData(res, result);
};

export default { getPermissions, updateRolePermissions };
