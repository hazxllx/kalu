import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES, ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/appointments.controller.js';
import {
  bookValidator,
  availabilityQueryValidator,
  reasonBodyValidator,
  approveValidator,
  declineValidator,
  proposeValidator,
  outcomeValidator,
  proposalResponseValidator,
  scheduleValidator,
  blackoutValidator,
  idParamValidator,
  scheduleIdParamValidator,
} from '../validators/appointments.validators.js';

/**
 * Resident appointment booking and barangay-scoped staff management routes (`/api/appointments`).
 *
 * Request pipeline:
 *   route -> authenticate -> authorize(roles) -> [validate(params|query|body)] -> controller -> service -> Supabase (RPC + RLS)
 *
 * Resident self-service lives under `/appointments/mine`, `/appointments/services`,
 * `/appointments/availability`, and `POST /appointments` (book). Ownership is derived
 * from `req.user` in the session, so probing another resident's `:id` yields 404.
 * Staff management (list/decide/outcome) and schedule/blackout configuration are gated
 * to barangay-scoped manager/scheduler roles (`FEATURE_ROLES.appointmentManage` and
 * `FEATURE_ROLES.appointmentSchedule`); the service layer re-enforces barangay and
 * municipality scope, while Supabase Row Level Security provides independent DB enforcement
 * and concurrency-safe slot capacity checks.
 */
const router = Router();

// Role groups governing resident self-service, appointment triage, and slot configuration.
const RESIDENT = [ROLES.RESIDENT];
const MANAGER = FEATURE_ROLES.appointmentManage;
const SCHEDULER = FEATURE_ROLES.appointmentSchedule;

// Reusable path-parameter validators for appointment IDs and schedule/blackout IDs.
const idParam = validate(idParamValidator, 'params');
const scheduleIdParam = validate(scheduleIdParamValidator, 'params');

// All appointment endpoints require an authenticated active session.
router.use(authenticate);

// --- Resident self-service -------------------------------------------------
// GET /api/appointments/mine — List the authenticated resident's own appointments (supports optional status/pagination query params).
router.get('/mine', authorize(RESIDENT), asyncHandler(controller.listOwn));
// GET /api/appointments/mine/:id — Retrieve a single appointment owned by the authenticated resident.
router.get('/mine/:id', authorize(RESIDENT), idParam, asyncHandler(controller.getOwn));
// POST /api/appointments/mine/:id/cancel — Cancel the resident's own pending/approved appointment; body validated by `reasonBodyValidator`.
router.post('/mine/:id/cancel', authorize(RESIDENT), idParam, validate(reasonBodyValidator), asyncHandler(controller.cancelOwn));
// POST /api/appointments/mine/:id/respond — Accept or decline a staff-proposed reschedule time; body validated by `proposalResponseValidator`.
router.post('/mine/:id/respond', authorize(RESIDENT), idParam, validate(proposalResponseValidator), asyncHandler(controller.respond));
// GET /api/appointments/services — List active bookable health services available to the resident's assigned barangay/municipality.
router.get('/services', authorize(RESIDENT), asyncHandler(controller.services));
// GET /api/appointments/availability — Query open appointment slots for a service and date range (`availabilityQueryValidator` on `req.query`).
router.get('/availability', authorize(RESIDENT), validate(availabilityQueryValidator, 'query'), asyncHandler(controller.availability));
// POST /api/appointments — Submit a new resident appointment booking request (`bookValidator` on `req.body`); slot capacity enforced atomically.
router.post('/', authorize(RESIDENT), validate(bookValidator), asyncHandler(controller.book));

// --- Schedule + closure configuration (authorized staff) -------------------
// Gated by role (appointmentSchedule = bhw / health_supervisor / phn / mho).
// The service re-enforces barangay/municipality scope on every schedule write,
// and Supabase RLS is the independent database-level control.
// GET /api/appointments/schedules — List recurring clinic/service availability schedules within the staff member's scope.
router.get('/schedules', authorize(SCHEDULER), asyncHandler(controller.listSchedules));
// POST /api/appointments/schedules — Create a recurring service availability schedule (`scheduleValidator` on `req.body`).
router.post('/schedules', authorize(SCHEDULER), validate(scheduleValidator), asyncHandler(controller.createSchedule));
// PUT /api/appointments/schedules/:id — Update an existing schedule window or slot capacity (`scheduleIdParam` + `scheduleValidator`).
router.put('/schedules/:id', authorize(SCHEDULER), scheduleIdParam, validate(scheduleValidator), asyncHandler(controller.updateSchedule));
// DELETE /api/appointments/schedules/:id — Remove an availability schedule rule (`scheduleIdParam`).
router.delete('/schedules/:id', authorize(SCHEDULER), scheduleIdParam, asyncHandler(controller.deleteSchedule));

// GET /api/appointments/blackouts — List holiday/closure blackout dates affecting appointment booking within scope.
router.get('/blackouts', authorize(SCHEDULER), asyncHandler(controller.listBlackouts));
// POST /api/appointments/blackouts — Register a clinic closure/blackout date (`blackoutValidator` on `req.body`).
router.post('/blackouts', authorize(SCHEDULER), validate(blackoutValidator), asyncHandler(controller.createBlackout));
// DELETE /api/appointments/blackouts/:id — Remove a blackout date (`scheduleIdParam`).
router.delete('/blackouts/:id', authorize(SCHEDULER), scheduleIdParam, asyncHandler(controller.deleteBlackout));

// --- Staff appointment management ------------------------------------------
// GET /api/appointments — List resident appointments within the staff member's barangay/municipality scope (filterable via query params).
router.get('/', authorize(MANAGER), asyncHandler(controller.staffList));
// GET /api/appointments/:id — Retrieve full appointment details for staff review (`idParam`).
router.get('/:id', authorize(MANAGER), idParam, asyncHandler(controller.staffGet));
// POST /api/appointments/:id/approve — Confirm a requested appointment slot (`idParam` + `approveValidator`).
router.post('/:id/approve', authorize(MANAGER), idParam, validate(approveValidator), asyncHandler(controller.approve));
// POST /api/appointments/:id/decline — Decline a requested appointment with reason (`idParam` + `declineValidator`).
router.post('/:id/decline', authorize(MANAGER), idParam, validate(declineValidator), asyncHandler(controller.decline));
// POST /api/appointments/:id/propose — Propose an alternative appointment date/slot to the resident (`idParam` + `proposeValidator`).
router.post('/:id/propose', authorize(MANAGER), idParam, validate(proposeValidator), asyncHandler(controller.propose));
// POST /api/appointments/:id/cancel — Staff-initiated cancellation of an approved appointment (`idParam` + `reasonBodyValidator`).
router.post('/:id/cancel', authorize(MANAGER), idParam, validate(reasonBodyValidator), asyncHandler(controller.cancel));
// POST /api/appointments/:id/outcome — Record post-visit attendance outcome such as completed or no-show (`idParam` + `outcomeValidator`).
router.post('/:id/outcome', authorize(MANAGER), idParam, validate(outcomeValidator), asyncHandler(controller.outcome));

export default router;
