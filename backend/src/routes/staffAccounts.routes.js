import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import ApiError from '../utils/apiError.js';
import { APPROVER_ROLES } from '../config/staffApprovals.js';
import {
  staffAccountDecisionValidator,
  staffAccountIdParamValidator,
} from '../validators/staffAccounts.validators.js';
import * as staffAccountsController from '../controllers/staffAccounts.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Historical health-personnel account request review routes.
 *
 * Role in KALUSAGAP:
 * Provides the review queue and atomic approval/rejection/resubmission endpoints
 * for legacy personnel onboarding requests, while explicitly blocking public
 * `/register` self-signup (new personnel accounts are provisioned exclusively
 * through the administrator `/api/users` workflow).
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(APPROVER_ROLES, 'accounts.personnel.approve')
 *         -> [validate] -> staffAccounts.controller -> staffAccounts.service -> Supabase / RPC
 *
 * Reviewer authorization (`APPROVER_ROLES` — PHN & Health Supervisor, see `config/staffApprovals.js`):
 *   GET  /queue?status=&q=           Lists requests for target roles within the reviewer's scope
 *   GET  /pending-count              Returns pending badge count for navigation UI
 *   GET  /:id                        Fetches single personnel request dossier
 *   POST /:id/approve                Approves request through the atomic lifecycle workflow
 *   POST /:id/reject                 Rejects request with reviewer reason
 *   POST /:id/request-resubmission   Requests applicant corrections with required reason
 *
 * Defense in depth:
 * System Admin and MHO are excluded from `APPROVER_ROLES` (receiving HTTP 403 here)
 * and blocked again in Postgres via `public.can_approve_staff_role()`. System Admin
 * manages accounts through `/api/users`.
 */
const router = Router();

const reviewer = [
  authenticate,
  authorize(APPROVER_ROLES, { permission: 'accounts.personnel.approve' }),
];
const idParam = validate(staffAccountIdParamValidator, 'params');

// POST /register : Immediately denies public personnel registration with HTTP 403
// before any multipart parsing, file upload, validation, or Supabase Auth call.
router.post('/register', (_req, _res, next) => next(ApiError.forbidden(
  'Public health personnel registration is disabled. Contact a system administrator.',
)));

// Queue & badge summary endpoints (registered before '/:id'):
// - GET /queue         : Lists scoped personnel requests filtered by `status` and search `q` query params.
// - GET /pending-count : Returns count of actionable pending requests for the reviewer.
router.get('/queue', ...reviewer, asyncHandler(staffAccountsController.listQueue));
router.get('/pending-count', ...reviewer, asyncHandler(staffAccountsController.pendingCount));

// Single-request read & decision endpoints (`staffAccountIdParamValidator` + `staffAccountDecisionValidator`):
// - GET  /:id                      : Reads full details of personnel request `:id`.
// - POST /:id/approve              : Approves request `:id` using validated decision body.
// - POST /:id/reject               : Rejects request `:id` with reason in validated decision body.
// - POST /:id/request-resubmission : Returns request `:id` for resubmission with required reason in body.
router.get('/:id', ...reviewer, idParam, asyncHandler(staffAccountsController.getRequest));
router.post('/:id/approve', ...reviewer, idParam, validate(staffAccountDecisionValidator), asyncHandler(staffAccountsController.approve));
router.post(
  '/:id/reject',
  ...reviewer,
  idParam,
  validate(staffAccountDecisionValidator),
  asyncHandler(staffAccountsController.reject),
);
router.post(
  '/:id/request-resubmission',
  ...reviewer,
  idParam,
  validate(staffAccountDecisionValidator),
  asyncHandler(staffAccountsController.requestResubmission),
);

export default router;
