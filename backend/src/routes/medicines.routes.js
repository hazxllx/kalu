import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as medicinesController from '../controllers/medicines.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Medicine catalog — generic-first, admin-managed.
 *
 *   GET    /medicines              search by generic OR brand (clinical read)
 *   POST   /medicines              create (admin)
 *   PUT    /medicines/:id          edit (admin)
 *   PATCH  /medicines/:id/active   activate / deactivate (admin)
 *
 * Writes are additionally re-checked + audited in the service layer. There is
 * no stock/availability tracking on medicines.
 */
const router = Router();

router.use(authenticate);

const WRITE = authorize(FEATURE_ROLES.medicineCatalog, { permission: 'system.settings.manage' });

router.get('/', authorize(FEATURE_ROLES.medicineCatalogRead), asyncHandler(medicinesController.list));
router.post('/', WRITE, asyncHandler(medicinesController.create));
router.put('/:id', WRITE, asyncHandler(medicinesController.update));
router.patch('/:id/active', WRITE, asyncHandler(medicinesController.setActive));

export default router;
