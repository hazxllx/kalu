import { Router } from 'express';

import env from '../config/env.js';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import rateLimit from '../middleware/rateLimit.js';
import validate from '../middleware/validate.js';
import { signInValidator } from '../validators/auth.validators.js';
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

router.post('/login', loginLimiter, validate(signInValidator), asyncHandler(authController.login));
router.get('/me', authenticate, asyncHandler(authController.me));
router.patch('/me', authenticate, asyncHandler(authController.updateMe));
router.post('/logout', logoutLimiter, authenticate, asyncHandler(authController.logout));

export default router;
