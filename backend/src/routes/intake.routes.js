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
 * Resident -> RHU intake workflow (BHW / RHU Personnel / Health Supervisor).
 *
 *   GET  /intake/residents/search        prefill lookup for the intake form
 *   GET  /intake/residents/:id           single resident identity
 *   POST /intake/visits                  create draft submission (existing or
 *                                        new resident) with current visit
 *   GET  /intake/visits                  the caller's own submissions
 *   GET  /intake/visits/:id              single submission (own only)
 *   PUT  /intake/visits/:id              edit while DRAFT
 *   POST /intake/visits/:id/submit       validate + lock + hand off to PHN
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

const intake = FEATURE_ROLES.intake;
const intakeSubmit = FEATURE_ROLES.intakeSubmit;
const triageStation = authorizeStation(RHU_STATIONS.TRIAGE);

router.use(authenticate, resolveBarangayScope);

router.get(
  '/residents/search',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.searchResidents),
);
router.get(
  '/residents/:id',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.getResident),
);

router.get(
  '/visits',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.listMySubmissions),
);
router.post(
  '/visits',
  authorize(intake, { permission: 'residents.create' }),
  triageStation,
  asyncHandler(intakeController.createSubmission),
);
router.get(
  '/visits/:id',
  authorize(intake, { permission: 'residents.profile.view' }),
  triageStation,
  asyncHandler(intakeController.getSubmission),
);
router.put(
  '/visits/:id',
  authorize(intake, { permission: 'residents.edit' }),
  triageStation,
  asyncHandler(intakeController.updateSubmission),
);
router.post(
  '/visits/:id/submit',
  authorize(intakeSubmit, { permission: 'residents.create' }),
  triageStation,
  asyncHandler(intakeController.submitSubmission),
);

export default router;
