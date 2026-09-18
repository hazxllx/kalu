import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as documentsController from '../controllers/documents.controller.js';
import { validateDocumentUpload, validateDocumentReview } from '../validators/documents.validators.js';

const router = Router();

// Upload a proof-of-residency document for the signed-in resident.
router.post(
  '/resident-documents/upload',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  validate(validateDocumentUpload),
  asyncHandler(documentsController.uploadResidentDocument),
);

// Get the signed-in resident's own document.
router.get(
  '/resident-documents/me',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(documentsController.getMyDocument),
);

// Remove the signed-in resident's own pending document.
router.delete(
  '/resident-documents/:id',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(documentsController.deleteResidentDocument),
);

// Staff: view a resident's document (scope-enforced in service).
router.get(
  '/verifications/:residentId/documents',
  authenticate,
  authorize(FEATURE_ROLES.verification),
  asyncHandler(documentsController.getResidentDocument),
);

// Staff: approve/reject a resident's document.
router.patch(
  '/verifications/:residentId/documents/:documentId/review',
  authenticate,
  authorize(FEATURE_ROLES.verification),
  validate(validateDocumentReview),
  asyncHandler(documentsController.reviewResidentDocument),
);

export default router;
