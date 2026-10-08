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
const readers = { permission: 'reports.view' };
const writers = { permission: 'reports.generate' };

// Catalog (reference data for every staff member).
router.get('/catalog', authorize(READ, readers), asyncHandler(controller.catalog));
router.post('/catalog/sync', authorize(['admin'], { permission: 'system.settings.manage' }), asyncHandler(controller.syncCatalog));

// Views
router.get('/daily', authorize(READ, readers), asyncHandler(controller.daily));
router.get('/monthly', authorize(READ, readers), asyncHandler(controller.monthly));
router.get('/annual', authorize(READ, readers), asyncHandler(controller.annual));
router.get('/report', authorize(READ, readers), asyncHandler(controller.report));
router.get('/drilldown/:code', authorize(READ, readers), asyncHandler(controller.drilldown));

// Report header + section remarks
router.get('/meta', authorize(READ, readers), asyncHandler(controller.getMeta));
router.put('/meta', authorize(WRITE, writers), asyncHandler(controller.saveMeta));
router.put('/remarks/:code', authorize(WRITE, writers), asyncHandler(controller.saveRemarks));

// Manual M1 data entry (aggregate figures with no operational source).
router.get('/manual', authorize(READ, readers), asyncHandler(controller.listManual));
router.put('/manual', authorize(WRITE, writers), asyncHandler(controller.saveManual));

// Underlying record CRUD
router.post('/records', authorize(WRITE, writers), asyncHandler(controller.createRecord));
router.put('/records/:id', authorize(WRITE, writers), asyncHandler(controller.updateRecord));
router.delete('/records/:id', authorize(WRITE, writers), asyncHandler(controller.removeRecord));

export default router;
