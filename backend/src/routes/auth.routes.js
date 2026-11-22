/**
 * Authentication, personnel onboarding, and session profile routes (`/api/auth`).
 *
 * Request pipeline:
 *   route -> [rateLimit] -> [authenticate] -> [validate(body)] -> controller -> service -> Supabase Auth + profiles
 *
 * Supports email/password sign-in, password recovery, invited personnel password
 * setup, temporary password rotation, and authenticated profile retrieval/updates.
 * Rate limiters protect sign-in, password setup, and reset endpoints against
 * credential-stuffing and brute-force attacks. Pre-activation personnel setup
 * endpoints verify the bearer token inside the service rather than `authenticate`
 * because invited staff accounts only become active once password setup completes.
 */
import { Router } from 'express';

import env from '../config/env.js';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import rateLimit from '../middleware/rateLimit.js';
import validate from '../middleware/validate.js';
import {
  signInValidator, passwordResetRequestValidator, personnelPasswordSetupValidator,
  temporaryPersonnelPasswordChangeValidator,
} from '../validators/auth.validators.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

// Keyed by composite `ip:email` so brute-force throttling isolates the targeted
// account without locking out unrelated users sharing a clinic/barangay NAT IP.
const loginLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  max: env.authRateLimitMaxRequests,
  keyFn: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'unknown';
    return `${req.ip || 'unknown'}:${email}`;
  },
  message: 'Too many login attempts. Please try again later.',
});

// Keyed by authenticated user ID (falling back to IP) to cap repetitive sign-out calls.
const logoutLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => req.user?.id || req.ip || 'anonymous',
  message: 'Too many logout requests. Please try again later.',
});

// Onboarding and password recovery rate limiters to prevent token enumeration and email flooding.
const setupStatusLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 60,
  message: 'Too many setup status requests. Please try again later.',
});
const passwordSetupLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  max: env.authRateLimitMaxRequests,
  message: 'Too many password setup attempts. Please try again later.',
});
const temporaryPasswordChangeLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  max: env.authRateLimitMaxRequests,
  message: 'Too many password change attempts. Please try again later.',
});
const passwordResetRequestLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  max: Math.min(5, env.authRateLimitMaxRequests),
  message: 'Too many reset requests. Please wait before trying again.',
});

// These verify the real Supabase token inside the service, but deliberately do
// not use the ordinary active-profile guard: approved invitees are not active
// until their own password setup completes.
// GET /api/auth/personnel/setup-status — Check whether an invited personnel token requires initial password setup.
router.get('/personnel/setup-status', setupStatusLimiter, asyncHandler(authController.personnelSetupStatus));
// POST /api/auth/personnel/password-setup — Complete initial password setup and activate an invited personnel profile (`personnelPasswordSetupValidator`).
router.post('/personnel/password-setup', passwordSetupLimiter, validate(personnelPasswordSetupValidator), asyncHandler(authController.personnelPasswordSetup));
// POST /api/auth/personnel/temporary-password-change — Replace an admin-issued temporary password (`personnelPasswordSetupValidator`).
router.post('/personnel/temporary-password-change', temporaryPasswordChangeLimiter, validate(temporaryPersonnelPasswordChangeValidator), asyncHandler(authController.temporaryPasswordChange));
// POST /api/auth/forgot-password — Request a password reset email for an existing account (`passwordResetRequestValidator`).
router.post('/forgot-password', passwordResetRequestLimiter, validate(passwordResetRequestValidator), asyncHandler(authController.forgotPassword));

// POST /api/auth/login — Authenticate with email and password (`signInValidator`), returning session credentials and active profile.
router.post('/login', loginLimiter, validate(signInValidator), asyncHandler(authController.login));
// GET /api/auth/me — Return the authenticated caller's active profile, role, permissions, and scope metadata.
router.get('/me', authenticate, asyncHandler(authController.me));
// PATCH /api/auth/me — Update editable self-profile fields for the currently authenticated user.
router.patch('/me', authenticate, asyncHandler(authController.updateMe));
// POST /api/auth/logout — Revoke/end the caller's current authenticated session.
router.post('/logout', logoutLimiter, authenticate, asyncHandler(authController.logout));

export default router;
