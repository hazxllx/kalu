import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import validate from '../middleware/validate.js';
import ApiError from '../utils/apiError.js';
import {
  approveValidator,
  decisionValidator,
  rejectValidator,
  requestResubmissionValidator,
  minorAlternativeReviewValidator,
  verificationIdParamValidator,
  verificationRefParamValidator,
} from '../validators/verification.validators.js';
import * as verificationsController from '../controllers/verifications.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Resident identity & residency verification routes (Health Supervisor / PHN review).
 *
 * Role in KALUSAGAP:
 * Governs manual staff verification of resident self-registrations — upgrading
 * `resident-limited` accounts upon approval, handling rejections and resubmission
 * requests, evaluating minor/guardian alternative identity proofs, and exposing
 * self-service status/resubmission endpoints to the applicant.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(roles, permission) -> [resolveBarangayScope]
 *         -> [rejectDirectStatusWrite] -> [validate] -> verifications.controller
 *         -> verifications.service -> Supabase
 *
 * Access-control split:
 * - Staff routes (`staff` chain): `FEATURE_ROLES.verification` (Health Supervisor / PHN)
 *   with `residents.registration.approve`, bound to the caller's barangay/municipality scope.
 * - Resident routes (`self` chain): `FEATURE_ROLES.residentSelf` (`resident` / `resident-limited`),
 *   where the service layer restricts access strictly to the session resident's own record.
 */
const router = Router();

const staff = [
  authenticate,
  authorize(FEATURE_ROLES.verification, { permission: 'residents.registration.approve' }),
  resolveBarangayScope,
];
const self = [authenticate, authorize(FEATURE_ROLES.residentSelf)];
const idParam = validate(verificationIdParamValidator, 'params');

/**
 * Guard middleware rejecting payloads that attempt to set `verification_status`
 * directly (`403 Forbidden`), ensuring status transitions occur solely via
 * validated reviewer decision workflows.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
export const rejectDirectStatusWrite = (req, res, next) => {
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'verification_status')) {
    return next(ApiError.forbidden('Verification status must be changed through a reviewer decision.'));
  }
  return next();
};

// Resident self-service endpoints (`self` chain; `/me` declared before `/:id`):
// - GET   /me            : Fetches the authenticated resident's own verification state and reviewer remarks.
// - PATCH /:id/resubmit  : Submits corrected proof/details in `req.body` for resident-owned verification `:id`.
router.get('/me', ...self, asyncHandler(verificationsController.getMine));
router.patch('/:id/resubmit', ...self, rejectDirectStatusWrite, idParam, asyncHandler(verificationsController.resubmit));

// Staff queue & aggregate history endpoints (`staff` chain; declared before `/:id`):
// - GET /queue   : Lists verification submissions in scope (query filters: status, search, pagination).
// - GET /pending : Lists pending verification submissions awaiting review.
// - GET /history : Lists completed/historical verification decisions in scope.
router.get('/queue', ...staff, asyncHandler(verificationsController.listQueue));
router.get('/pending', ...staff, asyncHandler(verificationsController.listPending));
router.get('/history', ...staff, asyncHandler(verificationsController.listHistory));

// Staff review decision endpoints (`staff` chain + param/body validators):
// - POST  /:ref/decision             : Unified decision handler keyed by verification ID or reference `:ref` (`decisionValidator`).
// - PATCH /:id/approve               : Approves verification `:id` (`approveValidator` body).
// - PATCH /:id/reject                : Rejects verification `:id` with required reason (`rejectValidator` body).
// - PATCH /:id/request-resubmission  : Requests applicant resubmission with required reason (`requestResubmissionValidator` body).
// - PATCH /:id/minor-alternative     : Reviews minor/guardian alternative documentation on `:id` (`minorAlternativeReviewValidator` body).
router.post(
  '/:ref/decision',
  ...staff,
  rejectDirectStatusWrite,
  validate(verificationRefParamValidator, 'params'),
  validate(decisionValidator),
  asyncHandler(verificationsController.decide),
);
router.patch('/:id/approve', ...staff, rejectDirectStatusWrite, idParam, validate(approveValidator), asyncHandler(verificationsController.approve));
router.patch('/:id/reject', ...staff, rejectDirectStatusWrite, idParam, validate(rejectValidator), asyncHandler(verificationsController.reject));
router.patch(
  '/:id/request-resubmission',
  ...staff,
  rejectDirectStatusWrite,
  idParam,
  validate(requestResubmissionValidator),
  asyncHandler(verificationsController.requestResubmission),
);
router.patch(
  '/:id/minor-alternative',
  ...staff,
  idParam,
  validate(minorAlternativeReviewValidator),
  asyncHandler(verificationsController.reviewMinorAlternative),
);

// Staff single-record reads (`staff` chain + `verificationIdParamValidator`):
// - GET /:id/history : Fetches audit/decision timeline for verification `:id`.
// - GET /:id         : Fetches full verification dossier and submitted proof for `:id`.
router.get('/:id/history', ...staff, idParam, asyncHandler(verificationsController.getHistory));
router.get('/:id', ...staff, idParam, asyncHandler(verificationsController.getVerification));

export default router;
