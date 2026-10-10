import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES, ROLES } from '../config/roles.js';
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
 *
 * Authorization is split by action, matching the role brief:
 *   - read + review are recipient actions, gated by `reports.view`, so the
 *     RHU Personnel recipient inbox works without granting report authoring.
 *   - creating (submitting) a report is a SENDER action, gated by
 *     `reports.generate` AND restricted to the sender roles. RHU Personnel are
 *     deliberately excluded from submission here (defense in depth; the service
 *     also refuses to resolve a recipient for them).
 */
const router = Router();

// Only roles that can originate a report. RHU Personnel are recipients, not
// senders, so they are not permitted to POST a new report.
const SENDER_ROLES = [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO];

const readers = [authenticate, authorize(FEATURE_ROLES.reports, { permission: 'reports.view' })];
const reviewers = [authenticate, authorize(FEATURE_ROLES.reports, { permission: 'reports.view' })];
const senders = [authenticate, authorize(SENDER_ROLES, { permission: 'reports.generate' })];
const idParam = validate(reportIdParamValidator, 'params');

router.get('/meta', ...readers, asyncHandler(controller.meta));
router.get('/', ...readers, asyncHandler(controller.list));
router.get('/:id', ...readers, idParam, asyncHandler(controller.get));
router.post('/', ...senders, validate(createReportValidator), asyncHandler(controller.create));
router.patch('/:id/review', ...reviewers, idParam, validate(reviewReportValidator), asyncHandler(controller.review));

export default router;
