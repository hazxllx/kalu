import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as bpConfigController from '../controllers/bpConfig.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Blood-pressure threshold configuration — authoritative numeric cut-offs used
 * to classify a recorded reading.
 *
 *   GET /bp-config             active thresholds + labels (admin + clinical read)
 *   PUT /bp-config/thresholds  update the cut-offs (admin)
 *
 * Writes are additionally re-checked + audited in the service layer.
 */
const router = Router();

router.use(authenticate);

router.get(
  '/',
  authorize(FEATURE_ROLES.medicineCatalogRead),
  asyncHandler(bpConfigController.getConfig),
);
router.put(
  '/thresholds',
  authorize(FEATURE_ROLES.medicineCatalog, { permission: 'system.settings.manage' }),
  asyncHandler(bpConfigController.updateThresholds),
);

export default router;
