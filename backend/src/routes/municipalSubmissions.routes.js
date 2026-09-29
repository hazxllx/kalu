import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { ROLES } from '../config/roles.js';
import * as controller from '../controllers/municipalSubmissions.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * MHO municipal submission review (BUG-010).
 *
 *   GET  /municipal-submissions/reviews   municipality staff (scope-enforced)
 *   POST /municipal-submissions/reviews   MHO (or admin) only
 *
 * The authoritative review decisions live in
 * public.municipal_submission_reviews; the municipality is bound from the
 * authenticated profile and enforced by RLS.
 */
const router = Router();
router.use(authenticate);

router.get(
  '/reviews',
  authorize([ROLES.MHO, ROLES.PHN, ROLES.RHU_PERSONNEL, ROLES.ADMIN]),
  asyncHandler(controller.listReviews),
);
router.post(
  '/reviews',
  authorize([ROLES.MHO, ROLES.ADMIN]),
  asyncHandler(controller.reviewSubmission),
);

export default router;
