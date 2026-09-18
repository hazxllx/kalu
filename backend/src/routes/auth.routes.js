import { Router } from 'express';

import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import validate from '../middleware/validate.js';
import { signInValidator } from '../validators/auth.validators.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

router.post('/login', validate(signInValidator), asyncHandler(authController.login));
router.get('/me', authenticate, asyncHandler(authController.me));
router.post('/logout', authenticate, asyncHandler(authController.logout));

export default router;
