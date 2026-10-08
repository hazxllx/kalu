import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import idempotency from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as residentsController from '../controllers/residents.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Master resident-record endpoints for authorized health staff.
 *
 *   GET  /residents          — directory listing + search, scope-enforced
 *                              (Health Supervisor / PHN / MHO)
 *   POST /residents          — register a resident (validated, scope-checked,
 *                              duplicate identity guarded)
 *   GET  /residents/:id      — PHN / Health Supervisor / MHO
 *   PUT  /residents/:id      — PHN / Health Supervisor (profile corrections)
 *
 * Barangay scoping is enforced twice: `resolveBarangayScope` rejects any
 * cross-barangay request before the controller runs, and the service layer
 * independently filters the record itself against the caller's assignment.
 */
const router = Router();

router.use(authenticate, resolveBarangayScope);

const requireAccountCreationPermission = (req, res, next) => {
  const resident = req.body?.resident || req.body || {};
  if (!resident.createLoginAccount) return next();
  return authorize(FEATURE_ROLES.residents, { permission: 'accounts.create' })(req, res, next);
};

// Scope-aware directory listing + registration (Health Supervisor / PHN / MHO).
// Barangay scope is enforced twice: `resolveBarangayScope` rejects
// cross-barangay query/body values before the controller runs, and the service
// layer independently re-checks the assignment.
router.get(
  '/',
  authorize(FEATURE_ROLES.residents, { permission: 'residents.directory.view' }),
  asyncHandler(residentsController.listResidents),
);
// Idempotency-Key makes an offline re-upload safe (no duplicate resident).
router.post(
  '/',
  authorize(FEATURE_ROLES.residents, { permission: 'residents.create' }),
  requireAccountCreationPermission,
  idempotency,
  asyncHandler(residentsController.createResident),
);

// Resident self-service. Must be declared before '/:id' so these are not
// captured as an id. Resident is derived from the session; barangay scope is a
// no-op for residents.
router.patch('/me', authorize(FEATURE_ROLES.residentSelf), asyncHandler(residentsController.updateMyProfile));
router.get('/me/health-records', authorize(FEATURE_ROLES.residentSelf), asyncHandler(residentsController.getMyHealthRecords));

router.get(
  '/:id',
  authorize(FEATURE_ROLES.referralRecords, { permission: 'residents.profile.view' }),
  asyncHandler(residentsController.getResident),
);
router.put(
  '/:id',
  authorize(['phn', 'health_supervisor'], { permission: 'residents.edit' }),
  asyncHandler(residentsController.updateResident),
);

export default router;
