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
 * Historical personnel request review. New personnel accounts are created
 * only through the administrator's /users workflow.
 *
 * Reviewer (PHN / Health Supervisor only — see config/staffApprovals.js):
 *   GET  /queue?status=&q=    the request roles this account is responsible for
 *   GET  /pending-count       navigation badge
 *   GET  /:id                 one request
 *   POST /:id/approve         approve through the atomic lifecycle workflow
 *   POST /:id/reject          reject with a reason
 *   POST /:id/request-resubmission  ask the applicant to correct and resubmit (reason required)
 *
 * `authorize(APPROVER_ROLES)` is the server-side gate. System Admin and MHO
 * are NOT in that list, so they receive 403 on every queue/decision route even
 * when the button is hidden; the database re-checks the same rule in
 * public.can_approve_staff_role(). Admin keeps full system administration
 * through /api/users.
 */
const router = Router();

const reviewer = [
  authenticate,
  authorize(APPROVER_ROLES, { permission: 'accounts.personnel.approve' }),
];
const idParam = validate(staffAccountIdParamValidator, 'params');

// Deny before multipart parsing, uploads, validation or any Auth operation.
router.post('/register', (_req, _res, next) => next(ApiError.forbidden(
  'Public health personnel registration is disabled. Contact a system administrator.',
)));

// Specific paths before '/:id'.
router.get('/queue', ...reviewer, asyncHandler(staffAccountsController.listQueue));
router.get('/pending-count', ...reviewer, asyncHandler(staffAccountsController.pendingCount));

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
