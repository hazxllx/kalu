import { Router } from 'express';

import env from '../config/env.js';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import rateLimit from '../middleware/rateLimit.js';
import validate from '../middleware/validate.js';
import { signInValidator, personnelPasswordSetupValidator } from '../validators/auth.validators.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  max: env.authRateLimitMaxRequests,
  keyFn: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'unknown';
    return `${req.ip || 'unknown'}:${email}`;
  },
  message: 'Too many login attempts. Please try again later.',
});

const logoutLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => req.user?.id || req.ip || 'anonymous',
  message: 'Too many logout requests. Please try again later.',
});

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

// These verify the real Supabase token inside the service, but deliberately do
// not use the ordinary active-profile guard: approved invitees are not active
// until their own password setup completes.
router.get('/personnel/setup-status', setupStatusLimiter, asyncHandler(authController.personnelSetupStatus));
router.post('/personnel/password-setup', passwordSetupLimiter, validate(personnelPasswordSetupValidator), asyncHandler(authController.personnelPasswordSetup));

router.post('/login', loginLimiter, validate(signInValidator), asyncHandler(authController.login));
router.get('/me', authenticate, asyncHandler(authController.me));
router.patch('/me', authenticate, asyncHandler(authController.updateMe));
router.post('/logout', logoutLimiter, authenticate, asyncHandler(authController.logout));

export default router;
