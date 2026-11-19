import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { createIdempotencyMiddleware } from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/apiError.js';
import * as controller from '../controllers/programForms.controller.js';
import * as service from '../services/programForms.service.js';
import { PROGRAM_KINDS } from '../config/programFormSchemas.js';

/**
 * Program-specific official DOH Target Client List (TCL) & health form routes.
 *
 * Role in KALUSAGAP:
 * Provides clinical CRUD and statistical aggregation for standardized DOH program
 * registries that feed FHSIS M1 reporting and community risk monitoring:
 *   /program-forms/ncd-risk        NCD Part 1 (Risk-Assessed Adults)
 *   /program-forms/ncd-cervical    NCD Part 2 (Cervical CA & Breast Mass Exam)
 *   /program-forms/ncd-visual      NCD Part 3 (Visual Acuity & PPV)
 *   /program-forms/oral-health     Oral Health TCL (+ /statistics for the ST table)
 *   /program-forms/environmental   Environmental Health Masterlist (household)
 *
 * Architectural pipeline:
 *   route -> authenticate -> resolveBarangayScope -> [assertKnownKind]
 *         -> authorize(staff) -> [programFormsIdempotency]
 *         -> programForms.controller -> programForms.service -> Supabase
 *
 * Scope & security:
 * Restricted to clinical/supervisory roles (`admin`, `mho`, `phn`, `health_supervisor`);
 * BHW accounts are intentionally excluded because these are official clinical
 * registries rather than raw field-collection forms. Geography scope is enforced
 * at the middleware, service, and Supabase RLS layers.
 */
const router = Router();
const staff = ['admin', 'mho', 'phn', 'health_supervisor'];

router.use(authenticate, resolveBarangayScope);

// Rejects unknown `:kind` path slugs with HTTP 400 before authorization or controller logic runs.
const assertKnownKind = (req, _res, next) => {
  if (!PROGRAM_KINDS.includes(req.params.kind)) return next(ApiError.badRequest('Unknown program form type.'));
  next();
};

// Durable `Idempotency-Key` protection for offline-tolerant POST/PUT form saves.
// Re-verifies caller geography scope on the cached record ID before serving any replay.
const programFormsIdempotency = createIdempotencyMiddleware({
  durable: true,
  validateReplay: async (req, responseBody) => {
    const recordId = responseBody?.data?.record?.id ?? responseBody?.record?.id;
    if (!recordId) throw ApiError.notFound('Program record not found.');
    await service.verifyRecordScope({
      user: req.user,
      kind: req.params.kind,
      id: recordId,
    });
  },
});

// GET /oral-health/statistics : Computes the Oral Health Statistical Table (ST)
// from saved `oral_health_records` for the requested period/scope query.
// Declared before `/:kind` so the static path matches cleanly.
router.get('/oral-health/statistics', authorize(staff), asyncHandler(controller.oralStatistics));

// Generic program-form CRUD (`:kind` validated against `PROGRAM_KINDS`):
// - GET    /:kind     : Lists scoped program records (query filters: search, period, barangay, pagination).
// - POST   /:kind     : Creates a `:kind` program record from `req.body` (durable idempotency).
// - PUT    /:kind/:id : Updates `:kind` program record `:id` from `req.body` (durable idempotency).
// - DELETE /:kind/:id : Deletes `:kind` program record `:id` within the caller's scope.
router.get('/:kind', assertKnownKind, authorize(staff), asyncHandler(controller.list));
router.post('/:kind', assertKnownKind, authorize(staff), programFormsIdempotency, asyncHandler(controller.create));
router.put('/:kind/:id', assertKnownKind, authorize(staff), programFormsIdempotency, asyncHandler(controller.update));
router.delete('/:kind/:id', assertKnownKind, authorize(staff), asyncHandler(controller.remove));

export default router;
