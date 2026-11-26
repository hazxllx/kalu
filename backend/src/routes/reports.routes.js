// backend/src/routes/reports.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES, ROLES } from '../config/roles.js';
import {
  createReportValidator,
  reviewReportValidator,
  resubmitReportValidator,
  submitReportValidator,
  reportIdParamValidator,
} from '../validators/reports.validators.js';
import * as controller from '../controllers/reports.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Inter-tier health report submission and review workflow routes.
 *
 * Role in KALUSAGAP:
 * Manages formal health report drafting, submission, recipient review (approval
 * or return for changes), and resubmission across barangay and municipal health
 * tiers (Health Supervisor -> PHN / RHU -> MHO).
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(roles, permission) -> [validate]
 *         -> reports.controller -> reports.service -> Supabase
 *
 * Scope & RBAC split:
 * - Every route requires authentication and membership in `FEATURE_ROLES.reports`
 *   (Health Supervisor, PHN, MHO, RHU Personnel). The service enforces sender/
 *   recipient routing and municipality/barangay scope so a report is visible
 *   only to its sender or its routed recipient.
 * - Read and review (`readers`, `reviewers`) are recipient-capable actions gated
 *   by `reports.view`, enabling RHU Personnel to operate the recipient inbox
 *   without granting report authoring.
 * - Authoring, submitting, and resubmitting (`senders`) require `reports.generate`
 *   AND `SENDER_ROLES` (Health Supervisor, PHN, MHO). RHU Personnel are excluded
 *   from originating reports at both the route and service layers.
 */
const router = Router();
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Only roles that can originate a report. RHU Personnel are recipients, not
// senders, so they are not permitted to POST a new report.
const SENDER_ROLES = [ROLES.HEALTH_SUPERVISOR, ROLES.PHN];

const readers = [authenticate, authorize(FEATURE_ROLES.reports, { permission: 'reports.view' })];
const reviewers = [authenticate, authorize(FEATURE_ROLES.reports, { permission: 'reports.view' })];
const senders = [authenticate, authorize(SENDER_ROLES, { permission: 'reports.generate' })];
const idParam = validate(reportIdParamValidator, 'params');

// Read & metadata endpoints (`readers` chain):
// - GET /meta : Returns report categories, period options, and routed recipient metadata for the caller.
// - GET /     : Lists sent/received reports visible to the caller (query filters: status, type, period, pagination).
// - GET /:id  : Fetches single report `:id` (`reportIdParamValidator`) including review history.
router.get('/meta', ...readers, asyncHandler(controller.meta));
router.get('/', ...readers, asyncHandler(controller.list));
router.get('/:id', ...readers, idParam, asyncHandler(controller.get));

// Authoring, submission & recipient review lifecycle endpoints:
// - POST  /             : Creates a draft or immediately submitted report (`senders`, `createReportValidator` body).
// - PATCH /:id/submit   : Submits existing draft report `:id` (`senders`, `submitReportValidator` body).
// - PATCH /:id/review   : Records recipient review decision/remarks on `:id` (`reviewers`, `reviewReportValidator` body).
// - PATCH /:id/resubmit : Resubmits returned report `:id` after revisions (`senders`, `resubmitReportValidator` body).
router.post('/', ...senders, validate(createReportValidator), asyncHandler(controller.create));
router.patch('/:id/submit', ...senders, idParam, validate(submitReportValidator), asyncHandler(controller.submitDraft));
router.patch('/:id/review', ...reviewers, idParam, validate(reviewReportValidator), asyncHandler(controller.review));
router.patch('/:id/resubmit', ...senders, idParam, validate(resubmitReportValidator), asyncHandler(controller.resubmit));

export default router;
