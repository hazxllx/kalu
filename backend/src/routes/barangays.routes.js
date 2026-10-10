import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/barangays.controller.js';
import {
  createBarangayValidator,
  updateBarangayValidator,
  barangayIdParamValidator,
} from '../validators/barangays.validators.js';

/**
 * Admin Barangay Management — the database-backed barangay registry editor.
 *
 * Every route authenticates the Supabase token and then requires the `admin`
 * role (`FEATURE_ROLES.barangays`). The role is resolved server-side from the
 * `profiles` table by `authenticate`; it is never taken from the client. Any
 * non-admin receives 403; an unauthenticated caller receives 401. Public,
 * read-only barangay dropdowns do NOT use these endpoints — they read
 * public.barangays directly through the Supabase public-read policy.
 *
 *   GET    /api/barangays          list (search: ?q; filter: ?municipalityId, ?status)
 *   GET    /api/barangays/options  municipality + status choices for the editor
 *   POST   /api/barangays          create a barangay
 *   GET    /api/barangays/:id      read one barangay + dependency summary
 *   PUT    /api/barangays/:id      update (rename propagates to denormalized names)
 *   DELETE /api/barangays/:id      delete when safe; blocked when referenced
 */
const router = Router();

router.use(authenticate, authorize(FEATURE_ROLES.barangays));

const idParam = validate(barangayIdParamValidator, 'params');

router.get('/options', asyncHandler(controller.getBarangayOptions));
router.get('/', asyncHandler(controller.listBarangays));
router.post('/', validate(createBarangayValidator), asyncHandler(controller.createBarangay));
router.get('/:id', idParam, asyncHandler(controller.getBarangay));
router.put('/:id', idParam, validate(updateBarangayValidator), asyncHandler(controller.updateBarangay));
router.delete('/:id', idParam, asyncHandler(controller.deleteBarangay));

export default router;
