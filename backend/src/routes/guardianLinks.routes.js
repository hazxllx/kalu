// backend/src/routes/guardianLinks.routes.js
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
 * Minor / parent-or-guardian relationship linking routes (`/api/guardian-links`, Phase 2.2).
 *
 * Request pipeline:
 *   route -> authenticate -> authorize(roles) -> [rateLimit] -> [resolveBarangayScope] -> [validate] -> controller -> service -> Supabase
 *
 * Resident self-service endpoints:
 *   GET   /api/guardian-links/mine            list caller's own guardian/minor links
 *   POST  /api/guardian-links/mine/request    minor requests a link to an adult guardian (rate-limited)
 *   GET   /api/guardian-links/mine/incoming   adult resident lists incoming guardian requests
 *   PATCH /api/guardian-links/mine/cancel     minor cancels their own pending guardian request
 *   PATCH /api/guardian-links/:id/respond     adult candidate accepts or declines an incoming request
 *
 * Staff / clinical endpoints:
 *   GET   /api/guardian-links/candidates?q=   staff: search adult residents eligible to link as guardian
 *   GET   /api/guardian-links/minor/:minorId  staff: list guardian links recorded for a minor
 *   POST  /api/guardian-links                 staff OR minor's own account: create a PENDING link
 *   PATCH /api/guardian-links/:id/review      staff: verify or reject a link (rejection reason required)
 *   PATCH /api/guardian-links/:id/correct     staff: amend relationship metadata on an existing link
 *
 * Authorization is enforced twice: route-level `authorize()` (role gate) and
 * inside the service (scope/coverage, minor-only, self-reference, duplicates).
 * `resolveBarangayScope` attaches the caller's barangay from the session so a
 * barangay-scoped caller cannot widen their own data window.
 *
 * Policy invariant: A link NEVER grants the guardian access to the minor's
 * clinical records and NEVER auto-verifies any resident account.
 */
const router = Router();

// Role matrices partitioning candidate lookup, link creation, verification review, and resident self-service.
const staffLinkRoles = [ROLES.ADMIN, ROLES.BHW, ROLES.HEALTH_SUPERVISOR, ROLES.PHN];
const reviewRoles = [ROLES.ADMIN, ROLES.HEALTH_SUPERVISOR, ROLES.PHN];
// Creation is additionally allowed for the minor's own account; the service
// restricts that path to the caller's own resident record.
const createRoles = [...staffLinkRoles, ROLES.RESIDENT, ROLES.RESIDENT_LIMITED];
const listRoles = [...new Set([...staffLinkRoles, ROLES.MHO])];
const residentRoles = [ROLES.RESIDENT, ROLES.RESIDENT_LIMITED];

// Cap self-service guardian link requests to 5 per hour to prevent unsolicited link spam.
const guardianRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many parent/guardian link requests. Please try again later.',
});

// GET /api/guardian-links/mine — List guardian/minor relationship links involving the authenticated resident.
router.get(
  '/mine',
  authenticate,
  authorize(residentRoles),
  asyncHandler(guardianLinksController.listOwnGuardianLinks),
);

// POST /api/guardian-links/mine/request — Submit a guardian link request from a minor account (`ownGuardianRequestValidator`, rate-limited).
router.post(
  '/mine/request',
  authenticate,
  authorize(residentRoles),
  guardianRequestLimiter,
  validate(ownGuardianRequestValidator),
  asyncHandler(guardianLinksController.requestOwnGuardianLink),
);

// GET /api/guardian-links/mine/incoming — List pending guardian link requests addressed to the authenticated adult resident.
router.get(
  '/mine/incoming',
  authenticate,
  authorize(residentRoles),
  asyncHandler(guardianLinksController.listIncomingGuardianRequests),
);

// PATCH /api/guardian-links/mine/cancel — Cancel the authenticated minor's pending guardian link request.
router.patch(
  '/mine/cancel',
  authenticate,
  authorize(residentRoles),
  asyncHandler(guardianLinksController.cancelOwnGuardianRequest),
);

// PATCH /api/guardian-links/:id/respond — Accept or decline an incoming guardian link request (`:id` param + `guardianResponseValidator`).
router.patch(
  '/:id/respond',
  authenticate,
  authorize(residentRoles),
  validate(guardianResponseValidator),
  asyncHandler(guardianLinksController.respondToGuardianRequest),
);

// GET /api/guardian-links/candidates — Staff search (`?q=`) for adult residents within barangay/municipality scope to link as guardian.
router.get(
  '/candidates',
  authenticate,
  authorize(staffLinkRoles),
  resolveBarangayScope,
  asyncHandler(guardianLinksController.searchGuardianCandidates),
);

// GET /api/guardian-links/minor/:minorId — Staff list of all guardian links associated with `:minorId` within scope.
router.get(
  '/minor/:minorId',
  authenticate,
  authorize(listRoles),
  resolveBarangayScope,
  asyncHandler(guardianLinksController.listGuardianLinksForMinor),
);

// POST /api/guardian-links — Create a pending guardian link (`createGuardianLinkValidator`; scoped for staff, self-only for minor residents).
router.post(
  '/',
  authenticate,
  authorize(createRoles),
  resolveBarangayScope,
  validate(createGuardianLinkValidator),
  asyncHandler(guardianLinksController.createGuardianLink),
);

// PATCH /api/guardian-links/:id/review — Staff verification or rejection of pending guardian link `:id` (`reviewGuardianLinkValidator`).
router.patch(
  '/:id/review',
  authenticate,
  authorize(reviewRoles),
  resolveBarangayScope,
  validate(reviewGuardianLinkValidator),
  asyncHandler(guardianLinksController.reviewGuardianLink),
);

// PATCH /api/guardian-links/:id/correct — Staff correction of relationship details on guardian link `:id` (`correctGuardianLinkValidator`).
router.patch(
  '/:id/correct',
  authenticate,
  authorize(reviewRoles),
  resolveBarangayScope,
  validate(correctGuardianLinkValidator),
  asyncHandler(guardianLinksController.correctGuardianLink),
);

export default router;
