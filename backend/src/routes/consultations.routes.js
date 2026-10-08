import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES, ROLES } from '../config/roles.js';
import * as controller from '../controllers/consultations.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();
router.use(authenticate, resolveBarangayScope);
router.get(
  '/',
  authorize([...FEATURE_ROLES.consultations, ROLES.RESIDENT], {
    anyPermission: ['consultation.requests.view', 'consultation.history.view'],
  }),
  asyncHandler(controller.list),
);
router.post(
  '/',
  authorize(FEATURE_ROLES.consultations, { permission: 'consultation.conduct' }),
  asyncHandler(controller.create),
);
router.put(
  '/:id',
  authorize(FEATURE_ROLES.consultations, { permission: 'consultation.records.update' }),
  asyncHandler(controller.update),
);

export default router;