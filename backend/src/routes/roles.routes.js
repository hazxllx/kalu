// backend/src/routes/roles.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as rolesController from '../controllers/roles.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Role & permission matrix routes (BUG-011).
 *
 * Role in KALUSAGAP:
 * Serves the server-authoritative RBAC permission matrix (`public.role_permissions`)
 * to hydrate client UI capability flags and allows system administrators to
 * customize non-locked permissions per role.
 *
 * Architectural pipeline:
 *   route -> authenticate -> [authorize(FEATURE_ROLES.users, 'accounts.roles.manage')]
 *         -> roles.controller -> roles.service -> Supabase
 *
 * Security & RLS:
 * Writes are restricted to administrators at BOTH this Express middleware layer
 * and Supabase RLS, ensuring client-side storage tampering can never escalate
 * backend privileges.
 */
const router = Router();
router.use(authenticate);

// GET /permissions : Returns effective permissions for the authenticated caller's role,
// or the full multi-role matrix + metadata when requested by an administrator.
router.get('/permissions', asyncHandler(rolesController.getPermissions));

// PATCH /:role/permissions : Updates the granted permission list in `req.body` for
// target `:role` (`FEATURE_ROLES.users` + `accounts.roles.manage`).
router.patch(
  '/:role/permissions',
  authorize(FEATURE_ROLES.users, { permission: 'accounts.roles.manage' }),
  asyncHandler(rolesController.updateRolePermissions),
);

export default router;
