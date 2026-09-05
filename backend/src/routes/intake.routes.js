import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { resolveOrganizationScope } from '../middleware/organizationScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
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
 */
const router = Router();

const intake = FEATURE_ROLES.intake;
const intakeSubmit = FEATURE_ROLES.intakeSubmit;

router.use(authenticate, resolveOrganizationScope, resolveBarangayScope);

router.get('/residents/search', authorize(intake), asyncHandler(intakeController.searchResidents));
router.get('/residents/:id', authorize(intake), asyncHandler(intakeController.getResident));

router.get('/visits', authorize(intake), asyncHandler(intakeController.listMySubmissions));
router.post('/visits', authorize(intake), asyncHandler(intakeController.createSubmission));
router.get('/visits/:id', authorize(intake), asyncHandler(intakeController.getSubmission));
router.put('/visits/:id', authorize(intake), asyncHandler(intakeController.updateSubmission));
router.post('/visits/:id/submit', authorize(intakeSubmit), asyncHandler(intakeController.submitSubmission));

export default router;
