/**
 * Resident transfer workflow endpoints (barangay-to-barangay movement).
 *
 * Two-phase workflow:
 * 1. Resident self-service: initiate request, upload documents, submit to Health Supervisor
 * 2. Health personnel review: accept/reject and route to destination barangay PHN/MHO
 *
 * Permissions are dynamically enforced: residents can only modify their own requests,
 * staff can only review requests for residents in their scope.
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

// Resident self-service (identity always derived from the authenticated session).
router.get('/transfer-requests/context', ...self, asyncHandler(controller.getContext));
router.get('/transfer-requests/me', ...self, asyncHandler(controller.getMine));
router.post('/transfer-requests', ...self, asyncHandler(controller.startTransfer));
router.post('/transfer-requests/:id/documents', ...self, uploadDocumentFile, asyncHandler(controller.uploadDocument));
router.delete('/transfer-requests/:id/documents/:documentId', ...self, asyncHandler(controller.removeDocument));
router.post('/transfer-requests/:id/submit', ...self, asyncHandler(controller.submit));
router.post('/transfer-requests/:id/cancel', ...self, asyncHandler(controller.cancel));

// Authorized health personnel review.
router.get('/transfer-requests/queue', ...staff, asyncHandler(controller.listQueue));
router.get('/transfer-requests/:id/review', ...staff, asyncHandler(controller.getForReview));
router.post('/transfer-requests/:id/approve', ...staff, asyncHandler(controller.approve));
router.post('/transfer-requests/:id/reject', ...staff, asyncHandler(controller.reject));
router.post('/transfer-requests/:id/request-resubmission', ...staff, asyncHandler(controller.requestResubmission));

export default router;
