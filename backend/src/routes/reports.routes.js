import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES } from '../config/roles.js';
import {
  createReportValidator,
  reviewReportValidator,
  reportIdParamValidator,
} from '../validators/reports.validators.js';
import * as controller from '../controllers/reports.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Report submission workflow.
 *
 * Every route authenticates and requires `FEATURE_ROLES.reports`
 * (Health Supervisor, PHN, MHO, RHU Personnel). The service enforces the
 * sender/recipient routing and the caller's municipality/barangay scope; a
 * report is only ever visible to its sender or its routed recipient.
 */
const router = Router();

const staff = [authenticate, authorize(FEATURE_ROLES.reports)];
const idParam = validate(reportIdParamValidator, 'params');

router.get('/meta', ...staff, asyncHandler(controller.meta));
router.get('/', ...staff, asyncHandler(controller.list));
router.get('/:id', ...staff, idParam, asyncHandler(controller.get));
router.post('/', ...staff, validate(createReportValidator), asyncHandler(controller.create));
router.patch('/:id/review', ...staff, idParam, validate(reviewReportValidator), asyncHandler(controller.review));

export default router;
