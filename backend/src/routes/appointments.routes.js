import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES } from '../config/roles.js';
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
 * Resident appointment booking + barangay-scoped staff management.
 *
 *   route -> authenticate -> authorize(roles [+ permission]) -> controller -> service
 *
 * Resident self-service lives under `/appointments/mine` and `/appointments/
 * (services|availability)` + `POST /appointments` (book). Ownership is derived
 * from the session, so a changed :id can only ever yield a 404. Staff
 * management (list/decide/schedule) is gated to the barangay-scoped manager
 * roles and the service re-enforces barangay/municipality scope; Supabase RLS
 * is the independent database-level control.
 */
const router = Router();

const RESIDENT = FEATURE_ROLES.residentSelf;
const MANAGER = FEATURE_ROLES.appointmentManage;
const SCHEDULER = FEATURE_ROLES.appointmentSchedule;

const idParam = validate(idParamValidator, 'params');
const scheduleIdParam = validate(scheduleIdParamValidator, 'params');

router.use(authenticate);

// --- Resident self-service -------------------------------------------------
router.get('/mine', authorize(RESIDENT), asyncHandler(controller.listOwn));
router.get('/mine/:id', authorize(RESIDENT), idParam, asyncHandler(controller.getOwn));
router.post('/mine/:id/cancel', authorize(RESIDENT), idParam, validate(reasonBodyValidator), asyncHandler(controller.cancelOwn));
router.post('/mine/:id/respond', authorize(RESIDENT), idParam, validate(proposalResponseValidator), asyncHandler(controller.respond));
router.get('/services', authorize(RESIDENT), asyncHandler(controller.services));
router.get('/availability', authorize(RESIDENT), validate(availabilityQueryValidator, 'query'), asyncHandler(controller.availability));
router.post('/', authorize(RESIDENT), validate(bookValidator), asyncHandler(controller.book));

// --- Schedule + closure configuration (authorized staff) -------------------
// Gated by role (appointmentSchedule = bhw / health_supervisor / phn / mho).
// The service re-enforces barangay/municipality scope on every schedule write,
// and Supabase RLS is the independent database-level control.
router.get('/schedules', authorize(SCHEDULER), asyncHandler(controller.listSchedules));
router.post('/schedules', authorize(SCHEDULER), validate(scheduleValidator), asyncHandler(controller.createSchedule));
router.put('/schedules/:id', authorize(SCHEDULER), scheduleIdParam, validate(scheduleValidator), asyncHandler(controller.updateSchedule));
router.delete('/schedules/:id', authorize(SCHEDULER), scheduleIdParam, asyncHandler(controller.deleteSchedule));

router.get('/blackouts', authorize(SCHEDULER), asyncHandler(controller.listBlackouts));
router.post('/blackouts', authorize(SCHEDULER), validate(blackoutValidator), asyncHandler(controller.createBlackout));
router.delete('/blackouts/:id', authorize(SCHEDULER), scheduleIdParam, asyncHandler(controller.deleteBlackout));

// --- Staff appointment management ------------------------------------------
router.get('/', authorize(MANAGER), asyncHandler(controller.staffList));
router.get('/:id', authorize(MANAGER), idParam, asyncHandler(controller.staffGet));
router.post('/:id/approve', authorize(MANAGER), idParam, validate(approveValidator), asyncHandler(controller.approve));
router.post('/:id/decline', authorize(MANAGER), idParam, validate(declineValidator), asyncHandler(controller.decline));
router.post('/:id/propose', authorize(MANAGER), idParam, validate(proposeValidator), asyncHandler(controller.propose));
router.post('/:id/cancel', authorize(MANAGER), idParam, validate(reasonBodyValidator), asyncHandler(controller.cancel));
router.post('/:id/outcome', authorize(MANAGER), idParam, validate(outcomeValidator), asyncHandler(controller.outcome));

export default router;
