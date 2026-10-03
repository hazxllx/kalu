import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES } from '../config/roles.js';
import {
  certificateIdParamValidator,
  changeStatusValidator,
  createCertificateValidator,
  updateCertificateValidator,
} from '../validators/medicalCertificates.validators.js';
import * as controller from '../controllers/medicalCertificates.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Medical certificate register.
 *
 * Every route authenticates and requires `FEATURE_ROLES.certificates`
 * (PHN, MHO only). The service additionally enforces the caller's
 * barangay/municipality scope, and `FEATURE_ROLES.certificateReview` (PHN,
 * MHO) is what the register uses to decide whether a status change is a review
 * decision. RHU Personnel, BHW and System Admin receive 403 here even by direct URL.
 */
const router = Router();

const staff = [authenticate, authorize(FEATURE_ROLES.certificates)];
const idParam = validate(certificateIdParamValidator, 'params');

// Specific paths before '/:id'.
router.get('/meta', ...staff, asyncHandler(controller.meta));
router.get('/next-reference', ...staff, asyncHandler(controller.reference));

router.get('/', ...staff, asyncHandler(controller.list));
router.get('/:id', ...staff, idParam, asyncHandler(controller.get));

router.post('/', ...staff, validate(createCertificateValidator), asyncHandler(controller.create));
router.put('/:id', ...staff, idParam, validate(updateCertificateValidator), asyncHandler(controller.update));
router.patch('/:id/status', ...staff, idParam, validate(changeStatusValidator), asyncHandler(controller.changeStatus));

export default router;
