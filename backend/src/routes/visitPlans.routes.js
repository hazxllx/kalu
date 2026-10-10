import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import rateLimit from '../middleware/rateLimit.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/visitPlans.controller.js';
import {
  createPlanValidator,
  availabilityQueryValidator,
  listQueryValidator,
  idParamValidator,
  serviceIdParamValidator,
} from '../validators/visitPlans.validators.js';

/**
 * Resident Health Services directory + "I plan to visit" intent.
 *
 *   route -> authenticate -> authorize(resident/resident-limited) -> controller -> service
 *
 * These endpoints are resident self-service only. A resident browses the
 * services their barangay health center and the covering RHU offer, and records
 * a visit intent (a soft signal to the barangay health worker). Ownership and
 * scope are resolved from the session, so a changed :id, query param or body
 * field can never reach another resident's record or a service out of scope.
 * No appointment status, approval queue or plan dashboard is exposed. This is
 * deliberately separate from the staff `/appointments/*` system.
 */
const router = Router();

const RESIDENT_ROLES = FEATURE_ROLES.residentSelf; // ['resident', 'resident-limited']

const idParam = validate(idParamValidator, 'params');
const serviceIdParam = validate(serviceIdParamValidator, 'params');

// Spam guard: a resident may record at most 10 visit plans per hour.
const planRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyFn: (req) => `visit-plan:${req.user?.id || req.ip || 'anonymous'}`,
  message: 'You have recorded too many visit plans recently. Please try again later.',
});

router.use(authenticate);

// Directory + availability
router.get('/health-services', authorize(RESIDENT_ROLES), asyncHandler(controller.directory));
router.get(
  '/health-services/:id/availability',
  authorize(RESIDENT_ROLES),
  serviceIdParam,
  validate(availabilityQueryValidator, 'query'),
  asyncHandler(controller.availability),
);

// Visit plans
router.get('/visit-plans', authorize(RESIDENT_ROLES), validate(listQueryValidator, 'query'), asyncHandler(controller.list));
router.post('/visit-plans', authorize(RESIDENT_ROLES), planRateLimit, validate(createPlanValidator), asyncHandler(controller.create));
router.delete('/visit-plans/:id', authorize(RESIDENT_ROLES), idParam, asyncHandler(controller.remove));

export default router;
