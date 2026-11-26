// backend/src/routes/medicines.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as medicinesController from '../controllers/medicines.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Medicine catalog routes — generic-first, administrator-managed formulary.
 *
 * Role in KALUSAGAP:
 * Provides the standardized medicine reference list searched during clinical
 * consultations and prescription recording, while restricting catalog maintenance
 * (creating, editing, activating/deactivating entries) to system administrators.
 * There is no stock or inventory quantity tracking on medicine catalog rows.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize -> medicines.controller
 *         -> medicines.service -> Supabase
 *
 * Endpoints:
 *   GET    /medicines              Search/list by generic or brand name (`medicineCatalogRead`)
 *   POST   /medicines              Create a medicine entry (`medicineCatalog` + `system.settings.manage`)
 *   PUT    /medicines/:id          Update medicine details (`medicineCatalog` + `system.settings.manage`)
 *   PATCH  /medicines/:id/active   Toggle active status (`medicineCatalog` + `system.settings.manage`)
 *
 * Writes are additionally re-checked and audit-logged in the service layer.
 */
const router = Router();

router.use(authenticate);

// Shared admin write guard requiring both `FEATURE_ROLES.medicineCatalog` and `system.settings.manage`.
const WRITE = authorize(FEATURE_ROLES.medicineCatalog, { permission: 'system.settings.manage' });

// GET / : Lists/searches medicines via query parameters (e.g., search query, active filter) for clinical/admin roles.
router.get('/', authorize(FEATURE_ROLES.medicineCatalogRead), asyncHandler(medicinesController.list));

// POST / : Creates a new catalog medicine from `req.body` (generic name, brand, dosage form/strength, etc.).
router.post('/', WRITE, asyncHandler(medicinesController.create));

// PUT /:id : Updates existing medicine `:id` with fields from `req.body`.
router.put('/:id', WRITE, asyncHandler(medicinesController.update));

// PATCH /:id/active : Activates or deactivates medicine `:id` using the active flag in `req.body`.
router.patch('/:id/active', WRITE, asyncHandler(medicinesController.setActive));

export default router;
