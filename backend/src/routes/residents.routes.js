import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as residentsController from '../controllers/residents.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Master resident-record endpoints for authorized health staff.
 *
 *   GET /residents/:id — PHN / Health Supervisor / MHO
 *   PUT /residents/:id — PHN / Health Supervisor (profile corrections)
 */
const router = Router();

router.use(authenticate);

router.get('/:id', authorize(FEATURE_ROLES.referralRecords), asyncHandler(residentsController.getResident));
router.put('/:id', authorize(['phn', 'health_supervisor']), asyncHandler(residentsController.updateResident));

export default router;
