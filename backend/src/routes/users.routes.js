import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import validate from '../middleware/validate.js';
import {
  accessResetValidator,
  createUserValidator,
  updateUserValidator,
  userIdParamValidator,
  userQueryValidator,
  personnelLifecycleValidator,
} from '../validators/users.validators.js';
import * as controller from '../controllers/users.controller.js';

/**
 * Role-scoped User & Personnel Account Management routes.
 *
 * Role in KALUSAGAP:
 * Administrators retain full lifecycle governance. PHNs can create and manage
 * Health Supervisors and RHU Personnel within their municipality; Health
 * Supervisors can create and manage BHW accounts in their assigned barangay.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(FEATURE_ROLES.personnelManagement) -> [validate]
 *         -> authorize(dynamicPermissions) -> users.controller
 *         -> users.service -> Supabase Auth (service role) & DB
 *
 * Security & RBAC:
 * Every route resolves the caller's role server-side from `public.profiles` via
 * `authenticate`. Delegated role and coverage checks are repeated by the service
 * and database RPCs. Administrators retain payload-sensitive permission checks
 * (`accounts.create`,
 * `accounts.edit`, `accounts.roles.manage`, `accounts.personnel.approve`,
 * `accounts.deactivate`, `accounts.access.reset`, `accounts.delete`).
 *
 * Endpoints:
 *   GET    /api/users                   List accounts (`?q`, `?role`, `?status`, `?limit`, `?offset`)
 *   GET    /api/users/options           Role, geography, facility, and RHU station options
 *   GET    /api/users/summary           Aggregate account totals for admin summary cards
 *   POST   /api/users                   Provision a managed Supabase Auth + profile account
 *   GET    /api/users/:id               Read single account details
 *   PUT    /api/users/:id               Update profile, role, geography/station scope, or status
 *   POST   /api/users/:id/access-reset  Trigger password recovery / credential reset
 *   POST   /api/users/:id/lifecycle     Approve, reject, suspend, reactivate, or invite/retry
 *   GET    /api/users/:id/history       Account audit log + sanitized notification history
 *   DELETE /api/users/:id               Permanently delete Auth identity + profile
 */
const router = Router();

router.use(authenticate, authorize(FEATURE_ROLES.personnelManagement));

const adminOrPersonnelManager = (options = null) => (req, res, next) => {
  if (req.user?.role === 'admin') {
    if (options) return authorize(FEATURE_ROLES.users, options)(req, res, next);
    return authorize(FEATURE_ROLES.users)(req, res, next);
  }
  // PHN and Health Supervisor scope/field restrictions are enforced again in
  // users.service and the delegated database RPCs.
  return next();
};

const administratorOnly = (options = {}) => authorize(FEATURE_ROLES.users, options);

// Read & reference endpoints (`accounts.view`):
// - GET /options : Assignment dropdown metadata (roles, municipalities, barangays, facilities, stations).
// - GET /summary : Filtered/global account status counters (`userQueryValidator`).
// - GET /        : Paginated account directory (`userQueryValidator`).
router.get('/options', adminOrPersonnelManager({ permission: 'accounts.view' }), asyncHandler(controller.getAccountOptions));
router.get('/summary', adminOrPersonnelManager({ permission: 'accounts.view' }), validate(userQueryValidator, 'query'), asyncHandler(controller.getAccountSummary));
router.get('/', adminOrPersonnelManager({ permission: 'accounts.view' }), validate(userQueryValidator, 'query'), asyncHandler(controller.listUsers));

