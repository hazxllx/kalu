import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as controller from '../controllers/m1.controller.js';

/**
 * FHSIS M1 reporting routes (public.m1_records + reuse of existing health data).
 *
 * Flow: authenticate -> resolveBarangayScope -> authorize(roles) -> controller.
 * The service re-enforces barangay/municipality scope on every query and
 * Supabase RLS mirrors it, so no caller can read another barangay's M1 data by
 * changing a query/body parameter.
 */
const router = Router();
router.use(authenticate, resolveBarangayScope);

const READ = FEATURE_ROLES.m1Read; // HS, PHN, MHO, RHU personnel
const WRITE = FEATURE_ROLES.m1Write; // HS + PHN + BHW record events

// Catalog (reference data for every staff member).
router.get('/catalog', authorize(READ), asyncHandler(controller.catalog));
router.post('/catalog/sync', authorize(['admin']), asyncHandler(controller.syncCatalog));

// Views
router.get('/daily', authorize(READ), asyncHandler(controller.daily));
router.get('/monthly', authorize(READ), asyncHandler(controller.monthly));
router.get('/annual', authorize(READ), asyncHandler(controller.annual));
router.get('/drilldown/:code', authorize(READ), asyncHandler(controller.drilldown));

// Report header + section remarks
router.get('/meta', authorize(READ), asyncHandler(controller.getMeta));
router.put('/meta', authorize(WRITE), asyncHandler(controller.saveMeta));
router.put('/remarks/:code', authorize(WRITE), asyncHandler(controller.saveRemarks));

// Underlying record CRUD
router.post('/records', authorize(WRITE), asyncHandler(controller.createRecord));
router.put('/records/:id', authorize(WRITE), asyncHandler(controller.updateRecord));
router.delete('/records/:id', authorize(WRITE), asyncHandler(controller.removeRecord));

export default router;
