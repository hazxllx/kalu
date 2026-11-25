import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/referrals.controller.js';

/**
 * Referral coordination routes (barangay-to-RHU & inter-facility operational workflow).
 *
 * Role in KALUSAGAP:
 * Manages clinical referral authoring, eligible recipient discovery, incoming
 * recipient queues, status progression (`Accepted`, `Rejected`, in-progress,
 * completed), and resident visibility into their own referrals.
 *
 * Architectural pipeline:
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles, permission)
 *         -> referrals.controller -> referrals.service -> Supabase / RPC
 *
 * Access-control model:
 * - Reads (`READ_ROLES`): Open to referral-record staff (Health Supervisor, PHN,
 *   MHO), explicitly assigned RHU station recipients, and residents (`resident` /
 *   `resident-limited`) for their own referral rows.
 * - Sender mutations (`WRITE_ROLES`: Health Supervisor, PHN): Create, re-route/edit,
 *   and cancel/delete referrals.
 * - Recipient decisions (`RECIPIENT_ROLES`: Health Supervisor, PHN, RHU Personnel):
 *   View incoming queue and accept, reject, progress, or complete assigned referrals.
 * The service layer and database RPC independently re-verify geography and recipient assignment.
 */
const router = Router();

const RESIDENT_READ_ROLES = new Set(['resident', 'resident-limited']);
const WRITE_ROLES = ['health_supervisor', 'phn'];
const RECIPIENT_ROLES = ['health_supervisor', 'phn', 'rhu_personnel'];

/**
 * Dynamically maps the requested referral status in `req.body` (`record.status` or `status`)
 * to the required granular RBAC permission (`referrals.approve`, `referrals.reject`,
 * or `referrals.status.update`).
 *
 * @param {Object} req - Express request object.
 * @returns {Array<string>} Required permission IDs for `authorize`.
 */
export const statusPermission = (req) => {
  const status = (req.body?.record || req.body || {}).status;
  if (status === 'Accepted') return ['referrals.approve'];
  if (status === 'Rejected') return ['referrals.reject'];
  return ['referrals.status.update'];
};
const referralReaders = authorize(FEATURE_ROLES.referrals, {
  anyPermission: ['referrals.view', 'referrals.history.view'],
});
// Residents do not need staff referral permissions to read a referral from
// their own health record. The service still verifies the resident-to-account
// link on every request and returns 404 for anyone else's referral.
const residentReferralReader = authorize([...RESIDENT_READ_ROLES]);
const referralReader = (req, res, next) => {
  const reader = RESIDENT_READ_ROLES.has(req.user?.role) ? residentReferralReader : referralReaders;
  return reader(req, res, next);
};

router.use(authenticate, resolveBarangayScope);

// Read & discovery endpoints (static segments declared before '/:id'):
// - GET /                : Lists referrals visible to the caller (query filters: status, search, pagination).
// - GET /incoming        : Lists incoming referrals assigned to the caller or their RHU station.
// - GET /recipients      : Lists eligible recipient accounts/stations for authoring or re-routing a referral.
// - GET /visits/:visitId : Retrieves the referral linked to clinical visit/submission `:visitId`.
// - GET /:id             : Retrieves full details of referral `:id`.
router.get('/', referralReader, asyncHandler(controller.list));
router.get('/incoming', authorize(RECIPIENT_ROLES, { permission: 'referrals.view' }), asyncHandler(controller.incoming));
router.get('/recipients', authorize(WRITE_ROLES, { anyPermission: ['referrals.create', 'referrals.assign'] }), asyncHandler(controller.recipients));
router.get('/visits/:visitId', referralReader, asyncHandler(controller.getByVisit));
router.get('/:id', referralReader, asyncHandler(controller.get));

// Sender & recipient mutation endpoints:
// - POST   /           : Creates and routes a new referral from `req.body` (`WRITE_ROLES` + `referrals.create`).
// - PUT    /:id/status : Recipient status transition (`Accepted`, `Rejected`, etc.) via `req.body` (`RECIPIENT_ROLES`).
// - PUT    /:id        : Sender-side edit or recipient re-assignment via `req.body` (`WRITE_ROLES` + `referrals.assign`).
// - DELETE /:id        : Cancels/deletes referral `:id` (`WRITE_ROLES` + `referrals.status.update`).
router.post('/', authorize(WRITE_ROLES, { permission: 'referrals.create' }), asyncHandler(controller.create));
router.put('/:id/status', authorize(RECIPIENT_ROLES, { permission: statusPermission }), asyncHandler(controller.updateStatus));
router.put('/:id', authorize(WRITE_ROLES, { permission: 'referrals.assign' }), asyncHandler(controller.update));
router.delete('/:id', authorize(WRITE_ROLES, { permission: 'referrals.status.update' }), asyncHandler(controller.remove));

export default router;
