/**
 * Consultation endpoints (vitals, assessments, treatment, referrals).
 *
 * Handles consultation CRUD with server-side validation of vitals and clinical data.
 * Idempotency keys ensure offline clients can safely retry without duplicates.
 * Scope is enforced by barangay assignment (Health Supervisor / PHN) or municipality (MHO).
 * Resident self-service allows viewing their own consultation history.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES, ROLES } from '../config/roles.js';
import * as controller from '../controllers/consultations.controller.js';
import asyncHandler from '../utils/asyncHandler.js';
import { createIdempotencyMiddleware } from '../middleware/idempotency.js';
import { consultationOperationKey, validateCreateReplay } from '../services/consultations.service.js';

const router = Router();
router.use(authenticate, resolveBarangayScope);
router.get(
  '/',
  authorize([...FEATURE_ROLES.consultations, ROLES.RESIDENT], {
    anyPermission: ['consultation.requests.view', 'consultation.history.view'],
  }),
  asyncHandler(controller.list),
);
router.post(
  '/',
  authorize(FEATURE_ROLES.consultations, { permission: 'consultation.conduct' }),
  createIdempotencyMiddleware({
    durable: true,
    getKey: (req) => consultationOperationKey(
      req.body?.consultation || req.body || {},
      req.headers['idempotency-key'],
    ),
    validateReplay: validateCreateReplay,
  }),
  asyncHandler(controller.create),
);
router.get(
  '/:id',
  authorize([...FEATURE_ROLES.consultations, ROLES.RESIDENT], {
    anyPermission: ['consultation.requests.view', 'consultation.history.view'],
  }),
  asyncHandler(controller.get),
);
router.put(
  '/:id',
  authorize(FEATURE_ROLES.consultations, { permission: 'consultation.records.update' }),
  asyncHandler(controller.update),
);

export default router;
