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
import idempotency, { createIdempotencyMiddleware } from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import householdsController from '../controllers/households.controller.js';
import householdRiskWorkflowController from '../controllers/householdRiskWorkflow.controller.js';
import validate from '../middleware/validate.js';
import ApiError from '../utils/apiError.js';
import {
  createHouseholdValidator,
  householdMemberValidator,
  householdParamsValidator,
  updateHouseholdValidator,
} from '../validators/household.validators.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as householdsService from '../services/households.service.js';

const router = Router();

router.use(authenticate, resolveBarangayScope);

const HOUSEHOLD_ROLES = FEATURE_ROLES.households; // BHW / Health Supervisor / PHN
const params = validate(householdParamsValidator, 'params');
const revalidateHouseholdScope = asyncHandler(async (req, res, next) => {
  await householdsService.getHousehold({ id: req.params.id, user: req.user });
  next();
});
const createHouseholdIdempotency = createIdempotencyMiddleware({
  validateReplay: async (req, responseBody) => {
    const householdId = responseBody?.data?.household?.id ?? responseBody?.household?.id;
    if (!householdId) throw ApiError.notFound('Household not found');
    await householdsService.getHousehold({ id: householdId, user: req.user });
  },
});

router.get(
  '/',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.view' }),
  asyncHandler(householdsController.listHouseholds),
);
// Idempotency-Key makes an offline re-upload safe (no duplicate household).
router.post(
  '/',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.create' }),
  validate(createHouseholdValidator),
  createHouseholdIdempotency,
  asyncHandler(householdsController.createHousehold),
);

router.get(
  '/residents/search',
  authorize(HOUSEHOLD_ROLES, { anyPermission: ['households.view', 'households.create'] }),
  asyncHandler(householdsController.searchResidents),
);
router.get(
  '/:id',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.view' }),
  params,
  asyncHandler(householdsController.getHousehold),
);
router.put(
  '/:id',
  authorize(HOUSEHOLD_ROLES, { anyPermission: ['households.create', 'households.verify'] }),
  params,
  validate(updateHouseholdValidator),
  revalidateHouseholdScope,
  idempotency,
  asyncHandler(householdsController.updateHousehold),
);

router.post(
  '/:id/members',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.create' }),
  params,
  validate(householdMemberValidator),
  revalidateHouseholdScope,
  idempotency,
  asyncHandler(householdsController.addHouseholdMember),
);
router.delete(
  '/:id/members/:memberId',
  authorize(HOUSEHOLD_ROLES, { anyPermission: ['households.create', 'households.verify'] }),
  params,
  asyncHandler(householdsController.removeHouseholdMember),
);

// Member-level health profile (anthropometrics + server-computed BMI, mortality,
// remarks). Same scope + role gates as the parent household.
router.get(
  '/:id/members/:memberId/health',
  authorize(HOUSEHOLD_ROLES, { permission: 'residents.profile.view' }),
  params,
  asyncHandler(householdsController.getMemberHealth),
);
router.put(
  '/:id/members/:memberId/health',
  authorize(HOUSEHOLD_ROLES, { permission: 'residents.edit' }),
  params,
  revalidateHouseholdScope,
  idempotency,
  asyncHandler(householdsController.saveMemberHealth),
);

// BUG-009: household risk-cluster workflow (follow-up / assignment / escalation
// / resolution) — persistent, scope-enforced (service + RLS).
router.get(
  '/:id/risk-workflow',
  authorize(HOUSEHOLD_ROLES, { permission: 'followups.view' }),
  params,
  asyncHandler(householdRiskWorkflowController.getWorkflow),
);
router.put(
  '/:id/risk-workflow',
  authorize(HOUSEHOLD_ROLES, { permission: 'followups.edit' }),
  params,
  asyncHandler(householdRiskWorkflowController.saveWorkflow),
);

export default router;
