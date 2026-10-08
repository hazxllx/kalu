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

const readers = [authenticate, authorize(FEATURE_ROLES.reports, { permission: 'reports.view' })];
const writers = [authenticate, authorize(FEATURE_ROLES.reports, { permission: 'reports.generate' })];
const idParam = validate(reportIdParamValidator, 'params');

router.get('/meta', ...readers, asyncHandler(controller.meta));
router.get('/', ...readers, asyncHandler(controller.list));
router.get('/:id', ...readers, idParam, asyncHandler(controller.get));
router.post('/', ...writers, validate(createReportValidator), asyncHandler(controller.create));
router.patch('/:id/review', ...writers, idParam, validate(reviewReportValidator), asyncHandler(controller.review));

export default router;
