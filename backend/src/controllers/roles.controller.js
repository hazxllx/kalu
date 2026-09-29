/**
 * Role & permission matrix endpoints (BUG-011).
 *   GET   /api/roles/permissions          read the full matrix (any staff)
 *   PATCH /api/roles/:role/permissions    replace one role's overrides (admin)
 */
import * as rolesService from '../services/roles.service.js';
import { sendData } from '../utils/apiResponse.js';

export const getPermissions = async (req, res) => {
  const matrix = await rolesService.getPermissionMatrix({ user: req.user });
  sendData(res, { matrix });
};

export const updateRolePermissions = async (req, res) => {
  const result = await rolesService.updateRolePermissions({
    user: req.user,
    role: req.params.role,
    permissions: req.body.permissions || {},
  });
  sendData(res, result);
};

export default { getPermissions, updateRolePermissions };
