import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/users.controller.js';

/**
 * Account / system administration — Admin User Management.
 *
 * Every route authenticates the Supabase token and then requires the `admin`
 * role (`FEATURE_ROLES.users`). The role is resolved server-side from the
 * `profiles` table by `authenticate`; it is never taken from the client. A PHN,
 * Health Supervisor, Resident, etc. receives 403 on every route here, and an
 * unauthenticated caller receives 401.
 *
 *   GET  /api/users        list accounts (search: ?q, ?role, ?status; ?limit,?offset)
 *   GET  /api/users/:id    read one account
 *   PUT  /api/users/:id    update profile fields / role / status (activate-deactivate)
 */
const router = Router();

router.use(authenticate, authorize(FEATURE_ROLES.users));

router.get('/', asyncHandler(controller.listUsers));
router.get('/:id', asyncHandler(controller.getUser));
router.put('/:id', asyncHandler(controller.updateUser));

export default router;
