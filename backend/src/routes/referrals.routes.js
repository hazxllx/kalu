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
 * Reads are open to the referral-record roles (Health Supervisor / PHN / MHO),
 * explicitly assigned RHU station recipients, and residents for their own rows.
 * Only the sender edits/routes; only the current recipient accepts/rejects/
 * progresses/completes. The service and RPC recheck current geography/assignment.
 */
const router = Router();

const READ_ROLES = [...FEATURE_ROLES.referrals, 'resident', 'resident-limited'];
const WRITE_ROLES = ['health_supervisor', 'phn'];
const RECIPIENT_ROLES = ['health_supervisor', 'phn', 'rhu_personnel'];
export const statusPermission = (req) => {
  const status = (req.body?.record || req.body || {}).status;
  if (status === 'Accepted') return ['referrals.approve'];
  if (status === 'Rejected') return ['referrals.reject'];
  return ['referrals.status.update'];
};
const referralReaders = authorize(READ_ROLES, {
  anyPermission: ['referrals.view', 'referrals.history.view'],
});

router.use(authenticate, resolveBarangayScope);

router.get('/', referralReaders, asyncHandler(controller.list));
router.get('/incoming', authorize(RECIPIENT_ROLES, { permission: 'referrals.view' }), asyncHandler(controller.incoming));
router.get('/recipients', authorize(WRITE_ROLES, { anyPermission: ['referrals.create', 'referrals.assign'] }), asyncHandler(controller.recipients));
router.get('/visits/:visitId', referralReaders, asyncHandler(controller.getByVisit));
router.get('/:id', referralReaders, asyncHandler(controller.get));
router.post('/', authorize(WRITE_ROLES, { permission: 'referrals.create' }), asyncHandler(controller.create));
router.put('/:id/status', authorize(RECIPIENT_ROLES, { permission: statusPermission }), asyncHandler(controller.updateStatus));
router.put('/:id', authorize(WRITE_ROLES, { permission: 'referrals.assign' }), asyncHandler(controller.update));
router.delete('/:id', authorize(WRITE_ROLES, { permission: 'referrals.status.update' }), asyncHandler(controller.remove));

export default router;
