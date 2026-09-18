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
 * Resident self-registration.
 *
 *   POST /registration/resident   create the `residents` row for the signed-in
 *                                 account (Auth account is created client-side)
 *
 * Authenticated and rate-limited. A resident can only create their OWN record:
 * the service derives the auth user id from the verified session.
 */
const router = Router();

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many registration attempts. Please try again later.',
});

router.post(
  '/resident',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  registerLimiter,
  validate(registerResidentValidator),
  asyncHandler(registrationController.registerResident),
);

export default router;
