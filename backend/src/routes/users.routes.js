import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/users.controller.js';

/**
 * Account / system administration — Admin User Management.
 *
 * Every route authenticates the Supabase token and then requires the `admin`
 * role (`FEATURE_ROLES.users`). The role is resolved server-side from the
 * `profiles` table by `authenticate`; it is never taken from the client. A PHN,
 * Health Supervisor, Resident, etc. receives 403 on every route here, and an
 * unauthenticated caller receives 401.
 *
 *   GET  /api/users        list accounts (search: ?q, ?role, ?status; ?limit,?offset)
 *   GET  /api/users/options assignment and role options for the admin editor
 *   GET  /api/users/summary real account totals for the summary cards
 *   POST /api/users        invite and provision a real Supabase Auth account
 *   GET  /api/users/:id    read one account
 *   PUT  /api/users/:id    update profile, role and scope / status
 *   POST /api/users/:id/access-reset send a Supabase password recovery email
 *   DELETE /api/users/:id  permanently delete the Auth identity + profile
 */
const router = Router();

router.use(authenticate, authorize(FEATURE_ROLES.users));

router.get('/options', authorize(FEATURE_ROLES.users, { permission: 'accounts.view' }), asyncHandler(controller.getAccountOptions));
router.get('/summary', authorize(FEATURE_ROLES.users, { permission: 'accounts.view' }), asyncHandler(controller.getAccountSummary));
router.get('/', authorize(FEATURE_ROLES.users, { permission: 'accounts.view' }), asyncHandler(controller.listUsers));
router.post(
  '/',
  authorize(FEATURE_ROLES.users, {
    allPermissions: (req) => {
      const input = req.body?.user || req.body || {};
      const permissions = ['accounts.create', 'accounts.roles.manage'];
      if (input.status === 'disabled') permissions.push('accounts.deactivate');
      return permissions;
    },
  }),
  asyncHandler(controller.createUser),
);
router.get('/:id', authorize(FEATURE_ROLES.users, { permission: 'accounts.view' }), asyncHandler(controller.getUser));
router.put(
  '/:id',
  authorize(FEATURE_ROLES.users, {
    allPermissions: (req) => {
      const patch = req.body?.user || req.body || {};
      const permissions = [];
      const hasProfileEdit = ['name', 'fullName', 'contact', 'position', 'licenseNo', 'municipalityId', 'barangayId', 'facilityId']
        .some((field) => Object.prototype.hasOwnProperty.call(patch, field));
      if (hasProfileEdit) permissions.push('accounts.edit');
      if (Object.prototype.hasOwnProperty.call(patch, 'role')) {
        permissions.push('accounts.edit', 'accounts.roles.manage');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'status')) permissions.push('accounts.deactivate');
      if (permissions.length === 0) permissions.push('accounts.edit');
      return permissions;
    },
  }),
  asyncHandler(controller.updateUser),
);
router.post(
  '/:id/access-reset',
  authorize(FEATURE_ROLES.users, { permission: 'accounts.access.reset' }),
  asyncHandler(controller.resetUserAccess),
);
router.delete(
  '/:id',
  authorize(FEATURE_ROLES.users, { permission: 'accounts.delete' }),
  asyncHandler(controller.deleteUser),
);

export default router;
