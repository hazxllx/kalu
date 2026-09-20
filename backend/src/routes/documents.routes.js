import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import uploadDocumentFile from '../middleware/uploadDocumentFile.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as documentsController from '../controllers/documents.controller.js';
import { validateDocumentUpload, validateDocumentReview } from '../validators/documents.validators.js';

const router = Router();

// Upload a resident registration document (proof of residency, government ID
// front/back, identity photo). The file arrives as multipart field `file`.
router.post(
  '/resident-documents/upload',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  uploadDocumentFile,
  validate((body, req) => validateDocumentUpload({ ...body, file: req.file }), 'body'),
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
