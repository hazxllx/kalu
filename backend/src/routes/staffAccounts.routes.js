import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import rateLimit from '../middleware/rateLimit.js';
import validate from '../middleware/validate.js';
import { APPROVER_ROLES } from '../config/staffApprovals.js';
import {
  registerPersonnelValidator,
  staffAccountDecisionValidator,
  staffAccountIdParamValidator,
} from '../validators/staffAccounts.validators.js';
import * as staffAccountsController from '../controllers/staffAccounts.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Personnel registration + operational account verification.
 *
 * Public:
 *   POST /register            submit a personnel registration (creates the Auth
 *                             identity at 'pending_verification', never active)
 *
 * Reviewer (PHN / Health Supervisor only — see config/staffApprovals.js):
 *   GET  /queue?status=&q=    the request roles this account is responsible for
 *   GET  /pending-count       navigation badge
 *   GET  /:id                 one request
 *   POST /:id/approve         activate the account
 *   POST /:id/reject          reject with a reason
 *
 * `authorize(APPROVER_ROLES)` is the server-side gate. System Admin and MHO
 * are NOT in that list, so they receive 403 on every queue/decision route even
 * when the button is hidden; the database re-checks the same rule in
 * public.can_approve_staff_role(). Admin keeps full system administration
 * through /api/users.
 */
const router = Router();

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyFn: (req) => req.ip || 'anonymous',
  message: 'Too many registration attempts. Please try again later.',
});

const reviewer = [authenticate, authorize(APPROVER_ROLES)];
const idParam = validate(staffAccountIdParamValidator, 'params');

router.post('/register', registerLimiter, validate(registerPersonnelValidator), asyncHandler(staffAccountsController.register));

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

export default router;
