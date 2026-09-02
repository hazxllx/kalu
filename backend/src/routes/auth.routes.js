import { Router } from 'express';

import * as authController from '../controllers/auth.controller.js';
import * as devAuthController from '../controllers/devAuth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

router.post('/login', asyncHandler(authController.login));
router.get('/me', authenticate, asyncHandler(authController.me));
router.post('/logout', authenticate, asyncHandler(authController.logout));

// Local-development session (mock accounts) — disabled in production and when
// Supabase is configured.
router.post('/dev-session', asyncHandler(devAuthController.createDevSession));

export default router;
