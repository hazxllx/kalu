// backend/src/routes/visitPlans.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import rateLimit from '../middleware/rateLimit.js';
import { FEATURE_ROLES, ROLES } from '../config/roles.js';
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
 * Resident Health Services directory & "I plan to visit" intent routes.
 *
 * Role in KALUSAGAP:
 * Provides resident self-service discovery of barangay health station and RHU
 * services, schedule availability checks, and lightweight visit-intent recording
 * (a soft planning signal to barangay health personnel, intentionally separate
 * from the staff `/appointments` scheduling workflow).
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(RESIDENT_ROLES) -> [planRateLimit]
 *         -> [validate] -> visitPlans.controller -> visitPlans.service -> Supabase
 *
 * The directory and availability are readable by authenticated residents and
 * use their profile scope, so a pending account can browse without a residents
 * row. Visit-plan reads and mutations are restricted to verified residents;
 * ownership for those operations is derived from the session-linked resident.
 */
const router = Router();

const RESIDENT_ROLES = FEATURE_ROLES.residentSelf; // ['resident', 'resident-limited']
const VERIFIED_RESIDENT_ROLES = [ROLES.RESIDENT];

const idParam = validate(idParamValidator, 'params');
const serviceIdParam = validate(serviceIdParamValidator, 'params');

// Spam guard: limits each authenticated resident (or fallback client IP) to 10 new visit plans per hour.
const planRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyFn: (req) => `visit-plan:${req.user?.id || req.ip || 'anonymous'}`,
  message: 'You have recorded too many visit plans recently. Please try again later.',
});

router.use(authenticate);

// Health Services directory & schedule availability (`RESIDENT_ROLES`):
// - GET /health-services                  : Lists active services offered by the resident's barangay health center and covering RHU.
// - GET /health-services/:id/availability : Checks date/slot availability for service `:id` (`serviceIdParamValidator`, `availabilityQueryValidator`).
router.get('/health-services', authorize(RESIDENT_ROLES), asyncHandler(controller.directory));
router.get(
  '/health-services/:id/availability',
  authorize(RESIDENT_ROLES),
  serviceIdParam,
  validate(availabilityQueryValidator, 'query'),
  asyncHandler(controller.availability),
);

// Resident visit-plan CRUD (verified residents only):
// - GET    /visit-plans     : Lists the authenticated resident's visit plans (`listQueryValidator` query filters).
// - POST   /visit-plans     : Records a new visit intent (`planRateLimit`, `createPlanValidator` body).
// - DELETE /visit-plans/:id : Cancels/deletes caller-owned visit plan `:id` (`idParamValidator`).
router.get('/visit-plans', authorize(VERIFIED_RESIDENT_ROLES), validate(listQueryValidator, 'query'), asyncHandler(controller.list));
router.post('/visit-plans', authorize(VERIFIED_RESIDENT_ROLES), planRateLimit, validate(createPlanValidator), asyncHandler(controller.create));
router.delete('/visit-plans/:id', authorize(VERIFIED_RESIDENT_ROLES), idParam, asyncHandler(controller.remove));

export default router;
