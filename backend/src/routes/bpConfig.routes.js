// backend/src/routes/bpConfig.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as bpConfigController from '../controllers/bpConfig.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Blood-pressure threshold configuration routes (`/api/bp-config`).
 *
 * Request pipeline:
 *   route -> authenticate -> authorize(roles [, permission]) -> controller -> service -> Supabase
 *
 * Provides the authoritative systolic/diastolic numeric cut-offs and clinical
 * category labels used across KALUSAGAP consultations and intake forms to
 * classify recorded blood-pressure readings.
 *
 *   GET /api/bp-config             active thresholds + labels (admin + clinical read)
 *   PUT /api/bp-config/thresholds  update the cut-offs (admin + `system.settings.manage`)
 *
 * Writes are additionally validated, re-checked, and audit-logged in the service layer.
 */
const router = Router();

// Require an authenticated active user profile for all BP configuration operations.
router.use(authenticate);

// GET /api/bp-config — Retrieve active BP classification thresholds and category labels (`FEATURE_ROLES.medicineCatalogRead`).
router.get(
  '/',
  authorize(FEATURE_ROLES.medicineCatalogRead),
  asyncHandler(bpConfigController.getConfig),
);

// PUT /api/bp-config/thresholds — Update systolic/diastolic threshold cut-offs in `req.body` (admin role + `system.settings.manage`).
router.put(
  '/thresholds',
  authorize(FEATURE_ROLES.medicineCatalog, { permission: 'system.settings.manage' }),
  asyncHandler(bpConfigController.updateThresholds),
);

export default router;
