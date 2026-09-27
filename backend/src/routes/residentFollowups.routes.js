import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/apiError.js';
import * as controller from '../controllers/residentFollowups.controller.js';

/**
 * Resident-facing follow-up routes (resident self-service).
 *
 *   route -> authenticate -> authorize(resident/resident-limited) -> controller -> service
 *
 * These endpoints are DELIBERATELY separate from the staff `/operational/*`
 * follow-up endpoints: a resident is never granted the staff endpoints. A
 * resident (including a pending `resident-limited` account) may list and read
 * ONLY their own follow-ups and approve/reject a follow-up that is awaiting
 * their response. The service resolves ownership from the session, so a changed
 * :id, query param or body field can never reach another resident's record.
 */
const router = Router();

const RESIDENT_ROLES = FEATURE_ROLES.residentSelf; // ['resident', 'resident-limited']
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const requireUuid = (req, _res, next) => {
  if (!UUID.test(String(req.params.id || ''))) return next(ApiError.notFound('Follow-up not found.'));
  return next();
};

router.use(authenticate);

router.get('/follow-ups', authorize(RESIDENT_ROLES), asyncHandler(controller.list));
router.get('/follow-ups/:id', authorize(RESIDENT_ROLES), requireUuid, asyncHandler(controller.get));
router.post('/follow-ups/:id/approve', authorize(RESIDENT_ROLES), requireUuid, asyncHandler(controller.approve));
router.post('/follow-ups/:id/reject', authorize(RESIDENT_ROLES), requireUuid, asyncHandler(controller.reject));

export default router;
