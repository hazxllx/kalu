import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { resolveOrganizationScope } from '../middleware/organizationScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as residentsController from '../controllers/residents.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Master resident-record endpoints for authorized health staff.
 *
 *   GET /residents/:id — PHN / Health Supervisor / MHO
 *   PUT /residents/:id — PHN / Health Supervisor (profile corrections)
 *
 * Barangay scoping is enforced twice: `resolveBarangayScope` rejects any
 * cross-barangay request before the controller runs, and the service layer
 * independently filters the record itself against the caller's assignment.
 */
const router = Router();

router.use(authenticate, resolveOrganizationScope, resolveBarangayScope);

router.get('/:id', authorize(FEATURE_ROLES.referralRecords), asyncHandler(residentsController.getResident));
router.put('/:id', authorize(['phn', 'health_supervisor']), asyncHandler(residentsController.updateResident));

export default router;
