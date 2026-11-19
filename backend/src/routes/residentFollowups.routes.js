import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/apiError.js';
import * as controller from '../controllers/residentFollowups.controller.js';

/**
 * Resident-facing follow-up routes (resident self-service portal).
 *
 * Role in KALUSAGAP:
 * Allows residents (both verified `resident` and pending `resident-limited`
 * accounts) to view their scheduled health follow-ups and approve or decline
 * follow-up proposals awaiting their confirmation.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(RESIDENT_ROLES) -> [requireUuid]
 *         -> residentFollowups.controller -> residentFollowups.service -> Supabase
 *
 * Isolation & ownership:
 * Deliberately separated from the staff `/operational/followups` endpoints —
 * residents are never granted access to staff operational routes. Ownership is
 * resolved strictly from the authenticated session (`req.user`), so tampering
 * with `:id`, query parameters, or body fields can never access another
 * resident's follow-up record.
 */
const router = Router();

const RESIDENT_ROLES = FEATURE_ROLES.residentSelf; // ['resident', 'resident-limited']
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Validates `:id` format up front and returns HTTP 404 for malformed UUIDs
// rather than surfacing database cast errors.
const requireUuid = (req, _res, next) => {
  if (!UUID.test(String(req.params.id || ''))) return next(ApiError.notFound('Follow-up not found.'));
  return next();
};

router.use(authenticate);

// Resident self-service follow-up endpoints:
// - GET  /follow-ups             : Lists the caller's own follow-ups (optional status/pagination query params).
// - GET  /follow-ups/:id         : Fetches single follow-up `:id` if owned by the caller.
// - POST /follow-ups/:id/approve : Confirms/approves follow-up `:id` (optional response notes in `req.body`).
// - POST /follow-ups/:id/reject  : Declines/rejects follow-up `:id` (optional reason/notes in `req.body`).
router.get('/follow-ups', authorize(RESIDENT_ROLES), asyncHandler(controller.list));
router.get('/follow-ups/:id', authorize(RESIDENT_ROLES), requireUuid, asyncHandler(controller.get));
router.post('/follow-ups/:id/approve', authorize(RESIDENT_ROLES), requireUuid, asyncHandler(controller.approve));
router.post('/follow-ups/:id/reject', authorize(RESIDENT_ROLES), requireUuid, asyncHandler(controller.reject));

export default router;
