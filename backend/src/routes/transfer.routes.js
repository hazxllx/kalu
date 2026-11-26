// backend/src/routes/transfer.routes.js
/**
 * Resident barangay-to-barangay transfer workflow routes.
 *
 * Role in KALUSAGAP:
 * Orchestrates resident relocation across barangays/municipalities so demographic
 * profiles and longitudinal health records transition cleanly without duplicate
 * registrations.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(roles, permission) -> [uploadDocumentFile]
 *         -> transfer.controller -> transfer.service -> Supabase
 *
 * Two-phase workflow & scope guarantees:
 * 1. Resident self-service (`self` chain — `FEATURE_ROLES.residentSelf`):
 *    Identity is derived strictly from `req.user`; residents initiate a draft
 *    transfer, upload/remove proof-of-residency documents, submit to the origin/
 *    destination review queue, or cancel their own pending request.
 * 2. Health personnel review (`staff` chain — Admin, MHO, PHN, Health Supervisor
 *    with `residents.transfer.approve`):
 *    Reviewers inspect requests scoped to their barangay/municipality and
 *    approve, reject, or request document resubmission.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import uploadDocumentFile from '../middleware/uploadDocumentFile.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as controller from '../controllers/transfer.controller.js';

const router = Router();
const self = [authenticate, authorize(FEATURE_ROLES.residentSelf)];
const staff = [
  authenticate,
  authorize(['admin', 'mho', 'phn', 'health_supervisor'], {
    permission: 'residents.transfer.approve',
  }),
];

// ---------------------------------------------------------------------------
// Resident Self-Service Endpoints (`self` chain — session-derived ownership)
// - GET    /transfer-requests/context                    : Returns origin barangay, destination options, and eligibility.
// - GET    /transfer-requests/me                         : Lists the authenticated resident's own transfer requests.
// - POST   /transfer-requests                            : Starts a draft transfer request from `req.body` (destination/reason).
// - POST   /transfer-requests/:id/documents              : Validates & uploads a supporting file via `uploadDocumentFile`.
// - DELETE /transfer-requests/:id/documents/:documentId  : Deletes attachment `:documentId` from editable request `:id`.
// - POST   /transfer-requests/:id/submit                 : Submits transfer request `:id` for staff review.
// - POST   /transfer-requests/:id/cancel                 : Cancels the resident's draft/pending transfer request `:id`.
// ---------------------------------------------------------------------------
router.get('/transfer-requests/context', ...self, asyncHandler(controller.getContext));
router.get('/transfer-requests/me', ...self, asyncHandler(controller.getMine));
router.get('/transfer-requests/me/:id', ...self, asyncHandler(controller.getOwnDetail));
router.post('/transfer-requests', ...self, asyncHandler(controller.startTransfer));
router.post('/transfer-requests/:id/documents', ...self, uploadDocumentFile, asyncHandler(controller.uploadDocument));
router.delete('/transfer-requests/:id/documents/:documentId', ...self, asyncHandler(controller.removeDocument));
router.post('/transfer-requests/:id/submit', ...self, asyncHandler(controller.submit));
router.post('/transfer-requests/:id/cancel', ...self, asyncHandler(controller.cancel));

// ---------------------------------------------------------------------------
// Authorized Health Personnel Review Endpoints (`staff` chain + `residents.transfer.approve`)
// - GET  /transfer-requests/queue                      : Lists scoped transfer requests (query filters: status, search, pagination).
// - GET  /transfer-requests/:id/review                 : Fetches transfer dossier + uploaded proof documents for `:id`.
// - POST /transfer-requests/:id/approve                : Approves transfer `:id` (notes in `req.body`) and updates resident scope.
// - POST /transfer-requests/:id/reject                 : Rejects transfer `:id` with reviewer reason in `req.body`.
// - POST /transfer-requests/:id/request-resubmission   : Requests resident correction/resubmission for `:id` (`req.body` reason).
// ---------------------------------------------------------------------------
router.get('/transfer-requests/queue', ...staff, asyncHandler(controller.listQueue));
router.get('/transfer-requests/:id/review', ...staff, asyncHandler(controller.getForReview));
router.post('/transfer-requests/:id/approve', ...staff, asyncHandler(controller.approve));
router.post('/transfer-requests/:id/reject', ...staff, asyncHandler(controller.reject));
router.post('/transfer-requests/:id/request-resubmission', ...staff, asyncHandler(controller.requestResubmission));

export default router;
