// backend/src/routes/analytics.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getRecentActivities } from '../controllers/recentActivities.controller.js';
import { getBarangayBoundaries } from '../controllers/barangayBoundaries.controller.js';
import {
  getEarlyWarning,
  getCommunityMap,
  getCommunityMapTrends,
  getConditions,
  getHouseholdMap,
} from '../controllers/analytics.controller.js';

/**
 * Community health risk monitoring and spatial analytics routes (`/api/analytics`).
 *
 * Request pipeline:
 *   route -> authenticate -> authorize(roles, permission) -> [resolveBarangayScope] -> controller -> service -> Supabase
 *
 * Every route requires authentication, `FEATURE_ROLES.analytics` (MHO, PHN,
 * Health Supervisor), and the `reports.analytics.view` permission. Data-bearing
 * endpoints additionally run `resolveBarangayScope` to bind queries to the
 * caller's session-assigned barangay or municipality, preventing a
 * barangay-assigned Health Supervisor from pulling cross-barangay or
 * municipality-wide figures by manipulating query parameters.
 */
const router = Router();

router.get('/barangay-boundaries', authenticate, authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }), resolveBarangayScope, asyncHandler(getBarangayBoundaries));

// Latest five privacy-safe monitoring events within the caller's stored scope.
router.get('/recent-activities', authenticate, authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }), resolveBarangayScope, asyncHandler(getRecentActivities));

// GET /api/analytics/early-warning — Aggregate early-warning alerts and risk spikes within the caller's barangay/municipality scope.
router.get('/early-warning', authenticate, authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }), resolveBarangayScope, asyncHandler(getEarlyWarning));

// GET /api/analytics/community-map — Barangay-level risk distribution and case counts for community GIS map layers (query filters + session scope).
router.get('/community-map', authenticate, authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }), resolveBarangayScope, asyncHandler(getCommunityMap));

// GET /api/analytics/household-map — Geotagged household-level risk markers restricted to the caller's scoped barangay/municipality.
router.get('/household-map', authenticate, authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }), resolveBarangayScope, asyncHandler(getHouseholdMap));

// GET /api/analytics/community-map/trends — Time-series risk and condition trend aggregations for map analytics within session scope.
router.get('/community-map/trends', authenticate, authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }), resolveBarangayScope, asyncHandler(getCommunityMapTrends));

// GET /api/analytics/conditions — Reference list of reportable/filterable health conditions for analytics filter controls (catalog data; not barangay-specific).
router.get('/conditions', authenticate, authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }), asyncHandler(getConditions));

export default router;
