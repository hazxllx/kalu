import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as rolesController from '../controllers/roles.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Role & permission matrix (BUG-011).
 *
 *   GET   /roles/permissions         any authenticated staff (drives UI)
 *   PATCH /roles/:role/permissions   administrators only
 *
 * The authoritative matrix lives in public.role_permissions; writes are
 * admin-only at BOTH this layer and RLS, so browser-storage tampering can never
 * grant access.
 */
const router = Router();
router.use(authenticate);

router.get('/permissions', asyncHandler(rolesController.getPermissions));
router.patch(
  '/:role/permissions',
  authorize(FEATURE_ROLES.users, { permission: 'accounts.roles.manage' }),
  asyncHandler(rolesController.updateRolePermissions),
);

export default router;
