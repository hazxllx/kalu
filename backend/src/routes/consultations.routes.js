/**
 * Clinical consultation and visit record routes (`/api/consultations` and `/api/health-records`).
 *
 * Request pipeline:
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles, permission) -> [idempotency] -> controller -> service -> Supabase
 *
 * Handles consultation CRUD with server-side validation of vitals, assessments,
 * treatments, and referrals. Durable idempotency keys ensure offline or retrying
 * clients can safely submit consultations without creating duplicate records.
 * Scope is enforced by barangay assignment (Health Supervisor / PHN) or
 * municipality (MHO), while residents may only read their own consultation history.
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

// Authenticate every caller and attach session-derived barangay/municipality scope.
router.use(authenticate, resolveBarangayScope);

// GET /api/consultations — List consultations (scoped clinical staff or residents viewing their own history via query filters).
router.get(
  '/',
  authorize([...FEATURE_ROLES.consultations, ROLES.RESIDENT], {
    anyPermission: ['consultation.requests.view', 'consultation.history.view'],
  }),
  asyncHandler(controller.list),
);

// POST /api/consultations — Record a new clinical consultation (`req.body` + optional `Idempotency-Key` header).
// Durable idempotency derives a deterministic key via `consultationOperationKey` and verifies replay scope via `validateCreateReplay`.
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

// GET /api/consultations/:id — Retrieve a single consultation record by `:id` (scope-checked for staff; ownership-checked for residents).
router.get(
  '/:id',
  authorize([...FEATURE_ROLES.consultations, ROLES.RESIDENT], {
    anyPermission: ['consultation.requests.view', 'consultation.history.view'],
  }),
  asyncHandler(controller.get),
);

// PUT /api/consultations/:id — Update clinical vitals, assessment, or treatment details on consultation `:id`.
router.put(
  '/:id',
  authorize(FEATURE_ROLES.consultations, { permission: 'consultation.records.update' }),
  asyncHandler(controller.update),
);

export default router;
