import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES } from '../config/roles.js';
import {
  createServiceValidator,
  assignValidator,
  serviceIdParamValidator,
  createAttendanceValidator,
  attendanceListQueryValidator,
  updateAttendanceValidator,
  attendanceIdParamValidator,
} from '../validators/healthServices.validators.js';
import * as controller from '../controllers/healthServices.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Health services catalog + personnel assignment.
 *
 * Read routes require `FEATURE_ROLES.healthServicesRead` (all staff who can be
 * assigned a service); management routes require `FEATURE_ROLES.healthServices`
 * (MHO / PHN / Health Supervisor). The service enforces municipality/barangay
 * scope, and Supabase RLS enforces the same visibility boundary independently.
 */
const router = Router();

const readers = [authenticate, authorize(FEATURE_ROLES.healthServicesRead)];
const managerReaders = [
  authenticate,
  authorize(FEATURE_ROLES.healthServices, { anyPermission: ['services.create', 'services.edit'] }),
];
const creators = [authenticate, authorize(FEATURE_ROLES.healthServices, { permission: 'services.create' })];
const editors = [authenticate, authorize(FEATURE_ROLES.healthServices, { permission: 'services.edit' })];
const idParam = validate(serviceIdParamValidator, 'params');
const attendanceIdParam = validate(attendanceIdParamValidator, 'params');

router.get('/meta', ...readers, asyncHandler(controller.meta));
router.get('/reference', ...managerReaders, asyncHandler(controller.reference));
router.get('/personnel', ...managerReaders, asyncHandler(controller.personnel));
router.get('/attendance', ...readers, validate(attendanceListQueryValidator, 'query'), asyncHandler(controller.listAttendance));
router.get('/', ...readers, asyncHandler(controller.list));
router.patch('/attendance/:id', ...editors, attendanceIdParam, validate(updateAttendanceValidator), asyncHandler(controller.updateAttendance));
router.get('/:id/registrations', ...readers, idParam, asyncHandler(controller.registrations));
router.get('/:id', ...readers, idParam, asyncHandler(controller.get));

router.post('/', ...creators, validate(createServiceValidator), asyncHandler(controller.create));
router.post('/attendance', ...editors, validate(createAttendanceValidator), asyncHandler(controller.createAttendance));
router.post('/:id/assign', ...editors, idParam, validate(assignValidator), asyncHandler(controller.assign));
router.delete('/:id/assign/:personnelId', ...editors, idParam, asyncHandler(controller.unassign));

export default router;
