import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import {
  getEarlyWarning,
  getCommunityMap,
  getCommunityMapTrends,
  getConditions,
} from '../controllers/analytics.controller.js';

/**
 * Monitoring / aggregate analytics endpoints.
 *
 * Every route is authenticated, role-checked (FEATURE_ROLES.analytics:
 * MHO + PHN + Health Supervisor) and barangay-scoped from the session, so a
 * barangay-assigned Health Supervisor can never pull municipality-wide or
 * other-barangay figures by manipulating the request.
 */
const router = Router();

router.get('/early-warning', authenticate, authorize(FEATURE_ROLES.analytics), resolveBarangayScope, getEarlyWarning);
router.get('/community-map', authenticate, authorize(FEATURE_ROLES.analytics), resolveBarangayScope, getCommunityMap);
router.get('/community-map/trends', authenticate, authorize(FEATURE_ROLES.analytics), resolveBarangayScope, getCommunityMapTrends);
router.get('/conditions', authenticate, authorize(FEATURE_ROLES.analytics), getConditions);

export default router;