// POST / : Creates a new managed user (`createUserValidator` body).
// Dynamically requires `accounts.create` + `accounts.roles.manage`, plus
// `accounts.personnel.approve` if pre-approving or setting a temporary password,
// and `accounts.deactivate` if activating the account immediately.
router.post(
  '/',
  validate(createUserValidator),
  adminOrPersonnelManager({
    allPermissions: (req) => {
      const input = req.body?.user || req.body || {};
      const permissions = ['accounts.create', 'accounts.roles.manage'];
      if (input.approvalStatus !== 'pending') permissions.push('accounts.personnel.approve');
      if (typeof input.temporaryPassword === 'string') permissions.push('accounts.personnel.approve');
      if (input.activate ?? (input.status !== 'disabled')) permissions.push('accounts.deactivate');
      return permissions;
    },
  }),
  asyncHandler(controller.createUser),
);

const idParam = validate(userIdParamValidator, 'params');

// GET /:id/history : Returns audit trail entries and safe notification history for account `:id`.
router.get('/:id/history', adminOrPersonnelManager({ permission: 'accounts.view' }), idParam, asyncHandler(controller.getUserHistory));

// POST /:id/lifecycle : Transitions account `:id` lifecycle (`personnelLifecycleValidator` body).
// Maps `action` to granular permissions: `approve`/`reject` -> `accounts.personnel.approve`
// (+ `accounts.deactivate` when `activate` is true), `suspend`/`reactivate` -> `accounts.deactivate`,
// and invitation/retry actions -> `accounts.access.reset`.
router.post(
  '/:id/lifecycle',
  idParam,
  validate(personnelLifecycleValidator),
  administratorOnly({
    allPermissions: (req) => {
      if (req.body.action === 'approve') return req.body.activate
        ? ['accounts.personnel.approve', 'accounts.deactivate']
        : ['accounts.personnel.approve'];
      if (req.body.action === 'reject') return ['accounts.personnel.approve'];
      if (['suspend', 'reactivate'].includes(req.body.action)) return ['accounts.deactivate'];
      return ['accounts.access.reset'];
    },
  }),
  asyncHandler(controller.transitionUserLifecycle),
);

// GET /:id : Fetches single user profile, role, assignment scope, and lifecycle status for `:id`.
router.get('/:id', adminOrPersonnelManager({ permission: 'accounts.view' }), idParam, asyncHandler(controller.getUser));

// PUT /:id : Updates account `:id` (`updateUserValidator` body).
// Dynamically requires `accounts.edit` for profile/scope fields, `accounts.roles.manage`
// when changing role or geography/facility/station assignments, and `accounts.deactivate`
// when mutating `status`.
router.put(
  '/:id',
  idParam,
  validate(updateUserValidator),
  adminOrPersonnelManager({
    allPermissions: (req) => {
      const patch = req.body?.user || req.body || {};
      const permissions = [];
      const hasProfileEdit = ['name', 'fullName', 'contact', 'position', 'licenseNo', 'municipalityId', 'barangayId', 'facilityId', 'rhuStations', 'suspensionReason']
        .some((field) => Object.prototype.hasOwnProperty.call(patch, field));
      if (hasProfileEdit) permissions.push('accounts.edit');
      if (['role', 'municipalityId', 'barangayId', 'facilityId', 'rhuStations']
        .some((field) => Object.prototype.hasOwnProperty.call(patch, field))) {
        permissions.push('accounts.edit', 'accounts.roles.manage');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'status')) permissions.push('accounts.deactivate');
      if (permissions.length === 0) permissions.push('accounts.edit');
      return permissions;
    },
  }),
  asyncHandler(controller.updateUser),
);

// POST /:id/access-reset : Sends a password recovery email or resets credentials (`accessResetValidator` body).
router.post(
  '/:id/access-reset',
  administratorOnly({ permission: 'accounts.access.reset' }),
  idParam,
  validate(accessResetValidator),
  asyncHandler(controller.resetUserAccess),
);

// DELETE /:id : Permanently deletes Supabase Auth user and `profiles` row `:id` (`accounts.delete`).
router.delete(
  '/:id',
  administratorOnly({ permission: 'accounts.delete' }),
  idParam,
  asyncHandler(controller.deleteUser),
);

export default router;
