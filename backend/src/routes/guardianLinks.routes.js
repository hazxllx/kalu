import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import rateLimit from '../middleware/rateLimit.js';
import { ROLES } from '../config/roles.js';
import validate from '../middleware/validate.js';
import {
  createGuardianLinkValidator,
  reviewGuardianLinkValidator,
  correctGuardianLinkValidator,
  ownGuardianRequestValidator,
  guardianResponseValidator,
} from '../validators/guardianLinks.validators.js';
import * as guardianLinksController from '../controllers/guardianLinks.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Minor / parent-or-guardian linking (Phase 2.2).
 *
 *   GET  /guardian-links/candidates?q=          staff: search a resident to
 *                                               link as the minor's guardian
 *   POST /guardian-links                        staff OR the minor's own
 *                                               account: create a PENDING link
 *   GET  /guardian-links/minor/:minorId        staff: list a minor's links
 *   PATCH /guardian-links/:id/review           staff: verify / reject (reason
 *                                               required to reject)
 *   PATCH /guardian-links/:id/correct         staff: fix relationship details
 *
 * Authorization is enforced twice: route-level `authorize()` (role gate) and
 * inside the service (scope/coverage, minor-only, self-reference, duplicates).
 * `resolveBarangayScope` attaches the caller's barangay from the session so a
 * barangay-scoped caller cannot widen their own data window.
 *
 * A link NEVER grants the guardian access to the minor's records (that is a
 * separate, unapproved policy decision) and NEVER verifies any resident.
 */
const router = Router();

const staffLinkRoles = [ROLES.ADMIN, ROLES.BHW, ROLES.HEALTH_SUPERVISOR, ROLES.PHN];
const reviewRoles = [ROLES.ADMIN, ROLES.HEALTH_SUPERVISOR, ROLES.PHN];
// Creation is additionally allowed for the minor's own account; the service
// restricts that path to the caller's own resident record.
const createRoles = [...staffLinkRoles, ROLES.RESIDENT, ROLES.RESIDENT_LIMITED];
const listRoles = [...new Set([...staffLinkRoles, ROLES.MHO])];
const residentRoles = [ROLES.RESIDENT, ROLES.RESIDENT_LIMITED];
const guardianRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many parent/guardian link requests. Please try again later.',
});

router.get(
  '/mine',
  authenticate,
  authorize(residentRoles),
  asyncHandler(guardianLinksController.listOwnGuardianLinks),
);
router.post(
  '/mine/request',
  authenticate,
  authorize(residentRoles),
  guardianRequestLimiter,
  validate(ownGuardianRequestValidator),
  asyncHandler(guardianLinksController.requestOwnGuardianLink),
);
router.get(
  '/mine/incoming',
  authenticate,
  authorize(residentRoles),
  asyncHandler(guardianLinksController.listIncomingGuardianRequests),
);
router.patch(
  '/mine/cancel',
  authenticate,
  authorize(residentRoles),
  asyncHandler(guardianLinksController.cancelOwnGuardianRequest),
);
router.patch(
  '/:id/respond',
  authenticate,
  authorize(residentRoles),
  validate(guardianResponseValidator),
  asyncHandler(guardianLinksController.respondToGuardianRequest),
);

router.get(
  '/candidates',
  authenticate,
  authorize(staffLinkRoles),
  resolveBarangayScope,
  asyncHandler(guardianLinksController.searchGuardianCandidates),
);

router.get(
  '/minor/:minorId',
  authenticate,
  authorize(listRoles),
  resolveBarangayScope,
  asyncHandler(guardianLinksController.listGuardianLinksForMinor),
);

router.post(
  '/',
  authenticate,
  authorize(createRoles),
  resolveBarangayScope,
  validate(createGuardianLinkValidator),
  asyncHandler(guardianLinksController.createGuardianLink),
);

router.patch(
  '/:id/review',
  authenticate,
  authorize(reviewRoles),
  resolveBarangayScope,
  validate(reviewGuardianLinkValidator),
  asyncHandler(guardianLinksController.reviewGuardianLink),
);

router.patch(
  '/:id/correct',
  authenticate,
  authorize(reviewRoles),
  resolveBarangayScope,
  validate(correctGuardianLinkValidator),
  asyncHandler(guardianLinksController.correctGuardianLink),
);

export default router;
