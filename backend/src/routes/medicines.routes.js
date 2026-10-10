import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as medicinesController from '../controllers/medicines.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Medicine catalog — generic-first, admin-managed.
 *
 *   GET    /medicines                   search (clinical read)
 *   POST   /medicines                   create (admin)
 *   PUT    /medicines/:id               edit (admin)
 *   PATCH  /medicines/:id/active        activate / deactivate (admin)
 *   GET    /medicines/:id/availability  per-facility availability (read)
 *   PUT    /medicines/:id/availability  set facility availability (admin)
 *
 * Writes are additionally re-checked + audited in the service layer.
 */
const router = Router();

router.use(authenticate);

const WRITE = authorize(FEATURE_ROLES.medicineCatalog, { permission: 'system.settings.manage' });

router.get('/', authorize(FEATURE_ROLES.medicineCatalogRead), asyncHandler(medicinesController.list));
router.get('/facilities', WRITE, asyncHandler(medicinesController.facilities));
router.post('/', WRITE, asyncHandler(medicinesController.create));
router.put('/:id', WRITE, asyncHandler(medicinesController.update));
router.patch('/:id/active', WRITE, asyncHandler(medicinesController.setActive));
router.get('/:id/availability', authorize(FEATURE_ROLES.medicineCatalogRead), asyncHandler(medicinesController.listAvailability));
router.put('/:id/availability', WRITE, asyncHandler(medicinesController.setAvailability));

export default router;
