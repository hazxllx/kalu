import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import idempotency from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/apiError.js';
import * as controller from '../controllers/programForms.controller.js';
import { PROGRAM_KINDS } from '../config/programFormSchemas.js';

/**
 * Program-specific official TCL / health forms:
 *   /program-forms/ncd-risk        NCD Part 1 (Risk-Assessed Adults)
 *   /program-forms/ncd-cervical    NCD Part 2 (Cervical CA & Breast Mass Exam)
 *   /program-forms/ncd-visual      NCD Part 3 (Visual Acuity & PPV)
 *   /program-forms/oral-health     Oral Health TCL (+ /statistics for the ST table)
 *   /program-forms/environmental   Environmental Health Masterlist (household)
 *
 * These are clinical records: Health Supervisor (barangay-scoped), PHN and MHO
 * (municipality-wide). BHW is intentionally excluded (data-collection only, not
 * clinical records). Scope + authorization are re-enforced in the service and
 * by Supabase RLS.
 */
const router = Router();
const staff = ['admin', 'mho', 'phn', 'health_supervisor'];

router.use(authenticate, resolveBarangayScope);

const assertKnownKind = (req, _res, next) => {
  if (!PROGRAM_KINDS.includes(req.params.kind)) return next(ApiError.badRequest('Unknown program form type.'));
  next();
};

// Oral Health statistical table (ST) — computed from saved oral_health_records.
router.get('/oral-health/statistics', authorize(staff), asyncHandler(controller.oralStatistics));

router.get('/:kind', assertKnownKind, authorize(staff), asyncHandler(controller.list));
router.post('/:kind', assertKnownKind, authorize(staff), idempotency, asyncHandler(controller.create));
router.put('/:kind/:id', assertKnownKind, authorize(staff), idempotency, asyncHandler(controller.update));
router.delete('/:kind/:id', assertKnownKind, authorize(staff), asyncHandler(controller.remove));

export default router;
