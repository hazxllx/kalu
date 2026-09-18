import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import validate from '../middleware/validate.js';
import {
  approveValidator,
  decisionValidator,
  rejectValidator,
  requestResubmissionValidator,
  verificationIdParamValidator,
  verificationRefParamValidator,
} from '../validators/verification.validators.js';
import * as verificationsController from '../controllers/verifications.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Resident verification routes (manual Health Supervisor review).
 *
 * Staff routes: FEATURE_ROLES.verification (Health Supervisor / PHN),
 * authenticated and barangay-scoped from the session.
 * Resident routes: FEATURE_ROLES.residentSelf (resident / resident-limited),
 * and the service only ever touches the caller's own record.
 *
 * Every route validates its params and body before the controller runs; the
 * service still enforces scope, ownership and legal status transitions.
 */
const router = Router();

const staff = [authenticate, authorize(FEATURE_ROLES.verification), resolveBarangayScope];
const self = [authenticate, authorize(FEATURE_ROLES.residentSelf)];
const idParam = validate(verificationIdParamValidator, 'params');

// Resident self-service
router.get('/me', ...self, asyncHandler(verificationsController.getMine));
router.patch('/:id/resubmit', ...self, idParam, asyncHandler(verificationsController.resubmit));

// Staff queue + history (specific paths before '/:id')
router.get('/queue', ...staff, asyncHandler(verificationsController.listQueue));
router.get('/pending', ...staff, asyncHandler(verificationsController.listPending));
router.get('/history', ...staff, asyncHandler(verificationsController.listHistory));

// Staff decisions
router.post(
  '/:ref/decision',
  ...staff,
  validate(verificationRefParamValidator, 'params'),
  validate(decisionValidator),
  asyncHandler(verificationsController.decide),
);
router.patch('/:id/approve', ...staff, idParam, validate(approveValidator), asyncHandler(verificationsController.approve));
router.patch('/:id/reject', ...staff, idParam, validate(rejectValidator), asyncHandler(verificationsController.reject));
router.patch(
  '/:id/request-resubmission',
  ...staff,
  idParam,
  validate(requestResubmissionValidator),
  asyncHandler(verificationsController.requestResubmission),
);

// Staff single-record reads
router.get('/:id/history', ...staff, idParam, asyncHandler(verificationsController.getHistory));
router.get('/:id', ...staff, idParam, asyncHandler(verificationsController.getVerification));

export default router;
