import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import uploadDocumentFile from '../middleware/uploadDocumentFile.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as controller from '../controllers/transfer.controller.js';

const router = Router();
const self = [authenticate, authorize(FEATURE_ROLES.residentSelf)];
const staff = [authenticate, authorize(['admin', 'mho', 'phn', 'health_supervisor'])];

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

export default router;
