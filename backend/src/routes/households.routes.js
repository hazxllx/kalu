/**
 * Household Profiling routes.
 *
 *   GET    /households                    list + search, scope-enforced
 *   GET    /households/:id                single household incl. members
 *   POST   /households                    register a household (risk computed
 *                                         server-side, duplicates rejected)
 *   PUT    /households/:id                update fields / HS verification
 *   POST   /households/:id/members        add a member (existing resident or
 *                                         free-form; duplicates rejected)
 *   DELETE /households/:id/members/:mid   remove a member
 *
 * Barangay scope is enforced twice: `resolveBarangayScope` rejects any
 * cross-barangay query/body value before the controller runs, and the service
 * layer independently re-checks each record against the caller's assignment
 * (out-of-scope households are reported as absent — 404 — so ids cannot be
 * probed). Row Level Security mirrors the same rules at the database.
 */
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import householdsController from '../controllers/households.controller.js';
import validate from '../middleware/validate.js';
import {
  createHouseholdValidator,
  householdMemberValidator,
  householdParamsValidator,
  updateHouseholdValidator,
} from '../validators/household.validators.js';
import { FEATURE_ROLES } from '../config/roles.js';

const router = Router();

router.use(authenticate, resolveBarangayScope);

const HOUSEHOLD_ROLES = FEATURE_ROLES.households; // BHW / Health Supervisor / PHN
const params = validate(householdParamsValidator, 'params');

router.get('/', authorize(HOUSEHOLD_ROLES), asyncHandler(householdsController.listHouseholds));
router.post('/', authorize(HOUSEHOLD_ROLES), validate(createHouseholdValidator), asyncHandler(householdsController.createHousehold));

router.get('/:id', authorize(HOUSEHOLD_ROLES), params, asyncHandler(householdsController.getHousehold));
router.put('/:id', authorize(HOUSEHOLD_ROLES), params, validate(updateHouseholdValidator), asyncHandler(householdsController.updateHousehold));

router.post('/:id/members', authorize(HOUSEHOLD_ROLES), params, validate(householdMemberValidator), asyncHandler(householdsController.addHouseholdMember));
router.delete('/:id/members/:memberId', authorize(HOUSEHOLD_ROLES), params, asyncHandler(householdsController.removeHouseholdMember));

export default router;
