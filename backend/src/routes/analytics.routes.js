import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { resolveOrganizationScope } from '../middleware/organizationScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import { getEarlyWarning } from '../controllers/analytics.controller.js';

/**
 * Monitoring / aggregate analytics endpoints.
 *
 * Every route is authenticated, role-checked (FEATURE_ROLES.analytics:
 * MHO + Health Supervisor) and barangay-scoped from the session, so a
 * barangay-assigned Health Supervisor can never pull municipality-wide or
 * other-barangay figures by manipulating the request.
 */
const router = Router();

router.get('/early-warning', authenticate, authorize(FEATURE_ROLES.analytics), resolveOrganizationScope, resolveBarangayScope, getEarlyWarning);

export default router;
