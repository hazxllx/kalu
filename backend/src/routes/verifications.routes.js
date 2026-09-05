import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { resolveOrganizationScope } from '../middleware/organizationScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as verificationsController from '../controllers/verifications.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Resident verification review routes.
 *
 * Every route is authenticated, role-checked (FEATURE_ROLES.verification:
 * Health Supervisor / PHN) and barangay-scoped from the session.
 */
const router = Router();

router.get('/pending', authenticate, authorize(FEATURE_ROLES.verification), resolveOrganizationScope, resolveBarangayScope, asyncHandler(verificationsController.listPending));
router.get('/history', authenticate, authorize(FEATURE_ROLES.verification), resolveOrganizationScope, resolveBarangayScope, asyncHandler(verificationsController.listHistory));
router.post('/:ref/decision', authenticate, authorize(FEATURE_ROLES.verification), resolveOrganizationScope, resolveBarangayScope, asyncHandler(verificationsController.decide));

export default router;
