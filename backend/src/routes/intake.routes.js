import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import authorizeStation from '../middleware/authorizeStation.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import { RHU_STATIONS } from '../config/rhuStations.js';
import * as intakeController from '../controllers/intake.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Resident -> RHU intake workflow routes (`/api/intake`; BHW / RHU Personnel / Health Supervisor).
 *
 * Request pipeline:
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles, permission) -> authorizeStation(TRIAGE) -> controller -> service -> Supabase
 *
 *   GET  /api/intake/residents/search        prefill lookup for the intake form
 *   GET  /api/intake/residents/:id           single resident identity
 *   POST /api/intake/visits                  create draft submission (existing or
 *                                            new resident) with current visit
 *   GET  /api/intake/visits                  the caller's own submissions
 *   GET  /api/intake/visits/:id              single submission (own only)
 *   PUT  /api/intake/visits/:id              edit while DRAFT
 *   POST /api/intake/visits/:id/submit       validate + lock + hand off to PHN
 *
 * Every handler is enforced on the server: editing/submission are restricted to
 * the record's owner and the DRAFT state.
 *
 * STATION GATE: this IS the RHU Triage station. `authorizeStation(TRIAGE)`
 * constrains only the station-assigned roles — an RHU Personnel account must
 * hold the Triage station, so a Consultation-only RHU account is refused here
 * (and only sees Consultation). BHW keeps community intake (not station-gated),
 * and a Health Supervisor keeps its barangay/community intake regardless of
 * station. The service re-checks the same rule.
 */
const router = Router();

// Role sets for draft intake work vs final PHN queue submission, plus the RHU Triage station guard.
const intake = FEATURE_ROLES.intake;
const intakeSubmit = FEATURE_ROLES.intakeSubmit;
const triageStation = authorizeStation(RHU_STATIONS.TRIAGE);

// Require authenticated active session and bind barangay/municipality scope for every intake route.
router.use(authenticate, resolveBarangayScope);

// GET /api/intake/residents/search — Search scoped residents (`?q=`) to prefill intake demographics (`residents.profile.view` + Triage gate).
router.get(
  '/residents/search',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.searchResidents),
);

// GET /api/intake/residents/:id — Fetch a single resident's identity/demographics for intake prefill (`residents.profile.view` + Triage gate).
router.get(
  '/residents/:id',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.getResident),
);

// GET /api/intake/visits — List intake visit submissions created by the authenticated caller (`residents.profile.view` + Triage gate).
router.get(
  '/visits',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.listMySubmissions),
);

// POST /api/intake/visits — Create a new DRAFT intake visit submission for an existing or newly captured resident (`residents.create` + Triage gate).
router.post(
  '/visits',
  authorize(intake, { permission: 'residents.create' }),
  triageStation,
  asyncHandler(intakeController.createSubmission),
);

// GET /api/intake/visits/:id — Retrieve a single intake submission `:id` owned by the caller (`residents.profile.view` + Triage gate).
router.get(
  '/visits/:id',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.getSubmission),
);

// PUT /api/intake/visits/:id — Update vitals, complaints, or resident fields while submission `:id` remains in `DRAFT` (`residents.edit` + Triage gate).
router.put(
  '/visits/:id',
  authorize(intake, { permission: 'residents.edit' }),
  triageStation,
  asyncHandler(intakeController.updateSubmission),
);

// POST /api/intake/visits/:id/submit — Validate completeness, lock the `DRAFT`, and enqueue submission `:id` for PHN review (`intakeSubmit` + `residents.create` + Triage gate).
router.post(
  '/visits/:id/submit',
  authorize(intakeSubmit, { permission: 'residents.create' }),
  triageStation,
  asyncHandler(intakeController.submitSubmission),
);

export default router;
