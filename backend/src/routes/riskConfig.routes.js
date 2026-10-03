import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as riskConfigController from '../controllers/riskConfig.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Resident risk configuration — authoritative criteria + thresholds.
 *
 *   GET    /risk-config                 read (admin + clinical/monitoring roles)
 *   PUT    /risk-config/thresholds      admin
 *   POST   /risk-config/criteria        admin
 *   PUT    /risk-config/criteria/:code  admin
 *   DELETE /risk-config/criteria/:code  admin
 *   POST   /risk-config/recalculate     admin
 *
 * Writes are additionally re-checked and audited in the service layer. The
 * backend is authoritative — resident risk is always computed from this
 * configuration, never from a client-supplied score/level.
 */
const router = Router();

router.use(authenticate);

router.get('/', authorize(FEATURE_ROLES.riskConfigRead), asyncHandler(riskConfigController.getConfig));
router.put('/thresholds', authorize(FEATURE_ROLES.riskConfig), asyncHandler(riskConfigController.updateThresholds));
router.post('/criteria', authorize(FEATURE_ROLES.riskConfig), asyncHandler(riskConfigController.upsertCriterion));
router.put('/criteria/:code', authorize(FEATURE_ROLES.riskConfig), asyncHandler(riskConfigController.upsertCriterion));
router.delete('/criteria/:code', authorize(FEATURE_ROLES.riskConfig), asyncHandler(riskConfigController.deleteCriterion));
router.post('/recalculate', authorize(FEATURE_ROLES.riskConfig), asyncHandler(riskConfigController.recalculate));

export default router;
