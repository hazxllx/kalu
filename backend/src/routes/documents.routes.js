import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import uploadDocumentFile, {
  uploadGovernmentIdPairFiles,
  uploadResidentDocumentFiles,
} from '../middleware/uploadDocumentFile.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as documentsController from '../controllers/documents.controller.js';
import { validateDocumentUpload, validateDocumentReview } from '../validators/documents.validators.js';

const router = Router();

// Pre-screen a document WITHOUT storing it (registration Step 3). Runs the same
// deterministic rule-based screening used at upload time, so the resident sees
// the result immediately and submission can be blocked before it reaches the
// server. No file is persisted here.
router.post(
  '/resident-documents/screen',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  uploadDocumentFile,
  asyncHandler(documentsController.screenResidentDocument),
);

// Pre-screen both current ID images together. OCR text stays in memory and only
// the advisory side results plus value-free comparison metadata are returned.
router.post(
  '/resident-documents/screen-id-pair',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  uploadGovernmentIdPairFiles,
  asyncHandler(documentsController.screenResidentGovernmentIdPair),
);

// Upload a resident registration document (proof of residency, government ID
// front/back, identity photo). The file arrives as multipart field `file`.
router.post(
  '/resident-documents/upload',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  uploadResidentDocumentFiles,
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

router.get(
  '/resident-documents/me/list',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(documentsController.listMyDocuments),
);

// Remove the signed-in resident's own pending document.
router.delete(
  '/resident-documents/:id',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(documentsController.deleteResidentDocument),
);

// Staff: list a resident's uploaded documents (signed URLs; scope-enforced).
router.get(
  '/verifications/:residentId/documents',
  authenticate,
  authorize(FEATURE_ROLES.verification),
  asyncHandler(documentsController.listResidentDocuments),
);

// Staff: view a single resident document (scope-enforced in service).
router.get(
  '/verifications/:residentId/documents/:documentId',
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
