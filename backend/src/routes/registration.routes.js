// backend/src/routes/registration.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import rateLimit from '../middleware/rateLimit.js';
import validate from '../middleware/validate.js';
import { registerResidentValidator } from '../validators/registration.validators.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as registrationController from '../controllers/registration.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Resident self-registration and existing-record account linking routes.
 *
 * Role in KALUSAGAP:
 * Handles onboarding for residents after client-side Supabase Auth sign-up or
 * staff-issued email invitation: creating new `public.residents` + verification
 * records, completing invitation activation, checking Resident ID eligibility,
 * and linking an authenticated account to a pre-existing barangay health record.
 *
 * Architectural pipeline:
 *   route -> [authenticate -> authorize(residentSelf)] -> [rateLimit]
 *         -> [validate] -> registration.controller -> registration.service -> Supabase
 *
 * Security guarantees:
 * - Authenticated endpoints bind ownership strictly from `req.user` (the verified
 *   session token) so a resident can only create or link their own account.
 * - Public lookup (`/existing/lookup`) returns only an eligibility enum (never PII)
 *   and enforces a stricter rate limit to blunt Resident ID enumeration.
 */
const router = Router();

// Per-client rate limit (10 attempts / hour) for resident registration and existing-record linking.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many registration attempts. Please try again later.',
});

// Tighter per-client rate limit (20 lookups / 15 minutes) for the public Resident ID
// eligibility check to mitigate automated Resident ID enumeration.
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many lookups. Please try again later.',
});

// POST /resident : Creates the `residents` record and initial verification submission
// for the signed-in `resident` / `resident-limited` user using validated demographic,
// barangay, and identity-proof fields in `req.body` (`registerResidentValidator`).
router.post(
  '/resident',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  registerLimiter,
  validate(registerResidentValidator),
  asyncHandler(registrationController.registerResident),
);

// POST /activate : Finalizes resident self-service account activation after accepting
// a staff invitation link and setting a password. Resident identity is derived from
// the authenticated session; safe no-op unless the linked resident record is Verified.
router.post(
  '/activate',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(registrationController.activateAccount),
);

// ---------------------------------------------------------------------------
// Existing-Resident Account Claiming ("I already have a barangay health record")
// - POST /existing/lookup   : Public, rate-limited (`lookupLimiter`). Checks `req.body`
//                             Resident ID and returns ONLY an eligibility state (no PII).
// - POST /existing/activate : Authenticated (`residentSelf`) + rate-limited (`registerLimiter`).
//                             Links the signed-in, email-verified account to the existing
//                             resident record after server-side Resident ID + DOB verification.
// ---------------------------------------------------------------------------
router.post(
  '/existing/lookup',
  lookupLimiter,
  asyncHandler(registrationController.lookupExistingResident),
);

router.post(
  '/existing/activate',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  registerLimiter,
  asyncHandler(registrationController.activateExistingResident),
);

export default router;
