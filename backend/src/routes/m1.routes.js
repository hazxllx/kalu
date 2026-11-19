import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as controller from '../controllers/m1.controller.js';

/**
 * FHSIS M1 reporting routes (`public.m1_records` + aggregation of clinical/program health data).
 *
 * Role in KALUSAGAP:
 * Exposes the Field Health Services Information System (FHSIS) Monthly Form M1
 * subsystem—covering indicator catalog reference/sync, program-specific source
 * record lookups, daily/monthly/annual rollups, indicator drilldowns, report
 * header metadata/remarks, manual aggregate overrides, and raw `m1_records` CRUD.
 *
 * Architectural pipeline:
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles, permission)
 *         -> m1.controller -> m1.service -> Supabase (with RLS)
 *
 * Scope & security:
 * `resolveBarangayScope` validates any barangay/municipality parameters against
 * the caller's session profile before authorization runs. The service layer
 * re-enforces geography scope on every query and Supabase RLS mirrors it, so no
 * caller can read or mutate another barangay's M1 data via query/body tampering.
 */
const router = Router();
router.use(authenticate, resolveBarangayScope);

const READ = FEATURE_ROLES.m1Read; // HS, PHN, MHO, RHU personnel
const WRITE = FEATURE_ROLES.m1Write; // HS + PHN + BHW record events
const readers = { permission: 'reports.view' };
const writers = { permission: 'reports.generate' };

// ---------------------------------------------------------------------------
// Indicator Catalog
// - GET  /catalog       : Returns FHSIS M1 section/indicator definitions for staff.
// - POST /catalog/sync  : Reseeds/synchronizes catalog definitions (admin only,
//                         gated by `system.settings.manage`).
// ---------------------------------------------------------------------------
router.get('/catalog', authorize(READ, readers), asyncHandler(controller.catalog));
router.post('/catalog/sync', authorize(['admin'], { permission: 'system.settings.manage' }), asyncHandler(controller.syncCatalog));

// ---------------------------------------------------------------------------
// Program-Specific Source Record Retrieval (`READ` + `reports.view`)
// Accepts query filters (reporting period/month/year, barangay scope) and
// returns underlying clinical/program records that feed M1 indicator tallies.
// ---------------------------------------------------------------------------
router.get('/programs/prenatal/records', authorize(READ, readers), asyncHandler(controller.getPrenatalRecords));
router.get('/programs/ncd/records', authorize(READ, readers), asyncHandler(controller.getNcdRecords));
router.get('/programs/cervical/records', authorize(READ, readers), asyncHandler(controller.getCervicalRecords));
router.get('/programs/visual/records', authorize(READ, readers), asyncHandler(controller.getVisualRecords));
router.get('/programs/oral/records', authorize(READ, readers), asyncHandler(controller.getOralRecords));
router.get('/programs/environmental/records', authorize(READ, readers), asyncHandler(controller.getEnvironmentalRecords));
router.get('/programs/enrollment/records', authorize(READ, readers), asyncHandler(controller.getEnrollmentRecords));

// ---------------------------------------------------------------------------
// Aggregated M1 Views & Drilldowns (`READ` + `reports.view`)
// - GET /daily            : Daily indicator tally for a query date/month and scope.
// - GET /monthly          : Monthly indicator rollup for a query year/month and scope.
// - GET /annual           : Annualized M1 indicator totals across months for a year.
// - GET /report           : Complete M1 report payload (computed counts + manual
//                           entries + header metadata + section/indicator remarks).
// - GET /drilldown/:code  : Lists individual source records contributing to the
//                           indicator identified by `:code` for period/scope queries.
// ---------------------------------------------------------------------------
router.get('/daily', authorize(READ, readers), asyncHandler(controller.daily));
router.get('/monthly', authorize(READ, readers), asyncHandler(controller.monthly));
router.get('/annual', authorize(READ, readers), asyncHandler(controller.annual));
router.get('/report', authorize(READ, readers), asyncHandler(controller.report));
router.get('/drilldown/:code', authorize(READ, readers), asyncHandler(controller.drilldown));

// ---------------------------------------------------------------------------
// Report Header Metadata & Section/Indicator Remarks
// - GET /meta          : Reads saved report header metadata (signatories, facility,
//                        period details) via query parameters (`READ`).
// - PUT /meta          : Upserts report header metadata from `req.body` (`WRITE`).
// - PUT /remarks/:code : Saves narrative remarks in `req.body` for section or
//                        indicator `:code` (`WRITE`).
// ---------------------------------------------------------------------------
router.get('/meta', authorize(READ, readers), asyncHandler(controller.getMeta));
router.put('/meta', authorize(WRITE, writers), asyncHandler(controller.saveMeta));
router.put('/remarks/:code', authorize(WRITE, writers), asyncHandler(controller.saveRemarks));

// ---------------------------------------------------------------------------
// Manual M1 Data Entry (aggregate figures with no operational record source)
// - GET /manual : Lists manually entered indicator values for a period/scope (`READ`).
// - PUT /manual : Upserts manual aggregate indicator counts from `req.body` (`WRITE`).
// ---------------------------------------------------------------------------
router.get('/manual', authorize(READ, readers), asyncHandler(controller.listManual));
router.put('/manual', authorize(WRITE, writers), asyncHandler(controller.saveManual));

// ---------------------------------------------------------------------------
// Underlying `public.m1_records` CRUD (`WRITE` + `reports.generate`)
// - POST   /records     : Creates a discrete M1 event record from `req.body`.
// - PUT    /records/:id : Updates M1 event record `:id` with `req.body`.
// - DELETE /records/:id : Removes M1 event record `:id` within the caller's scope.
// ---------------------------------------------------------------------------
router.post('/records', authorize(WRITE, writers), asyncHandler(controller.createRecord));
router.put('/records/:id', authorize(WRITE, writers), asyncHandler(controller.updateRecord));
router.delete('/records/:id', authorize(WRITE, writers), asyncHandler(controller.removeRecord));

export default router;
