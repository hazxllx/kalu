// backend/src/routes/barangays.routes.js
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
  updateBarangayStatusValidator,
  barangayIdParamValidator,
} from '../validators/barangays.validators.js';

/**
 * Admin Barangay Management — the database-backed barangay registry editor (`/api/barangays`).
 *
 * Request pipeline:
 *   route -> [authenticate -> authorize(FEATURE_ROLES.barangays)] -> [validate(params|body)] -> controller -> service -> Supabase
 *
 * Every route authenticates the Supabase token and then requires the `admin`
 * role (`FEATURE_ROLES.barangays`). The role is resolved server-side from the
 * `profiles` table by `authenticate`; it is never taken from the client. Any
 * non-admin receives 403; an unauthenticated caller receives 401. The one
 * exception is GET /public, a deliberately minimal active-name projection for
 * public registration dropdowns so browsers still use the centralized API.
 *
 * Barangays are managed by STATUS, not by deletion (permanent delete was
 * removed): setting a barangay Inactive keeps every resident, household,
 * personnel assignment and historical record intact while hiding it from new
 * selections. There is intentionally NO DELETE route here.
 *
 *   GET    /api/barangays/public   active barangay names for public registration forms
 *   GET    /api/barangays          list (search: ?q; filter: ?municipalityId, ?status)
 *   GET    /api/barangays/options  municipality + status choices for the editor
 *   POST   /api/barangays          create a barangay
 *   GET    /api/barangays/:id      read one barangay + dependency summary
 *   PUT    /api/barangays/:id      update (rename propagates to denormalized names)
 *   PATCH  /api/barangays/:id/status   change Active/Inactive status only
 */
const router = Router();

// GET /api/barangays/public — Unauthenticated read of active barangays; registered BEFORE the admin auth wall.
router.get('/public', asyncHandler(controller.listPublicBarangays));
// All remaining barangay management endpoints require an authenticated admin session.
router.use(authenticate, authorize(FEATURE_ROLES.barangays));

// Reusable path validator ensuring `:id` is a valid barangay identifier.
const idParam = validate(barangayIdParamValidator, 'params');

// GET /api/barangays/options — Selectable municipality and status options (mounted before `/:id` so `'options'` is not parsed as an ID).
router.get('/options', asyncHandler(controller.getBarangayOptions));
// GET /api/barangays — List and filter barangays (`?q`, `?municipalityId`, `?status`).
router.get('/', asyncHandler(controller.listBarangays));
// POST /api/barangays — Create a new barangay (`createBarangayValidator` on `req.body`).
router.post('/', validate(createBarangayValidator), asyncHandler(controller.createBarangay));
// GET /api/barangays/:id — Read one barangay record along with linked entity dependency counts (`idParam`).
router.get('/:id', idParam, asyncHandler(controller.getBarangay));
// PUT /api/barangays/:id — Update barangay details and propagate name changes (`idParam` + `updateBarangayValidator`).
router.put('/:id', idParam, validate(updateBarangayValidator), asyncHandler(controller.updateBarangay));
// PATCH /api/barangays/:id/status — Change barangay Active/Inactive status without deleting historical records (`idParam` + `updateBarangayStatusValidator`).
router.patch('/:id/status', idParam, validate(updateBarangayStatusValidator), asyncHandler(controller.updateBarangayStatus));

export default router;
