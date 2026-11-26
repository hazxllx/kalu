// backend/src/routes/healthServices.routes.js
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { uploadMiddleware } from '../middleware/upload.js';
import { FEATURE_ROLES } from '../config/roles.js';
import {
  createServiceValidator,
  updateServiceValidator,
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
 * Health services catalog, personnel assignment, attendance, and attachment routes (`/api/health-services`).
 *
 * Request pipeline:
 *   route -> authenticate -> authorize(roles [, permission]) -> [validate | uploadMiddleware] -> controller -> service -> Supabase (RLS)
 *
 * The collection route also permits authenticated residents to read a reduced
 * public catalog within their profile municipality/barangay. Other read routes
 * require staff `FEATURE_ROLES.healthServicesRead`; management routes require
 * `FEATURE_ROLES.healthServices`. Scope is enforced server-side and by RLS.
 */
const router = Router();

// Reusable auth + RBAC middleware stacks partitioned by read vs management permissions.
const readers = [authenticate, authorize(FEATURE_ROLES.healthServicesRead)];
const catalogReaders = [
  authenticate,
  authorize([...FEATURE_ROLES.healthServicesRead, ...FEATURE_ROLES.residentSelf]),
];
const managerReaders = [
  authenticate,
  authorize(FEATURE_ROLES.healthServices, { anyPermission: ['services.create', 'services.edit'] }),
];
const creators = [authenticate, authorize(FEATURE_ROLES.healthServices, { permission: 'services.create' })];
const editors = [authenticate, authorize(FEATURE_ROLES.healthServices, { permission: 'services.edit' })];
const deleters = [authenticate, authorize(FEATURE_ROLES.healthServices, { permission: 'services.delete' })];
// Reusable path-parameter validators for service IDs (`:id`) and attendance record IDs.
const idParam = validate(serviceIdParamValidator, 'params');
const attendanceIdParam = validate(attendanceIdParamValidator, 'params');

// Static collection routes are registered BEFORE `/:id` so Express does not capture literal segments as `:id`.
// GET /api/health-services/meta — Service categories, status enums, and filter metadata (`readers`).
router.get('/meta', ...readers, asyncHandler(controller.meta));
// GET /api/health-services/reference — Facility/barangay reference options for service creation/editing (`managerReaders`).
router.get('/reference', ...managerReaders, asyncHandler(controller.reference));
// GET /api/health-services/personnel — List assignable health personnel within the manager's scope (`managerReaders`).
router.get('/personnel', ...managerReaders, asyncHandler(controller.personnel));
// GET /api/health-services/attendance — Query service attendance logs (`readers` + `attendanceListQueryValidator` on `req.query`).
router.get('/attendance', ...readers, validate(attendanceListQueryValidator, 'query'), asyncHandler(controller.listAttendance));
// GET /api/health-services — Staff catalog or resident-safe public catalog, each profile-scoped server-side.
router.get('/', ...catalogReaders, asyncHandler(controller.list));
// PATCH /api/health-services/attendance/:id — Update an attendance record (`editors` + `attendanceIdParam` + `updateAttendanceValidator`).
router.patch('/attendance/:id', ...editors, attendanceIdParam, validate(updateAttendanceValidator), asyncHandler(controller.updateAttendance));
// GET /api/health-services/:id/registrations — List resident visit intents/registrations for service `:id` (`readers` + `idParam`).
router.get('/:id/registrations', ...readers, idParam, asyncHandler(controller.registrations));
// GET /api/health-services/:id — Retrieve a single health service and its personnel assignments (`readers` + `idParam`).
router.get('/:id', ...readers, idParam, asyncHandler(controller.get));

// POST /api/health-services — Create a new health service entry (`creators` + `createServiceValidator` on `req.body`).
router.post('/', ...creators, validate(createServiceValidator), asyncHandler(controller.create));
// PATCH /api/health-services/:id — Partially update health service `:id` (`editors` + `idParam` + `updateServiceValidator`).
router.patch('/:id', ...editors, idParam, validate(updateServiceValidator), asyncHandler(controller.update));
// DELETE /api/health-services/:id — Delete health service `:id` (`deleters` + `idParam`).
router.delete('/:id', ...deleters, idParam, asyncHandler(controller.remove));
// POST /api/health-services/attendance — Log beneficiary attendance for a service (`editors` + `createAttendanceValidator`).
router.post('/attendance', ...editors, validate(createAttendanceValidator), asyncHandler(controller.createAttendance));
// POST /api/health-services/:id/assign — Assign staff member(s) to service `:id` (`editors` + `idParam` + `assignValidator`).
router.post('/:id/assign', ...editors, idParam, validate(assignValidator), asyncHandler(controller.assign));
// DELETE /api/health-services/:id/assign/:personnelId — Remove `:personnelId` assignment from service `:id` (`editors` + `idParam`).
router.delete('/:id/assign/:personnelId', ...editors, idParam, asyncHandler(controller.unassign));
// GET /api/health-services/:id/attachments/:attachmentType — Issue a temporary signed URL for attachment `:attachmentType` (`readers` + `idParam`).
router.get('/:id/attachments/:attachmentType', ...readers, idParam, asyncHandler(controller.getAttachmentSignedUrl));
// POST /api/health-services/:id/attachments/:attachmentType — Upload multipart `file` for `:attachmentType` (`editors` + `idParam` + `uploadMiddleware.single('file')`).
router.post('/:id/attachments/:attachmentType', ...editors, idParam, uploadMiddleware.single('file'), asyncHandler(controller.uploadAttachment));
// DELETE /api/health-services/:id/attachments/:attachmentType — Remove attachment `:attachmentType` from service `:id` (`editors` + `idParam`).
router.delete('/:id/attachments/:attachmentType', ...editors, idParam, asyncHandler(controller.deleteAttachment));

export default router;
