import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import idempotency from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as residentsController from '../controllers/residents.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Master resident-registry and resident self-service profile routes.
 *
 * Role in KALUSAGAP:
 * Serves as the central demographic and health-risk registry (`public.residents`)
 * for authorized barangay/municipal health personnel, while also exposing `/me`
 * self-service profile updates and personal health-record views for residents.
 *
 * Architectural pipeline:
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles, permission)
 *         -> [requireAccountCreationPermission] -> [idempotency]
 *         -> residents.controller -> residents.service -> Supabase
 *
 * Endpoints overview:
 *   GET   /residents/directory-filters  Scoped filter metadata (`residents.directory.view`)
 *   GET   /residents                    Directory listing & search (`residents.directory.view`)
 *   POST  /residents                    Register resident + optional login account (`residents.create`, idempotent)
 *   PATCH /residents/me                 Resident self-service profile update (`residentSelf`)
 *   GET   /residents/me/health-records  Resident self-service clinical records (`residentSelf`)
 *   GET   /residents/:id                Single resident profile & risk summary (`residents.profile.view`)
 *   POST  /residents/:id/account        Invite & link login account to existing resident (`accounts.create`)
 *   PUT   /residents/:id                Staff profile correction (`residents.edit`, idempotent)
 *
 * Defense-in-depth scoping:
 * `resolveBarangayScope` rejects cross-barangay query/body parameters before any
 * controller runs, and the service layer independently filters/verifies each
 * target resident against the caller's barangay or municipality assignment.
 */
const router = Router();

router.use(authenticate, resolveBarangayScope);

// GET /directory-filters : Returns scoped filter options (barangays, puroks, risk tiers, statuses) for directory UI controls.
router.get(
  '/directory-filters',
  authorize(FEATURE_ROLES.residents, { permission: 'residents.directory.view' }),
  asyncHandler(residentsController.getDirectoryFilters),
);

// Enforces `accounts.create` in addition to `residents.create` when a staff
// registration payload sets `createLoginAccount` to provision a login simultaneously.
const requireAccountCreationPermission = (req, res, next) => {
  const resident = req.body?.resident || req.body || {};
  const requestsAccount = Boolean(
    resident.createLoginAccount ||
    resident.createResidentLoginAccount ||
    resident.createAccount ||
    resident.createResidentAccount,
  );
  if (!requestsAccount) return next();
  return authorize(FEATURE_ROLES.residents, { permission: 'accounts.create' })(req, res, next);
};

// GET / : Scope-aware resident directory listing and search (query params: `q`, barangay,
// purok, risk level, verification status, pagination) for Health Supervisor / PHN / MHO.
router.get(
  '/',
  authorize(FEATURE_ROLES.residents, { permission: 'residents.directory.view' }),
  asyncHandler(residentsController.listResidents),
);

// POST / : Creates a master resident record from `req.body` (validated, scope-checked,
// and guarded against duplicate identities). `idempotency` (`Idempotency-Key` header)
// prevents duplicate residents during offline queue retries.
router.post(
  '/',
  authorize(FEATURE_ROLES.residents, { permission: 'residents.create' }),
  requireAccountCreationPermission,
  idempotency,
  asyncHandler(residentsController.createResident),
);

// Resident self-service routes — declared before '/:id' so literal 'me' is never
// captured as a `:id` parameter. Ownership is derived strictly from `req.user`
// (`resolveBarangayScope` is a safe no-op for resident roles):
// - PATCH /me                : Updates editable self-service contact/profile fields in `req.body`.
// - GET   /me/health-records : Returns the authenticated resident's own clinical/program records.
router.patch('/me', authorize(FEATURE_ROLES.residentSelf), asyncHandler(residentsController.updateMyProfile));
router.get('/me/health-records', authorize(FEATURE_ROLES.residentSelf), asyncHandler(residentsController.getMyHealthRecords));

// GET /:id : Reads full demographic profile, verification state, and computed risk summary for resident `:id`.
router.get(
  '/:id',
  authorize(FEATURE_ROLES.referralRecords, { permission: 'residents.profile.view' }),
  asyncHandler(residentsController.getResident),
);

// POST /:id/account : Invites and links a Supabase Auth login account (`residents.auth_user_id`)
// for an existing unlinked resident `:id` using email/contact details in `req.body`.
router.post(
  '/:id/account',
  authorize(FEATURE_ROLES.residents, { permission: 'accounts.create' }),
  asyncHandler(residentsController.createResidentAccount),
);

// PUT /:id : Applies PHN / Health Supervisor demographic and health profile updates
// to resident `:id` from `req.body` (protected by `idempotency`).
router.put(
  '/:id',
  authorize(['phn', 'health_supervisor'], { permission: 'residents.edit' }),
  idempotency,
  asyncHandler(residentsController.updateResident),
);

export default router;
