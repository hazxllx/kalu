/**
 * Household Profiling, Home Visits, Member Health, and Risk-Cluster Workflow routes (`/api/households`).
 *
 * Request pipeline:
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles, permission) -> [validate] -> [revalidateHouseholdScope] -> [idempotency] -> controller -> service -> Supabase (RLS)
 *
 * Endpoints:
 *   GET    /api/households                           list + search households, scope-enforced
 *   GET    /api/households/monitoring/summary        aggregate household risk/visit monitoring metrics
 *   POST   /api/households                           register a household (server-computed risk, duplicate guard)
 *   GET    /api/households/residents/search          search residents to link as household head/members
 *   GET    /api/households/workers                   list assignable barangay health workers in scope
 *   GET    /api/households/:id/visits                list recorded home visits for a household
 *   POST   /api/households/:id/visits                record a household home visit
 *   GET    /api/households/:id                       single household detail including members
 *   PUT    /api/households/:id                       update household profile or Health Supervisor verification
 *   POST   /api/households/:id/members               add a member (existing resident or free-form; duplicate guard)
 *   PUT    /api/households/:id/members/:memberId     update household member details
 *   DELETE /api/households/:id/members/:memberId     remove a member from the household
 *   GET    /api/households/:id/members/:memberId/health  retrieve member anthropometrics, BMI, and mortality notes
 *   PUT    /api/households/:id/members/:memberId/health  save member health profile (server-computed BMI)
 *   GET    /api/households/:id/risk-workflow         retrieve household risk-cluster follow-up/escalation state
 *   PUT    /api/households/:id/risk-workflow         save household risk-cluster assignment/escalation/resolution
 *
 * Barangay scope is enforced twice: `resolveBarangayScope` rejects any
 * cross-barangay query/body value before the controller runs, and the service
 * layer independently re-checks each record against the caller's assignment
 * (out-of-scope households are reported as absent — 404 — so IDs cannot be
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
  householdVisitValidator,
} from '../validators/household.validators.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as householdsService from '../services/households.service.js';

const router = Router();

// Authenticate caller and bind session barangay/municipality scope on every household route.
router.use(authenticate, resolveBarangayScope);

const HOUSEHOLD_ROLES = FEATURE_ROLES.households; // BHW / Health Supervisor / PHN
const params = validate(householdParamsValidator, 'params');

// Pre-idempotency guard: confirms `:id` exists and is within `req.user`'s barangay scope
// BEFORE `idempotency` can replay a cached response to an out-of-scope caller.
const revalidateHouseholdScope = asyncHandler(async (req, res, next) => {
  await householdsService.getHousehold({ id: req.params.id, user: req.user });
  next();
});

// Idempotency middleware for `POST /households` that re-validates scope on replay so a
// cached creation response is never leaked across barangay boundaries.
const createHouseholdIdempotency = createIdempotencyMiddleware({
  validateReplay: async (req, responseBody) => {
    const householdId = responseBody?.data?.household?.id ?? responseBody?.household?.id;
    if (!householdId) throw ApiError.notFound('Household not found');
    await householdsService.getHousehold({ id: householdId, user: req.user });
  },
});

// GET /api/households — List and search households within the caller's barangay/municipality scope (`households.view`).
router.get(
  '/',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.view' }),
  asyncHandler(householdsController.listHouseholds),
);

// GET /api/households/monitoring/summary — Aggregate household profiling, risk, and visit summary counts (`households.view`).
router.get(
  '/monitoring/summary',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.view' }),
  asyncHandler(householdsController.getHouseholdMonitoring),
);

// Read-only four-tier cluster totals for authorized municipal analytics users.
// Scope is derived from the authenticated profile; no household-level data is returned.
router.get(
  '/risk-clusters/summary',
  authorize(FEATURE_ROLES.analytics, { permission: 'reports.analytics.view' }),
  asyncHandler(householdRiskWorkflowController.getRiskClusterSummary),
);

// POST /api/households — Register a new household (`createHouseholdValidator`); `Idempotency-Key` prevents duplicate offline re-uploads.
router.post(
  '/',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.create' }),
  validate(createHouseholdValidator),
  createHouseholdIdempotency,
  asyncHandler(householdsController.createHousehold),
);

// GET /api/households/residents/search — Search scoped residents (`?q=`) to link when adding household heads or members.
router.get(
  '/residents/search',
  authorize(HOUSEHOLD_ROLES, { anyPermission: ['households.view', 'households.create'] }),
  asyncHandler(householdsController.searchResidents),
);

// GET /api/households/workers — List barangay health workers in scope for visit and risk-workflow assignment.
router.get(
  '/workers',
  authorize(HOUSEHOLD_ROLES, { anyPermission: ['households.view', 'households.create', 'followups.edit'] }),
  asyncHandler(householdsController.listWorkers),
);

// GET /api/households/:id/visits — List historical home visits logged for household `:id` (`params` + `households.view`).
router.get(
  '/:id/visits',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.view' }),
  params,
  asyncHandler(householdsController.listHouseholdVisits),
);

// POST /api/households/:id/visits — Record a home visit for household `:id` (`params` + `householdVisitValidator` + `idempotency`).
router.post(
  '/:id/visits',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.create' }),
  params,
  validate(householdVisitValidator),
  idempotency,
  asyncHandler(householdsController.recordHouseholdVisit),
);

// GET /api/households/:id — Retrieve a single household profile including its member roster (`params` + `households.view`).
router.get(
  '/:id',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.view' }),
  params,
  asyncHandler(householdsController.getHousehold),
);

// PUT /api/households/:id — Update household environmental/socio-economic fields or Health Supervisor verification (`updateHouseholdValidator` + scope check + `idempotency`).
router.put(
  '/:id',
  authorize(HOUSEHOLD_ROLES, { anyPermission: ['households.create', 'households.verify'] }),
  params,
  validate(updateHouseholdValidator),
  revalidateHouseholdScope,
  idempotency,
  asyncHandler(householdsController.updateHousehold),
);

// POST /api/households/:id/members — Add a member to household `:id` (`householdMemberValidator` + scope check + `idempotency`).
router.post(
  '/:id/members',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.create' }),
  params,
  validate(householdMemberValidator),
  revalidateHouseholdScope,
  idempotency,
  asyncHandler(householdsController.addHouseholdMember),
);

// PUT /api/households/:id/members/:memberId — Update member `:memberId` in household `:id` (`householdMemberValidator` + scope check + `idempotency`).
router.put(
  '/:id/members/:memberId',
  authorize(HOUSEHOLD_ROLES, { permission: 'households.create' }),
  params,
  validate(householdMemberValidator),
  revalidateHouseholdScope,
  idempotency,
  asyncHandler(householdsController.updateHouseholdMember),
);

// DELETE /api/households/:id/members/:memberId — Remove member `:memberId` from household `:id` (`params`).
router.delete(
  '/:id/members/:memberId',
  authorize(HOUSEHOLD_ROLES, { anyPermission: ['households.create', 'households.verify'] }),
  params,
  asyncHandler(householdsController.removeHouseholdMember),
);

// Member-level health profile (anthropometrics + server-computed BMI, mortality,
// remarks). Same scope + role gates as the parent household.
// GET /api/households/:id/members/:memberId/health — Retrieve health and anthropometric profile for `:memberId` (`residents.profile.view`).
router.get(
  '/:id/members/:memberId/health',
  authorize(HOUSEHOLD_ROLES, { permission: 'residents.profile.view' }),
  params,
  asyncHandler(householdsController.getMemberHealth),
);

// PUT /api/households/:id/members/:memberId/health — Save anthropometrics (recomputing BMI server-side), mortality, and remarks (`residents.edit` + scope check + `idempotency`).
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
// GET /api/households/:id/risk-workflow — Retrieve risk-cluster workflow status and BHW assignment for household `:id` (`followups.view`).
router.get(
  '/:id/risk-workflow',
  authorize(HOUSEHOLD_ROLES, { permission: 'followups.view' }),
  params,
  asyncHandler(householdRiskWorkflowController.getWorkflow),
);

// PUT /api/households/:id/risk-workflow — Update follow-up assignment, escalation, or resolution state for household `:id` (`followups.edit`).
router.put(
  '/:id/risk-workflow',
  authorize(HOUSEHOLD_ROLES, { permission: 'followups.edit' }),
  params,
  asyncHandler(householdRiskWorkflowController.saveWorkflow),
);

export default router;
