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
const statusPermission = (req) => {
  if (req.body?.status === 'Accepted') return ['referrals.approve'];
  if (req.body?.status === 'Cancelled') return ['referrals.reject'];
  return ['referrals.status.update'];
};
const referralReaders = authorize(READ_ROLES, {
  anyPermission: ['referrals.view', 'referrals.history.view'],
});

router.use(authenticate, resolveBarangayScope);

router.get('/', referralReaders, asyncHandler(controller.list));
router.get('/:id', referralReaders, asyncHandler(controller.get));
router.post('/', authorize(WRITE_ROLES, { permission: 'referrals.create' }), asyncHandler(controller.create));
router.put('/:id/status', authorize(WRITE_ROLES, { permission: statusPermission }), asyncHandler(controller.updateStatus));
router.put('/:id', authorize(WRITE_ROLES, { permission: 'referrals.assign' }), asyncHandler(controller.update));
router.delete('/:id', authorize(WRITE_ROLES, { permission: 'referrals.reject' }), asyncHandler(controller.remove));

export default router;
