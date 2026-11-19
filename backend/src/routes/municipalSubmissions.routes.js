import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { ROLES } from '../config/roles.js';
import * as controller from '../controllers/municipalSubmissions.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * MHO municipal submission review routes (BUG-010).
 *
 * Role in KALUSAGAP:
 * Exposes the municipal-level review log and decision endpoint for consolidated
 * health report submissions routed to the Municipal Health Officer (MHO).
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(roles)
 *         -> municipalSubmissions.controller -> municipalSubmissions.service -> Supabase
 *
 * Scope & security:
 * Authoritative review decisions persist in `public.municipal_submission_reviews`.
 * Municipality scope is bound server-side from the authenticated user's profile
 * and mirrored by Supabase RLS so callers cannot inspect or review another
 * municipality's submissions.
 */
const router = Router();
router.use(authenticate);

// GET /reviews : Lists municipal submission reviews for the caller's municipality
// (supports query filters such as period, barangay, or status). Accessible to MHO, PHN, RHU Personnel, and Admin.
router.get(
  '/reviews',
  authorize([ROLES.MHO, ROLES.PHN, ROLES.RHU_PERSONNEL, ROLES.ADMIN], { permission: 'reports.view' }),
  asyncHandler(controller.listReviews),
);

// POST /reviews : Records an authoritative review decision (submission target, status,
// and reviewer remarks in `req.body`). Restricted strictly to MHO and Admin.
router.post(
  '/reviews',
  authorize([ROLES.MHO, ROLES.ADMIN], { permission: 'reports.view' }),
  asyncHandler(controller.reviewSubmission),
);

export default router;
