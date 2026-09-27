import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/referrals.controller.js';

/**
 * Referral coordination routes (barangay-scoped operational workflow).
 *
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles) -> controller -> service
 *
 * Reads are open to the referral-record roles (Health Supervisor / PHN / MHO)
 * and to a resident for their own referrals; writes are limited to the staff
 * who own the workflow. The service re-checks role + barangay/municipality
 * scope on every call, so route authorization is the first gate, not the only
 * one.
 */
const router = Router();

const READ_ROLES = [...FEATURE_ROLES.referrals, 'resident', 'resident-limited'];
const WRITE_ROLES = ['health_supervisor', 'phn'];

router.use(authenticate, resolveBarangayScope);

router.get('/', authorize(READ_ROLES), asyncHandler(controller.list));
router.get('/:id', authorize(READ_ROLES), asyncHandler(controller.get));
router.post('/', authorize(WRITE_ROLES), asyncHandler(controller.create));
router.put('/:id/status', authorize(WRITE_ROLES), asyncHandler(controller.updateStatus));
router.put('/:id', authorize(WRITE_ROLES), asyncHandler(controller.update));
router.delete('/:id', authorize(WRITE_ROLES), asyncHandler(controller.remove));

export default router;
